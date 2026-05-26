from __future__ import annotations

import re
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, FastAPI, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from psycopg2 import IntegrityError as PostgresIntegrityError
from starlette.datastructures import UploadFile as StarletteUploadFile

from pydantic import ValidationError

from .config import INDEX_FILE, STATIC_DIR, get_settings
from .db import connect, row_as_dict, transaction
from .migrations import run_pending_migrations
from .models import FeedScope, NotificationFilter, UserProfileUpdate, UserSignup
from .security import create_access_token, get_current_user, get_optional_current_user, hash_password, verify_password


router = APIRouter()
MENTION_RE = re.compile(r"(?<!\w)@([A-Za-z0-9_-]{1,50})\b")
IMAGE_CONTENT_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
}


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _utc(value: Any) -> str | None:
    if value in (None, ""):
        return None
    if isinstance(value, str):
        if value.endswith("Z"):
            return value
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return value
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return str(value)


def _clean_username(value: str) -> str:
    return (value or "").strip()


def _clean_email(value: str) -> str:
    return (value or "").strip().lower()


def _display_name(username: str) -> str:
    cleaned = re.sub(r"[_\.-]+", " ", username.strip()).strip()
    return cleaned.title() if cleaned else username


def _avatar_seed(username: str) -> str:
    seed = re.sub(r"[^A-Za-z0-9]+", "", username.lower())
    return seed or "cloudnet"


def _require_user(current_user: dict[str, Any] | None) -> dict[str, Any]:
    if current_user:
        return current_user
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def _payload(request: Request) -> dict[str, Any]:
    content_type = (request.headers.get("content-type") or "").lower()
    if "application/json" in content_type:
        data = await request.json()
        return data if isinstance(data, dict) else {}
    form = await request.form()
    return {key: value for key, value in form.items()}


def _count(conn: Any, sql: str, params: tuple[Any, ...]) -> int:
    row = conn.execute(sql, params).fetchone()
    if not row:
        return 0

    data = row_as_dict(row)
    if data:
        return int(next(iter(data.values()), 0) or 0)

    return int(row[0])


def _user_row(conn: Any, *, user_id: str | None = None, username: str | None = None) -> dict[str, Any] | None:
    if user_id:
        row = conn.execute(
            """
            SELECT id, username, email, hashed_password, display_name, bio, avatar_url, avatar_seed, created_at
            FROM users
            WHERE id = ?
            """,
            (user_id,),
        ).fetchone()
        return row_as_dict(row)
    if username:
        row = conn.execute(
            """
            SELECT id, username, email, hashed_password, display_name, bio, avatar_url, avatar_seed, created_at
            FROM users
            WHERE lower(username) = lower(?)
            """,
            (username,),
        ).fetchone()
        return row_as_dict(row)
    return None


def _user_summary(
    conn: Any,
    *,
    user_id: str | None = None,
    username: str | None = None,
    viewer_id: str | None = None,
    include_email: bool = False,
) -> dict[str, Any] | None:
    row = _user_row(conn, user_id=user_id, username=username)
    if not row:
        return None
    target_id = str(row["id"])
    payload = {
        "id": target_id,
        "username": row["username"],
        "display_name": row.get("display_name") or _display_name(row["username"]),
        "avatar_url": row.get("avatar_url") or "",
        "bio": row.get("bio") or "",
        "avatar_seed": row.get("avatar_seed") or _avatar_seed(row["username"]),
        "follower_count": _count(conn, "SELECT COUNT(*) FROM follows WHERE following_id = ?", (target_id,)),
        "following_count": _count(conn, "SELECT COUNT(*) FROM follows WHERE follower_id = ?", (target_id,)),
        "post_count": _count(conn, "SELECT COUNT(*) FROM posts WHERE author_id = ?", (target_id,)),
        "is_followed": False,
    }
    if viewer_id and viewer_id != target_id:
        payload["is_followed"] = bool(
            conn.execute(
                "SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?",
                (viewer_id, target_id),
            ).fetchone()
        )
    if include_email:
        payload["email"] = row["email"]
    return payload


