from __future__ import annotations

from contextlib import contextmanager
import re
import sqlite3
from typing import Any, Iterator

from fastapi import HTTPException, status
import psycopg2
from psycopg2.extras import RealDictCursor

from .config import Settings, get_settings


class DatabaseUnavailable(RuntimeError):
    pass


def _translate_sql(sql: str, backend: str) -> str:
    if backend != "postgres":
        return sql

    translated = sql
    insert_or_ignore = bool(re.search(r"INSERT\s+OR\s+IGNORE\s+INTO", translated, flags=re.IGNORECASE))
    translated = re.sub(r"INSERT\s+OR\s+IGNORE\s+INTO", "INSERT INTO", translated, flags=re.IGNORECASE)
    
    # Split by string literals to avoid replacing '?' inside quotes
    chunks = re.split(r"('[^']*')", translated)
    for i in range(0, len(chunks), 2):
        chunks[i] = chunks[i].replace("?", "%s")
    translated = "".join(chunks)

    if insert_or_ignore and "ON CONFLICT" not in translated.upper():
        upper = translated.upper()
        returning_index = upper.find(" RETURNING ")
        if returning_index >= 0:
            translated = f"{translated[:returning_index]} ON CONFLICT DO NOTHING{translated[returning_index:]}"
        else:
            translated = f"{translated} ON CONFLICT DO NOTHING"
    return translated


class QueryResult:
    def __init__(self, cursor: Any, backend: str):
        self._cursor = cursor
        self.backend = backend
        self._closed = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()

    def __del__(self):
        try:
            self.close()
        except Exception:
            pass

    def fetchone(self):
        row = self._cursor.fetchone()
        self.close()
        return row

    def fetchall(self):
        rows = self._cursor.fetchall()
        self.close()
        return rows

    @property
    def rowcount(self) -> int:
        return int(self._cursor.rowcount)

    @property
    def lastrowid(self) -> Any:
        return getattr(self._cursor, "lastrowid", None)

    def close(self) -> None:
        if self._closed:
            return
        try:
            self._cursor.close()
        except Exception:
            pass
        self._closed = True


class DBConnection:
    def __init__(self, raw: Any, backend: str):
        self.raw = raw
        self.backend = backend

    def execute(self, sql: str, params: tuple[Any, ...] = ()) -> QueryResult:
        translated = _translate_sql(sql, self.backend)
        if self.backend == "postgres":
            cursor = self.raw.cursor(cursor_factory=RealDictCursor)
            cursor.execute(translated, params)
            return QueryResult(cursor, self.backend)
        cursor = self.raw.execute(translated, params)
        return QueryResult(cursor, self.backend)

    def execute_write(self, sql: str, params: tuple[Any, ...] = ()) -> int:
        translated = _translate_sql(sql, self.backend)
        if self.backend == "postgres":
            cursor = self.raw.cursor(cursor_factory=RealDictCursor)
            cursor.execute(translated, params)
            rowcount = cursor.rowcount
            cursor.close()
            return rowcount
        cursor = self.raw.execute(translated, params)
        rowcount = cursor.rowcount
        cursor.close()
        return rowcount

    def commit(self) -> None:
        self.raw.commit()

    def rollback(self) -> None:
        self.raw.rollback()

    def close(self) -> None:
        self.raw.close()


def connect(settings: Settings | None = None) -> DBConnection:
    settings = settings or get_settings()

    if settings.db_backend == "postgres":
        try:
            raw = psycopg2.connect(
                host=settings.db_host,
                port=settings.db_port,
                database=settings.db_name,
                user=settings.db_user,
                password=settings.db_password,
            )
        except Exception as exc:
            raise DatabaseUnavailable("Database connection failed") from exc
        return DBConnection(raw, "postgres")

    try:
        settings.database_path.parent.mkdir(parents=True, exist_ok=True)
        raw = sqlite3.connect(settings.database_path, check_same_thread=False)
    except sqlite3.Error as exc:
        raise DatabaseUnavailable("Database connection failed") from exc

    raw.row_factory = sqlite3.Row
    raw.execute("PRAGMA foreign_keys = ON")
    raw.execute("PRAGMA journal_mode = WAL")
    raw.execute("PRAGMA synchronous = NORMAL")
    return DBConnection(raw, "sqlite")


@contextmanager
def transaction(settings: Settings | None = None) -> Iterator[DBConnection]:
    conn = connect(settings)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def row_as_dict(row: Any | None) -> dict[str, Any] | None:
    if row is None:
        return None
    if isinstance(row, dict):
        return row
    if hasattr(row, "keys"):
        return {key: row[key] for key in row.keys()}
    return dict(row)


def fetch_one(sql: str, params: tuple[Any, ...] = (), settings: Settings | None = None) -> dict[str, Any] | None:
    conn = connect(settings)
    try:
        row = conn.execute(sql, params).fetchone()
        return row_as_dict(row)
    finally:
        conn.close()


def fetch_all(sql: str, params: tuple[Any, ...] = (), settings: Settings | None = None) -> list[dict[str, Any]]:
    conn = connect(settings)
    try:
        rows = conn.execute(sql, params).fetchall()
        return [row_as_dict(row) or {} for row in rows]
    finally:
        conn.close()


def execute(sql: str, params: tuple[Any, ...] = (), settings: Settings | None = None) -> int:
    with transaction(settings) as conn:
        return conn.execute_write(sql, params)


def map_db_error(exc: Exception) -> HTTPException:
    if isinstance(exc, DatabaseUnavailable):
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database unavailable",
        )
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Database error",
    )
