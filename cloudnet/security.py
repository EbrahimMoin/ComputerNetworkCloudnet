from __future__ import annotations

from datetime import datetime, timedelta, timezone
import secrets
from typing import Any

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext

from .config import Settings, get_settings
from .db import connect


pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/login")
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="/api/login", auto_error=False)
_EPHEMERAL_SECRET_KEY = secrets.token_urlsafe(32)


def get_secret_key(settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    return settings.secret_key or _EPHEMERAL_SECRET_KEY


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    return pwd_context.verify(password, hashed_password)


def create_access_token(
    data: dict[str, Any],
    settings: Settings | None = None,
    expires_delta: timedelta | None = None,
) -> str:
    settings = settings or get_settings()
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=settings.access_token_expire_minutes))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, get_secret_key(settings), algorithm=settings.algorithm)


def decode_access_token(token: str, settings: Settings | None = None) -> dict[str, Any]:
    settings = settings or get_settings()
    try:
        return jwt.decode(token, get_secret_key(settings), algorithms=[settings.algorithm])
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


def _load_user_by_username(username: str, settings: Settings | None = None) -> dict[str, Any] | None:
    conn = connect(settings)
    try:
        row = conn.execute(
            """
            SELECT id, username, email, hashed_password, display_name, bio, avatar_url, avatar_seed, created_at
            FROM users
            WHERE lower(username) = lower(?)
            """,
            (username,),
        ).fetchone()
        if row is None:
            return None
        return {key: row[key] for key in row.keys()}
    finally:
        conn.close()


def get_current_user(token: str = Depends(oauth2_scheme)) -> dict[str, Any]:
    payload = decode_access_token(token)
    username = payload.get("sub")
    if not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = _load_user_by_username(username)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def get_optional_current_user(token: str = Depends(oauth2_scheme_optional)) -> dict[str, Any] | None:
    if not token:
        return None
    try:
        return get_current_user(token)
    except HTTPException as exc:
        if exc.status_code >= 500:
            raise
        return None
