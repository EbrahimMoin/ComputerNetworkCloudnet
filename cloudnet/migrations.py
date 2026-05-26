from __future__ import annotations

from pathlib import Path

from .config import MIGRATIONS_DIR, Settings, get_settings
from .db import transaction


SQLITE_SCHEMA_VERSION = "0001_social_core_sqlite"


SQLITE_CREATE_STATEMENTS = (
    """
    CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        hashed_password TEXT NOT NULL,
        display_name TEXT,
        bio TEXT DEFAULT '',
        avatar_url TEXT DEFAULT '',
        avatar_seed TEXT,
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        image_url TEXT,
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS post_likes (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
        PRIMARY KEY (user_id, post_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS follows (
        follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        following_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
        PRIMARY KEY (follower_id, following_id),
        CONSTRAINT follows_no_self_follow CHECK (follower_id <> following_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        type TEXT NOT NULL,
        post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
        comment_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
        excerpt TEXT,
        read_at TEXT,
        created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts (created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS idx_posts_author_created_at ON posts (author_id, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS idx_comments_post_created_at ON comments (post_id, created_at ASC, id ASC)",
    "CREATE INDEX IF NOT EXISTS idx_notifications_user_created_at ON notifications (user_id, created_at DESC, id DESC)",
    "CREATE INDEX IF NOT EXISTS idx_follows_following_id ON follows (following_id)",
    "CREATE INDEX IF NOT EXISTS idx_follows_follower_id ON follows (follower_id)",
)


def _iter_postgres_migrations() -> list[Path]:
    if not MIGRATIONS_DIR.exists():
        return []
    return sorted(path for path in MIGRATIONS_DIR.glob("*.sql") if path.is_file())


def _sqlite_table_exists(conn, table_name: str) -> bool:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table_name,),
    ).fetchone()
    return row is not None


def _sqlite_column_names(conn, table_name: str) -> set[str]:
    rows = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    return {row[1] for row in rows}


def _ensure_sqlite_users_columns(conn) -> None:
    if not _sqlite_table_exists(conn, "users"):
        return

    columns = _sqlite_column_names(conn, "users")
    additions = {
        "display_name": "ALTER TABLE users ADD COLUMN display_name TEXT",
        "bio": "ALTER TABLE users ADD COLUMN bio TEXT DEFAULT ''",
        "avatar_url": "ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT ''",
        "avatar_seed": "ALTER TABLE users ADD COLUMN avatar_seed TEXT",
        "created_at": "ALTER TABLE users ADD COLUMN created_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))",
    }
    for column_name, statement in additions.items():
        if column_name not in columns:
            conn.execute(statement)


def _record_migration(conn, filename: str) -> None:
    conn.execute(
        """
        INSERT OR IGNORE INTO schema_migrations (filename)
        VALUES (?)
        """,
        (filename,),
    )


def _has_migration(conn, filename: str) -> bool:
    row = conn.execute(
        "SELECT filename FROM schema_migrations WHERE filename = ?",
        (filename,),
    ).fetchone()
    return row is not None


def _migrate_legacy_tweets_sqlite(conn) -> None:
    if not _sqlite_table_exists(conn, "tweets"):
        return
    if _has_migration(conn, "legacy_tweets_to_posts"):
        return

    rows = conn.execute(
        """
        SELECT t.id, t.content, t.image_filename, t.created_at, u.id AS author_id
        FROM tweets t
        JOIN users u ON lower(u.username) = lower(t.username)
        ORDER BY t.id
        """
    ).fetchall()

    for row in rows:
        conn.execute(
            """
            INSERT INTO posts (author_id, content, image_url, created_at)
            SELECT ?, ?, ?, ?
            WHERE NOT EXISTS (
                SELECT 1
                FROM posts
                WHERE author_id = ?
                  AND content = ?
                  AND COALESCE(image_url, '') = COALESCE(?, '')
                  AND created_at = ?
            )
            """,
            (
                row["author_id"],
                row["content"],
                row["image_filename"],
                row["created_at"],
                row["author_id"],
                row["content"],
                row["image_filename"],
                row["created_at"],
            ),
        )

    _record_migration(conn, "legacy_tweets_to_posts")


def _run_sqlite_migrations(settings: Settings) -> bool:
    with transaction(settings) as conn:
        for statement in SQLITE_CREATE_STATEMENTS:
            conn.execute(statement)
        _ensure_sqlite_users_columns(conn)
        _migrate_legacy_tweets_sqlite(conn)
        _record_migration(conn, SQLITE_SCHEMA_VERSION)
    return True


def _bootstrap_postgres(conn) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY,
            username VARCHAR(50) UNIQUE NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            hashed_password VARCHAR(255) NOT NULL,
            avatar_seed VARCHAR(50),
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS tweets (
            id SERIAL PRIMARY KEY,
            content TEXT NOT NULL,
            username VARCHAR(50) NOT NULL,
            image_filename VARCHAR(255),
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            filename TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )


def _run_postgres_migrations(settings: Settings) -> bool:
    with transaction(settings) as conn:
        _bootstrap_postgres(conn)

    with transaction(settings) as conn:
        applied_rows = conn.execute("SELECT filename FROM schema_migrations ORDER BY filename").fetchall()
        applied = {row["filename"] for row in applied_rows}

    pending = [path for path in _iter_postgres_migrations() if path.name not in applied]
    for path in pending:
        sql = path.read_text(encoding="utf-8")
        with transaction(settings) as conn:
            conn.execute(sql)
            conn.execute("INSERT OR IGNORE INTO schema_migrations (filename) VALUES (?)", (path.name,))
    return True


def run_pending_migrations(settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    if settings.db_backend == "postgres":
        return _run_postgres_migrations(settings)
    return _run_sqlite_migrations(settings)