def _post_payload(conn: Any, post_id: int, viewer_id: str | None = None) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT id, author_id, content, image_url, created_at FROM posts WHERE id = ?",
        (post_id,),
    ).fetchone()
    if not row:
        return None
    row_data = row_as_dict(row) or {}
    author = _user_summary(conn, user_id=str(
        row_data["author_id"]), viewer_id=viewer_id)
    if not author:
        return None
    return {
        "id": int(row_data["id"]),
        "content": row_data["content"],
        "image_url": row_data.get("image_url") or "",
        "created_at": _utc(row_data.get("created_at")),
        "author": author,
        "like_count": _count(conn, "SELECT COUNT(*) FROM post_likes WHERE post_id = ?", (post_id,)),
        "comment_count": _count(conn, "SELECT COUNT(*) FROM comments WHERE post_id = ?", (post_id,)),
        "viewer_has_liked": bool(
            viewer_id
            and conn.execute(
                "SELECT 1 FROM post_likes WHERE user_id = ? AND post_id = ?",
                (viewer_id, post_id),
            ).fetchone()
        ),
        "viewer_has_followed": bool(author.get("is_followed")),
    }


def _comment_payload(conn: Any, comment_id: int, viewer_id: str | None = None) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT id, post_id, author_id, content, created_at FROM comments WHERE id = ?",
        (comment_id,),
    ).fetchone()
    if not row:
        return None
    row_data = row_as_dict(row) or {}
    author = _user_summary(conn, user_id=str(
        row_data["author_id"]), viewer_id=viewer_id)
    if not author:
        return None
    return {
        "id": int(row_data["id"]),
        "post_id": int(row_data["post_id"]),
        "content": row_data["content"],
        "created_at": _utc(row_data.get("created_at")),
        "author": author,
    }


def _notify(
    conn: Any,
    user_id: str,
    actor_id: str | None,
    kind: str,
    *,
    post_id: int | None = None,
    comment_id: int | None = None,
    excerpt: str | None = None,
) -> None:
    if not user_id or user_id == actor_id:
        return
    conn.execute_write(
        """
        INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id, excerpt, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (user_id, actor_id, kind, post_id, comment_id, excerpt, _now()),
    )


def _notify_mentions(
    conn: Any,
    content: str,
    *,
    actor_id: str,
    post_id: int | None = None,
    comment_id: int | None = None,
) -> None:
    seen: set[str] = set()
    usernames = []
    for username in MENTION_RE.findall(content or ""):
        lowered = username.lower()
        if lowered not in seen:
            seen.add(lowered)
            usernames.append(lowered)
    if not usernames:
        return
    placeholders = ", ".join("?" for _ in usernames)
    rows = conn.execute(
        f"SELECT id FROM users WHERE lower(username) IN ({placeholders})",
        tuple(usernames),
    ).fetchall()
    for row in rows:
        _notify(conn, str(row["id"]), actor_id, "mention",
                post_id=post_id, comment_id=comment_id, excerpt=content[:180])


def _save_image(image: StarletteUploadFile | None) -> str | None:
    if not image or not image.filename:
        return None

    # Use size attribute (Starlette 1.x) to check before reading
    file_size = image.size
    if file_size is not None and file_size > 5 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File too large. Maximum size is 5MB."
        )

    content_type = (image.content_type or "").split(";", 1)[0].strip().lower()
    if content_type not in IMAGE_CONTENT_TYPES:
        raise HTTPException(
            status_code=400, detail="Only JPEG, PNG, GIF, and WebP images are allowed")

    settings = get_settings()
    extension = IMAGE_CONTENT_TYPES[content_type]
    safe_name = re.sub(r"[^A-Za-z0-9_.-]", "_",
                       Path(image.filename).name)
    filename = f"{uuid.uuid4().hex}_{Path(safe_name).stem or 'upload'}{extension}"

    settings.uploads_dir.mkdir(parents=True, exist_ok=True)
    image.file.seek(0)
    data = image.file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded image is empty")
    if file_size is None and len(data) > 5 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File too large. Maximum size is 5MB."
        )
    (settings.uploads_dir / filename).write_bytes(data)
    return f"/uploads/{filename}"


def _post_list(conn: Any, rows: list[Any], viewer_id: str | None) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for row in rows:
        item = _post_payload(conn, int(row["id"]), viewer_id)
        if item:
            items.append(item)
    return items


@router.get("/")
def read_index() -> FileResponse:
    return FileResponse(str(INDEX_FILE))


@router.post("/api/signup", status_code=201)
@router.post("/signup", status_code=201)
async def signup(request: Request) -> dict[str, Any]:
    payload = await _payload(request)
    try:
        model = UserSignup(**payload)
    except ValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=exc.errors()
        )
    username = _clean_username(model.username)
    email = _clean_email(model.email)
    if not username or not email:
        raise HTTPException(
            status_code=400, detail="Username and email are required")
    if len(model.password) > 71:
        raise HTTPException(
            status_code=400, detail="Password must be 71 characters or fewer.")

    try:
        with transaction() as conn:
            user_id = str(uuid.uuid4())
            conn.execute_write(
                """
                INSERT INTO users (id, username, email, hashed_password, display_name, bio, avatar_url, avatar_seed, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    username,
                    email,
                    hash_password(model.password),
                    (model.display_name or "").strip() or _display_name(username),
                    (model.bio or "").strip(),
                    (model.avatar_url or "").strip(),
                    _avatar_seed(username),
                    _now(),
                ),
            )
            return _user_summary(conn, user_id=user_id, include_email=True) or {}
    except (sqlite3.IntegrityError, PostgresIntegrityError) as exc:
        raise HTTPException(
            status_code=400, detail="Username or email already registered") from exc


