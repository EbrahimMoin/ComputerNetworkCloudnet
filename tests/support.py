from __future__ import annotations

import asyncio
import json
import os
import pathlib
import re
import tempfile
import uuid
from dataclasses import dataclass
from importlib import import_module
from importlib import util as importlib_util
from typing import Any, Optional

from fastapi.routing import APIRoute


SAFE_ENV_DEFAULTS = {
    "DB_HOST": "",
    "DB_PORT": "5432",
    "DB_NAME": "",
    "DB_USER": "",
    "DB_PASS": "",
    "DB_PATH": str(pathlib.Path(tempfile.gettempdir()) / "cloudnet-tests.sqlite3"),
    "S3_BUCKET": "",
    "S3_REGION": "",
    "CLOUDFRONT_URL": "",
    "SECRET_KEY": "tests-secret-key",
    "ACCESS_TOKEN_EXPIRE_MINUTES": "10080",
}


def prepare_test_env() -> None:
    for key, value in SAFE_ENV_DEFAULTS.items():
        os.environ.setdefault(key, value)


def load_backend_module():
    prepare_test_env()
    candidates = (
        "main",
        "cloudnet.main",
        "cloudnet.app",
        "app",
    )
    for name in candidates:
        try:
            module = import_module(name)
        except Exception:
            continue
        if hasattr(module, "app") or callable(getattr(module, "create_app", None)):
            return module
    raise RuntimeError("Could not locate a FastAPI app module.")


def load_app():
    module = load_backend_module()
    app = getattr(module, "app", None)
    if app is None:
        factory = getattr(module, "create_app", None)
        if callable(factory):
            app = factory()
    if app is None:
        raise RuntimeError("Backend module does not expose app or create_app().")
    return module, app


def load_module_from_path(path: str | pathlib.Path, name: str):
    module_path = pathlib.Path(path)
    spec = importlib_util.spec_from_file_location(name, module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load module from {module_path}")
    module = importlib_util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def has_route(app, method: str, path: str) -> bool:
    method = method.upper()
    normalized_candidate = re.sub(r"\{[^/]+\}", "{}", path.rstrip("/"))
    for route in getattr(app, "router", None).routes if getattr(app, "router", None) else []:
        normalized_route = re.sub(r"\{[^/]+\}", "{}", route.path.rstrip("/"))
        if isinstance(route, APIRoute) and normalized_route == normalized_candidate and method in route.methods:
            return True
    return False


def require_route(app, method: str, path: str) -> None:
    if not has_route(app, method, path):
        raise RuntimeError(f"Missing route {method} {path}")


@dataclass
class Response:
    status_code: int
    headers: dict[str, str]
    body: bytes

    def json(self) -> Any:
        return json.loads(self.body.decode("utf-8")) if self.body else None

    @property
    def text(self) -> str:
        return self.body.decode("utf-8")


def encode_form(data: dict[str, Any]) -> bytes:
    from urllib.parse import urlencode

    return urlencode(data, doseq=True).encode("utf-8")


def encode_multipart(
    fields: dict[str, Any],
    files: dict[str, tuple[str, bytes, str]],
) -> tuple[bytes, str]:
    boundary = "----CloudNetBoundary" + uuid.uuid4().hex
    parts: list[bytes] = []

    def push(value: str | bytes) -> None:
        parts.append(value.encode("utf-8") if isinstance(value, str) else value)

    for name, value in fields.items():
        push(f"--{boundary}\r\n")
        push(f'Content-Disposition: form-data; name="{name}"\r\n\r\n')
        push(str(value))
        push("\r\n")

    for name, (filename, content, content_type) in files.items():
        push(f"--{boundary}\r\n")
        push(f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n')
        push(f"Content-Type: {content_type}\r\n\r\n")
        parts.append(content)
        push("\r\n")

    push(f"--{boundary}--\r\n")
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


class ASGIClient:
    def __init__(self, app):
        self.app = app

    def request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[dict[str, Any]] = None,
        headers: Optional[dict[str, str]] = None,
        json_body: Any = None,
        data: Optional[dict[str, Any]] = None,
        files: Optional[dict[str, tuple[str, bytes, str]]] = None,
    ) -> Response:
        method = method.upper()
        headers = {k.lower(): v for k, v in (headers or {}).items()}
        body = b""

        if json_body is not None:
            body = json.dumps(json_body).encode("utf-8")
            headers.setdefault("content-type", "application/json")
        elif files is not None:
            body, multipart_type = encode_multipart(data or {}, files)
            headers.setdefault("content-type", multipart_type)
        elif data is not None:
            body = encode_form(data)
            headers.setdefault("content-type", "application/x-www-form-urlencoded")

        if params:
            from urllib.parse import urlencode

            query = urlencode(params, doseq=True)
            path = f"{path}?{query}"

        raw_path, _, query_string = path.partition("?")
        scope = {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": method,
            "scheme": "http",
            "path": raw_path,
            "raw_path": raw_path.encode("utf-8"),
            "query_string": query_string.encode("utf-8"),
            "headers": [(k.encode("latin-1"), v.encode("latin-1")) for k, v in headers.items()],
            "client": ("testclient", 50000),
            "server": ("testserver", 80),
            "root_path": "",
        }

        response_start: dict[str, Any] = {}
        response_body = bytearray()
        request_messages = [{"type": "http.request", "body": body, "more_body": False}]

        async def receive():
            if request_messages:
                return request_messages.pop(0)
            return {"type": "http.disconnect"}

        async def send(message):
            if message["type"] == "http.response.start":
                response_start.update(message)
            elif message["type"] == "http.response.body":
                response_body.extend(message.get("body", b""))

        asyncio.run(self.app(scope, receive, send))

        headers_out: dict[str, str] = {}
        for key, value in response_start.get("headers", []):
            headers_out[key.decode("latin-1").lower()] = value.decode("latin-1")

        return Response(
            status_code=response_start.get("status", 500),
            headers=headers_out,
            body=bytes(response_body),
        )