@router.post("/api/login")
@router.post("/login")
async def login(request: Request) -> dict[str, str]:
    payload = await _payload(request)
    username = _clean_username(str(payload.get("username", "")))
    password = str(payload.get("password", ""))
    if len(password) > 71:
        raise HTTPException(
            status_code=401, detail="Incorrect username or password")

    conn = connect()
    try:
        user = _user_row(conn, username=username)
    finally:
        conn.close()
    if not user or not verify_password(password, user["hashed_password"]):
        raise HTTPException(
            status_code=401,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return {"access_token": create_access_token({"sub": user["username"]}), "token_type": "bearer"}


@router.get("/api/me")
@router.get("/me")
def me(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    conn = connect()
    try:
        profile = _user_summary(conn, user_id=str(current_user["id"]), viewer_id=str(
            current_user["id"]), include_email=True)
    finally:
        conn.close()
    if not profile:
        raise HTTPException(status_code=404, detail="User not found")
    return profile


@router.patch("/api/me")
@router.patch("/me")
async def update_me(request: Request, current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    payload = await _payload(request)
    try:
        model = UserProfileUpdate(**payload)
    except ValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=exc.errors()
        )

    display_name = (model.display_name or "").strip(
    ) if model.display_name is not None else None
    bio = (model.bio or "").strip() if model.bio is not None else None
    if display_name is None and bio is None:
        raise HTTPException(
            status_code=400, detail="At least one profile field is required")

    updates: list[str] = []
    params: list[Any] = []
    if display_name is not None:
        updates.append("display_name = ?")
        params.append(display_name)
    if bio is not None:
        updates.append("bio = ?")
        params.append(bio)

    with transaction() as conn:
        params.append(str(current_user["id"]))
        conn.execute_write(
            f"UPDATE users SET {', '.join(updates)} WHERE id = ?", tuple(params))
        profile = _user_summary(
            conn,
            user_id=str(current_user["id"]),
            viewer_id=str(current_user["id"]),
            include_email=True,
        )

    if not profile:
        raise HTTPException(status_code=404, detail="User not found")
    return profile


@router.post("/api/me/avatar")
@router.post("/me/avatar")
async def update_my_avatar(
    image: UploadFile | None = File(default=None),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    if not image:
        raise HTTPException(status_code=400, detail="Avatar image is required")

    avatar_url = _save_image(image)
    if not avatar_url:
        raise HTTPException(status_code=400, detail="Avatar image is required")

    with transaction() as conn:
        conn.execute_write(
            "UPDATE users SET avatar_url = ? WHERE id = ?",
            (avatar_url, str(current_user["id"])),
        )
        profile = _user_summary(
            conn,
            user_id=str(current_user["id"]),
            viewer_id=str(current_user["id"]),
            include_email=True,
        )

    if not profile:
        raise HTTPException(status_code=404, detail="User not found")
    return profile


@router.get("/api/feed")
def feed(
    scope: FeedScope = Query(default=FeedScope.for_you),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: dict[str, Any] | None = Depends(get_optional_current_user),
) -> list[dict[str, Any]]:
    viewer_id = str(current_user["id"]) if current_user else None
    conn = connect()
    try:
        if scope == FeedScope.following:
            if not viewer_id:
                return []
            rows = conn.execute(
                """
                SELECT p.id
                FROM posts p
                JOIN follows f ON f.following_id = p.author_id
                WHERE f.follower_id = ?
                ORDER BY p.created_at DESC, p.id DESC
                LIMIT ? OFFSET ?
                """,
                (viewer_id, limit, offset),
            ).fetchall()
        elif scope == FeedScope.trending:
            if conn.backend == "postgres":
                rows = conn.execute(
                    """
                    SELECT p.id
                    FROM posts p
                    WHERE p.created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
                    ORDER BY
                        (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id) +
                        (SELECT COUNT(*) * 2 FROM comments c WHERE c.post_id = p.id) DESC,
                        p.created_at DESC,
                        p.id DESC
                    LIMIT ? OFFSET ?
                    """,
                    (limit, offset),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT p.id
                    FROM posts p
                    WHERE datetime(p.created_at) >= datetime('now', '-7 days')
                    ORDER BY
                        (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id) +
                        (SELECT COUNT(*) * 2 FROM comments c WHERE c.post_id = p.id) DESC,
                        p.created_at DESC,
                        p.id DESC
                    LIMIT ? OFFSET ?
                    """,
                    (limit, offset),
                ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id FROM posts ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()
        return _post_list(conn, rows, viewer_id)
    finally:
        conn.close()


@router.get("/tweets")
def legacy_feed(current_user: dict[str, Any] | None = Depends(get_optional_current_user)) -> list[dict[str, Any]]:
    return feed(scope=FeedScope.for_you, limit=50, offset=0, current_user=current_user)


@router.get("/api/posts/{post_id}")
def get_post(post_id: int, current_user: dict[str, Any] | None = Depends(get_optional_current_user)) -> dict[str, Any]:
    conn = connect()
    try:
        item = _post_payload(conn, post_id, str(
            current_user["id"]) if current_user else None)
    finally:
        conn.close()
    if not item:
        raise HTTPException(status_code=404, detail="Post not found")
    return item


@router.post("/api/posts", status_code=201)
@router.post("/tweet", status_code=201)
async def create_post(request: Request, current_user: dict[str, Any] | None = Depends(get_optional_current_user)) -> dict[str, Any]:
    user = _require_user(current_user)
    payload = await _payload(request)
    content = str(payload.get("content", "")).strip()
    image = payload.get("image")
    image_url = _save_image(image if isinstance(image, StarletteUploadFile) else None)
    if not content and not image_url:
        raise HTTPException(
            status_code=400, detail="Post content or an image is required")
    if not content:
        content = "(image)"

    with transaction() as conn:
        inserted = conn.execute(
            "INSERT INTO posts (author_id, content, image_url, created_at) VALUES (?, ?, ?, ?) RETURNING id",
            (str(user["id"]), content, image_url, _now()),
        ).fetchone()
        post_id = int((row_as_dict(inserted) or {})["id"])
        _notify_mentions(conn, content, actor_id=str(
            user["id"]), post_id=post_id)
        return _post_payload(conn, post_id, str(user["id"])) or {}


@router.delete("/api/posts/{post_id}")
@router.delete("/tweet/{post_id}")
def delete_post(post_id: int, current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, str]:
    with transaction() as conn:
        row = conn.execute(
            "SELECT author_id FROM posts WHERE id = ?", (post_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Post not found")
        if str(row["author_id"]) != str(current_user["id"]):
            raise HTTPException(
                status_code=403, detail="Not authorized to delete this post")
        conn.execute_write("DELETE FROM posts WHERE id = ?", (post_id,))
    return {"status": "deleted"}


@router.get("/api/posts/{post_id}/comments")
def list_comments(post_id: int, current_user: dict[str, Any] | None = Depends(get_optional_current_user)) -> list[dict[str, Any]]:
    viewer_id = str(current_user["id"]) if current_user else None
    conn = connect()
    try:
        if not conn.execute("SELECT 1 FROM posts WHERE id = ?", (post_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Post not found")
        rows = conn.execute(
            "SELECT id FROM comments WHERE post_id = ? ORDER BY created_at ASC, id ASC",
            (post_id,),
        ).fetchall()
        items = []
        for row in rows:
            item = _comment_payload(conn, int(row["id"]), viewer_id)
            if item:
                items.append(item)
        return items
    finally:
        conn.close()


@router.post("/api/posts/{post_id}/comments", status_code=201)
async def add_comment(
    post_id: int,
    request: Request,
    current_user: dict[str, Any] | None = Depends(get_optional_current_user),
) -> dict[str, Any]:
    user = _require_user(current_user)
    payload = await _payload(request)
    content = str(payload.get("content", "")).strip()
    if not content:
        raise HTTPException(
            status_code=400, detail="Comment content is required")
    with transaction() as conn:
        post_row = conn.execute(
            "SELECT author_id FROM posts WHERE id = ?", (post_id,)).fetchone()
        if not post_row:
            raise HTTPException(status_code=404, detail="Post not found")
        inserted = conn.execute(
            "INSERT INTO comments (post_id, author_id, content, created_at) VALUES (?, ?, ?, ?) RETURNING id",
            (post_id, str(user["id"]), content, _now()),
        ).fetchone()
        comment_id = int((row_as_dict(inserted) or {})["id"])
        _notify(conn, str(post_row["author_id"]), str(
            user["id"]), "comment", post_id=post_id, comment_id=comment_id, excerpt=content[:180])
        _notify_mentions(conn, content, actor_id=str(
            user["id"]), post_id=post_id, comment_id=comment_id)
        return _comment_payload(conn, comment_id, str(user["id"])) or {}


@router.post("/api/posts/{post_id}/like")
def like_post(post_id: int, current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    with transaction() as conn:
        post_row = conn.execute(
            "SELECT author_id FROM posts WHERE id = ?", (post_id,)).fetchone()
        if not post_row:
            raise HTTPException(status_code=404, detail="Post not found")
        rowcount = conn.execute_write(
            "INSERT OR IGNORE INTO post_likes (user_id, post_id, created_at) VALUES (?, ?, ?)",
            (str(current_user["id"]), post_id, _now()),
        )
        if rowcount:
            _notify(conn, str(post_row["author_id"]), str(
                current_user["id"]), "like", post_id=post_id)
        return _post_payload(conn, post_id, str(current_user["id"])) or {}


@router.delete("/api/posts/{post_id}/like")
def unlike_post(post_id: int, current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    with transaction() as conn:
        if not conn.execute("SELECT 1 FROM posts WHERE id = ?", (post_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Post not found")
        conn.execute_write("DELETE FROM post_likes WHERE user_id = ? AND post_id = ?", (str(
            current_user["id"]), post_id))
        return _post_payload(conn, post_id, str(current_user["id"])) or {}


@router.get("/api/users/{username}")
def profile(username: str, current_user: dict[str, Any] | None = Depends(get_optional_current_user)) -> dict[str, Any]:
    conn = connect()
    try:
        item = _user_summary(conn, username=username, viewer_id=str(
            current_user["id"]) if current_user else None)
    finally:
        conn.close()
    if not item:
        raise HTTPException(status_code=404, detail="User not found")
    return item


@router.get("/api/users/{username}/posts")
def profile_posts(
    username: str,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: dict[str, Any] | None = Depends(get_optional_current_user),
) -> list[dict[str, Any]]:
    viewer_id = str(current_user["id"]) if current_user else None
    conn = connect()
    try:
        user = _user_row(conn, username=username)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        rows = conn.execute(
            "SELECT id FROM posts WHERE author_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
            (str(user["id"]), limit, offset),
        ).fetchall()
        return _post_list(conn, rows, viewer_id)
    finally:
        conn.close()


@router.post("/api/users/{username}/follow")
def follow(username: str, current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    with transaction() as conn:
        user = _user_row(conn, username=username)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        if str(user["id"]) == str(current_user["id"]):
            raise HTTPException(
                status_code=400, detail="You cannot follow yourself")
        rowcount = conn.execute_write(
            "INSERT OR IGNORE INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)",
            (str(current_user["id"]), str(user["id"]), _now()),
        )
        if rowcount:
            _notify(conn, str(user["id"]), str(current_user["id"]), "follow")
        return _user_summary(conn, user_id=str(user["id"]), viewer_id=str(current_user["id"])) or {}


@router.delete("/api/users/{username}/follow")
def unfollow(username: str, current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    with transaction() as conn:
        user = _user_row(conn, username=username)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        conn.execute_write(
            "DELETE FROM follows WHERE follower_id = ? AND following_id = ?",
            (str(current_user["id"]), str(user["id"])),
        )
        return _user_summary(conn, user_id=str(user["id"]), viewer_id=str(current_user["id"])) or {}


@router.get("/api/search")
def search(
    q: str = Query(default=""),
    current_user: dict[str, Any] | None = Depends(get_optional_current_user),
) -> dict[str, Any]:
    needle = q.strip().lower()
    if not needle:
        return {"users": [], "posts": []}
    viewer_id = str(current_user["id"]) if current_user else None
    like = f"%{needle}%"
    conn = connect()
    try:
        user_rows = conn.execute(
            """
            SELECT id FROM users
            WHERE lower(username) LIKE ? OR lower(COALESCE(display_name, '')) LIKE ? OR lower(COALESCE(bio, '')) LIKE ?
            ORDER BY username ASC
            LIMIT 8
            """,
            (like, like, like),
        ).fetchall()
        post_rows = conn.execute(
            "SELECT id FROM posts WHERE lower(content) LIKE ? ORDER BY created_at DESC, id DESC LIMIT 12",
            (like,),
        ).fetchall()
        users = [_user_summary(conn, user_id=str(
            row["id"]), viewer_id=viewer_id) for row in user_rows]
        return {
            "users": [item for item in users if item],
            "posts": _post_list(conn, post_rows, viewer_id),
        }
    finally:
        conn.close()


@router.get("/api/notifications")
def notifications(
    filter: NotificationFilter = Query(default=NotificationFilter.all),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> list[dict[str, Any]]:
    viewer_id = str(current_user["id"])
    conn = connect()
    try:
        if filter == NotificationFilter.mentions:
            rows = conn.execute(
                "SELECT * FROM notifications WHERE user_id = ? AND type = 'mention' ORDER BY created_at DESC, id DESC LIMIT 100",
                (viewer_id,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100",
                (viewer_id,),
            ).fetchall()
        items = []
        for row in rows:
            item = row_as_dict(row) or {}
            actor = _user_summary(conn, user_id=str(
                item["actor_id"]), viewer_id=viewer_id) if item.get("actor_id") else None
            items.append(
                {
                    "id": int(item["id"]),
                    "type": item["type"],
                    "created_at": _utc(item.get("created_at")),
                    "read_at": _utc(item.get("read_at")),
                    "actor": actor,
                    "post_id": item.get("post_id"),
                    "comment_id": item.get("comment_id"),
                    "excerpt": item.get("excerpt"),
                    "unread": item.get("read_at") in (None, ""),
                }
            )
        return items
    finally:
        conn.close()


@router.post("/api/notifications/read-all")
def read_all(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    with transaction() as conn:
        rowcount = conn.execute_write(
            "UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL",
            (_now(), str(current_user["id"])),
        )
        return {"status": "ok", "updated": int(rowcount)}


@router.get("/api/suggestions")
@router.get("/suggestions")
def suggestions(current_user: dict[str, Any] | None = Depends(get_optional_current_user)) -> list[dict[str, Any]]:
    viewer_id = str(current_user["id"]) if current_user else None
    conn = connect()
    try:
        if viewer_id:
            rows = conn.execute(
                """
                SELECT u.id
                FROM users u
                WHERE u.id <> ?
                  AND NOT EXISTS (
                      SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.following_id = u.id
                  )
                ORDER BY
                    (SELECT COUNT(*) FROM follows f WHERE f.following_id = u.id) DESC,
                    (SELECT COUNT(*) FROM posts p WHERE p.author_id = u.id) DESC,
                    u.username ASC
                LIMIT 5
                """,
                (viewer_id, viewer_id),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT u.id
                FROM users u
                ORDER BY
                    (SELECT COUNT(*) FROM follows f WHERE f.following_id = u.id) DESC,
                    (SELECT COUNT(*) FROM posts p WHERE p.author_id = u.id) DESC,
                    u.username ASC
                LIMIT 5
                """
            ).fetchall()
        return [item for item in (_user_summary(conn, user_id=str(row["id"]), viewer_id=viewer_id) for row in rows) if item]
    finally:
        conn.close()


def create_app() -> FastAPI:
    settings = get_settings()
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)
    if settings.run_migrations_on_startup:
        run_pending_migrations()
    app = FastAPI(title=settings.app_title)
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
    app.include_router(router)
    return app


app = create_app()
