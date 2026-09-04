#!/usr/bin/env python3
"""Small authenticated snapshot service for the Healthy PWA.

The service intentionally uses only Python's standard library so it can run on
an EC2 instance without a package installation step.  It stores one latest
snapshot per configured user in SQLite.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import sqlite3
import sys
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit


SERVICE_NAME = "healthy-sync"
SERVICE_VERSION = "1.2.1"
MAX_BODY_BYTES = 5 * 1024 * 1024
SYNC_PATH = "/api/sync"
SNAPSHOT_PATH = "/api/snapshot"
HEALTH_PATH = "/api/health"

SNAPSHOT_ARRAY_FIELDS = (
    "workoutLogs",
    "exerciseNotes",
    "dailyHabits",
    "bodyMetrics",
    "settings",
    "aiAnalysis",
)

SAFE_SETTING_KEYS = frozenset({"startDate", "aiProvider", "aiModel"})
SNAPSHOT_TOP_LEVEL_FIELDS = frozenset(
    {"exportedAt", "appVersion", "media", *SNAPSHOT_ARRAY_FIELDS}
)

_SENSITIVE_KEY_RE = re.compile(
    r"(?:secret|token|password|credential|privatekey|apikey|accesskey|secretkey|authorization|bearer)",
    re.IGNORECASE,
)
_BINARY_STORAGE_KEY_RE = re.compile(
    r"(?:media|blob|dataurl|base64|binarydata|attachment)",
    re.IGNORECASE,
)
_DATA_URL_RE = re.compile(r"^\s*data:", re.IGNORECASE)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def payload_sha256(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def snapshot_state_sha256(snapshot: dict[str, Any]) -> str:
    """Hash durable client state, excluding the per-attempt export timestamp."""
    stable_state = {key: value for key, value in snapshot.items() if key != "exportedAt"}
    return payload_sha256(stable_state)


def is_sensitive_key(key: Any) -> bool:
    if not isinstance(key, str):
        return False
    normalized = re.sub(r"[^a-z0-9]", "", key.lower())
    return bool(_SENSITIVE_KEY_RE.search(normalized))


def find_sensitive_fields(value: Any, path: str = "$") -> list[str]:
    """Return object-key paths that look like credentials.

    Values are never included in the result, so this list is safe to log or
    return to the caller.
    """
    found: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = f"{path}.{key}"
            if is_sensitive_key(key):
                found.append(child_path)
            else:
                found.extend(find_sensitive_fields(child, child_path))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            found.extend(find_sensitive_fields(child, f"{path}[{index}]"))
    return found


def find_binary_storage_fields(value: Any, path: str = "$") -> list[str]:
    """Find nested fields that could smuggle media/blob content into SQLite."""
    found: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = f"{path}.{key}"
            normalized = re.sub(r"[^a-z0-9]", "", str(key).lower())
            if _BINARY_STORAGE_KEY_RE.search(normalized):
                found.append(child_path)
            else:
                found.extend(find_binary_storage_fields(child, child_path))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            found.extend(find_binary_storage_fields(child, f"{path}[{index}]"))
    elif isinstance(value, str) and _DATA_URL_RE.match(value):
        found.append(path)
    return found


def is_safe_setting_value(setting_key: str, value: Any) -> bool:
    """Constrain the three public settings to their actual small-text schema."""
    if not isinstance(value, str) or len(value) > 256 or _DATA_URL_RE.match(value):
        return False
    if any(ord(character) < 32 for character in value):
        return False
    if setting_key == "startDate":
        return bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", value))
    return True


def sanitize_snapshot(snapshot: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Remove credential-bearing settings and reject secrets elsewhere.

    The browser is expected to filter local credentials before upload.  This is
    a second defensive layer: sensitive entries in ``settings`` are stripped,
    while secret-shaped fields elsewhere reject the entire request.
    """
    sanitized = dict(snapshot)
    # Export files may contain media data URLs, but the cloud snapshot endpoint
    # deliberately excludes them.  The browser's sync payload never needs this
    # field and SQLite should not become a media store by accident.
    sanitized.pop("media", None)
    settings = sanitized.get("settings")
    if not isinstance(settings, list):
        raise ValueError("settings must be an array")

    clean_settings: list[dict[str, Any]] = []
    stripped: list[str] = []
    for index, setting in enumerate(settings):
        if (
            not isinstance(setting, dict)
            or not isinstance(setting.get("key"), str)
            or "value" not in setting
        ):
            raise ValueError(f"settings[{index}] must contain a string key and value")
        setting_key = setting["key"]
        setting_payload = {key: value for key, value in setting.items() if key != "key"}
        nested_sensitive = find_sensitive_fields(setting_payload, f"$.settings[{index}]")
        nested_binary = find_binary_storage_fields(setting_payload, f"$.settings[{index}]")
        if (
            setting_key not in SAFE_SETTING_KEYS
            or not is_safe_setting_value(setting_key, setting["value"])
            or nested_sensitive
            or nested_binary
        ):
            stripped.append(setting_key)
            continue
        # Persist only the public setting schema, even if a future browser adds
        # harmless-looking metadata to the local record.
        clean_settings.append({"key": setting_key, "value": setting["value"]})

    sanitized["settings"] = clean_settings
    outside_settings = {key: value for key, value in sanitized.items() if key != "settings"}
    sensitive_paths = find_sensitive_fields(outside_settings)
    if sensitive_paths:
        raise SensitivePayloadError(sensitive_paths)
    binary_paths = find_binary_storage_fields(outside_settings)
    if binary_paths:
        raise BinaryPayloadError(binary_paths)
    return sanitized, sorted(set(stripped))


class SensitivePayloadError(ValueError):
    def __init__(self, paths: list[str]):
        super().__init__("sensitive fields are not allowed outside settings")
        self.paths = paths


class BinaryPayloadError(ValueError):
    def __init__(self, paths: list[str]):
        super().__init__("nested media or binary fields are not allowed")
        self.paths = paths


class PreconditionRequiredError(RuntimeError):
    def __init__(self, current_sha256: str):
        super().__init__("If-Match is required when replacing an existing snapshot")
        self.current_sha256 = current_sha256


class PreconditionFailedError(RuntimeError):
    def __init__(self, current_sha256: str | None):
        super().__init__("If-Match does not match the latest snapshot")
        self.current_sha256 = current_sha256


def validate_snapshot(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("request body must be a JSON object")
    unknown_fields = sorted(set(value) - SNAPSHOT_TOP_LEVEL_FIELDS)
    if unknown_fields:
        raise ValueError(f"unsupported top-level fields: {', '.join(unknown_fields)}")
    if not isinstance(value.get("exportedAt"), str) or not value["exportedAt"].strip():
        raise ValueError("exportedAt must be a non-empty string")
    if not isinstance(value.get("appVersion"), str) or not value["appVersion"].strip():
        raise ValueError("appVersion must be a non-empty string")
    for field in SNAPSHOT_ARRAY_FIELDS:
        if not isinstance(value.get(field), list):
            raise ValueError(f"{field} must be an array")
    return value


def snapshot_counts(snapshot: dict[str, Any]) -> dict[str, int]:
    return {field: len(snapshot[field]) for field in SNAPSHOT_ARRAY_FIELDS}


@dataclass(frozen=True)
class SyncConfig:
    secret: str
    database_path: Path
    user_key: str = "link"
    allowed_origins: frozenset[str] = frozenset(
        {
            "https://health.gaindar.com",
            "http://127.0.0.1:8080",
            "http://localhost:8080",
        }
    )
    max_body_bytes: int = MAX_BODY_BYTES

    @classmethod
    def from_environment(cls) -> "SyncConfig":
        secret = os.environ.get("HEALTHY_SYNC_SECRET", "")
        if not secret:
            raise RuntimeError("HEALTHY_SYNC_SECRET is required")
        if secret == "REPLACE_WITH_A_RANDOM_SECRET":
            raise RuntimeError("HEALTHY_SYNC_SECRET still contains the example placeholder")
        if len(secret) < 24:
            raise RuntimeError("HEALTHY_SYNC_SECRET must contain at least 24 characters")
        try:
            secret.encode("ascii")
        except UnicodeEncodeError as error:
            raise RuntimeError("HEALTHY_SYNC_SECRET must contain ASCII characters only") from error
        default_database = Path(__file__).resolve().parent / "data" / "healthy-sync.sqlite3"
        database_path = Path(os.environ.get("HEALTHY_SYNC_DB", str(default_database))).expanduser()
        user_key = os.environ.get("HEALTHY_SYNC_USER_KEY", "link").strip()
        if not user_key:
            raise RuntimeError("HEALTHY_SYNC_USER_KEY must not be empty")
        origin_text = os.environ.get(
            "HEALTHY_ALLOWED_ORIGINS",
            "https://health.gaindar.com,http://127.0.0.1:8080,http://localhost:8080",
        )
        origins = frozenset(part.strip().rstrip("/") for part in origin_text.split(",") if part.strip())
        if not origins or "*" in origins:
            raise RuntimeError("HEALTHY_ALLOWED_ORIGINS must contain explicit origins, not '*'")
        return cls(secret=secret, database_path=database_path, user_key=user_key, allowed_origins=origins)


class SnapshotStore:
    def __init__(self, database_path: Path):
        self.database_path = database_path

    def initialize(self) -> None:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        with closing(self._connect()) as connection:
            with connection:
                connection.execute("PRAGMA journal_mode=WAL")
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS training_snapshots (
                        user_key TEXT PRIMARY KEY,
                        payload_json TEXT NOT NULL,
                        payload_sha256 TEXT NOT NULL,
                        app_version TEXT NOT NULL,
                        exported_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        revision INTEGER NOT NULL DEFAULT 1
                    )
                    """
                )
                columns = {
                    row["name"]
                    for row in connection.execute("PRAGMA table_info(training_snapshots)")
                }
                if "revision" not in columns:
                    connection.execute(
                        "ALTER TABLE training_snapshots "
                        "ADD COLUMN revision INTEGER NOT NULL DEFAULT 1"
                    )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    def upsert(
        self,
        user_key: str,
        snapshot: dict[str, Any],
        expected_sha256: str | None,
    ) -> dict[str, Any]:
        encoded = canonical_json(snapshot)
        digest = snapshot_state_sha256(snapshot)
        now = utc_now()
        with closing(self._connect()) as connection:
            with connection:
                # Serialize the read/compare/write sequence so two request
                # threads cannot both replace the same revision.
                connection.execute("BEGIN IMMEDIATE")
                existing = connection.execute(
                    """
                    SELECT payload_sha256, updated_at, revision
                    FROM training_snapshots
                    WHERE user_key = ?
                    """,
                    (user_key,),
                ).fetchone()
                if existing and existing["payload_sha256"] == digest:
                    return {
                        "updatedAt": existing["updated_at"],
                        "payloadSha256": digest,
                        "serverRevision": existing["revision"],
                        "unchanged": True,
                    }
                if existing is not None:
                    if expected_sha256 is None:
                        raise PreconditionRequiredError(existing["payload_sha256"])
                    if expected_sha256 != existing["payload_sha256"]:
                        raise PreconditionFailedError(existing["payload_sha256"])
                    revision = existing["revision"] + 1
                    connection.execute(
                        """
                        UPDATE training_snapshots
                        SET payload_json = ?, payload_sha256 = ?, app_version = ?,
                            exported_at = ?, updated_at = ?, revision = ?
                        WHERE user_key = ?
                        """,
                        (
                            encoded,
                            digest,
                            snapshot["appVersion"],
                            snapshot["exportedAt"],
                            now,
                            revision,
                            user_key,
                        ),
                    )
                else:
                    # A retained browser ETag must not deadlock disaster
                    # recovery after an intentional empty-DB restore.  With no
                    # server state to overwrite, the local snapshot is a safe
                    # bootstrap even if the client still sends an old tag.
                    revision = 1
                    connection.execute(
                        """
                        INSERT INTO training_snapshots (
                            user_key, payload_json, payload_sha256, app_version,
                            exported_at, updated_at, revision
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            user_key,
                            encoded,
                            digest,
                            snapshot["appVersion"],
                            snapshot["exportedAt"],
                            now,
                            revision,
                        ),
                    )
        return {
            "updatedAt": now,
            "payloadSha256": digest,
            "serverRevision": revision,
            "unchanged": False,
        }

    def get_latest(self, user_key: str) -> dict[str, Any] | None:
        with closing(self._connect()) as connection:
            row = connection.execute(
                """
                SELECT payload_json, payload_sha256, app_version, exported_at,
                       updated_at, revision
                FROM training_snapshots
                WHERE user_key = ?
                """,
                (user_key,),
            ).fetchone()
        if row is None:
            return None
        return {
            "snapshot": json.loads(row["payload_json"]),
            "payloadSha256": row["payload_sha256"],
            "appVersion": row["app_version"],
            "exportedAt": row["exported_at"],
            "updatedAt": row["updated_at"],
            "serverRevision": row["revision"],
        }


class HealthySyncServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address: tuple[str, int], config: SyncConfig):
        self.config = config
        self.store = SnapshotStore(config.database_path)
        self.store.initialize()
        super().__init__(address, HealthySyncHandler)


class HealthySyncHandler(BaseHTTPRequestHandler):
    server: HealthySyncServer
    protocol_version = "HTTP/1.1"
    server_version = f"{SERVICE_NAME}/{SERVICE_VERSION}"
    sys_version = ""

    def log_message(self, format_string: str, *args: Any) -> None:
        # The request body and Authorization header are intentionally never logged.
        sys.stderr.write(
            "%s [%s] %s\n"
            % (self.client_address[0], self.log_date_time_string(), format_string % args)
        )

    def _path(self) -> str:
        return urlsplit(self.path).path.rstrip("/") or "/"

    def _origin_allowed(self) -> bool:
        origin = self.headers.get("Origin")
        return origin is None or origin.rstrip("/") in self.server.config.allowed_origins

    def _cors_headers(self) -> dict[str, str]:
        origin = self.headers.get("Origin")
        if origin and origin.rstrip("/") in self.server.config.allowed_origins:
            return {
                "Access-Control-Allow-Origin": origin.rstrip("/"),
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Authorization, Content-Type, If-Match",
                "Access-Control-Expose-Headers": "ETag",
                "Access-Control-Max-Age": "600",
                "Vary": "Origin",
            }
        return {}

    def _send_json(
        self,
        status: HTTPStatus | int,
        body: dict[str, Any],
        extra_headers: dict[str, str] | None = None,
    ) -> None:
        encoded = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        # Closing each tiny API response also makes early rejections safe: when
        # authentication or size validation fails we deliberately do not read a
        # potentially hostile request body from the connection.
        self.close_connection = True
        self.send_response(int(status))
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Connection", "close")
        # ``no-transform`` keeps reverse proxies/CDNs from changing a strong
        # snapshot ETag while compressing the tiny JSON response.  The browser
        # also validates the application-level payloadSha256 as a fallback.
        self.send_header("Cache-Control", "no-store, no-transform")
        self.send_header("X-Content-Type-Options", "nosniff")
        for key, value in self._cors_headers().items():
            self.send_header(key, value)
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(encoded)

    def _send_error(self, status: HTTPStatus | int, code: str, message: str, **extra: Any) -> None:
        self._send_json(status, {"ok": False, "error": code, "message": message, **extra})

    def _authorized(self) -> bool:
        header = self.headers.get("Authorization", "")
        scheme, separator, token = header.partition(" ")
        if not separator or scheme.lower() != "bearer" or not token:
            return False
        try:
            return hmac.compare_digest(
                token.encode("ascii"), self.server.config.secret.encode("ascii")
            )
        except UnicodeEncodeError:
            return False

    def _if_match_sha256(self) -> str | None:
        raw_value = self.headers.get("If-Match")
        if raw_value is None:
            return None
        value = raw_value.strip()
        if value.startswith('"') and value.endswith('"') and len(value) >= 2:
            value = value[1:-1]
        if not re.fullmatch(r"[0-9a-fA-F]{64}", value):
            raise ValueError("If-Match must contain one strong SHA-256 ETag")
        return value.lower()

    def _require_api_access(self) -> bool:
        if not self._origin_allowed():
            self._send_error(HTTPStatus.FORBIDDEN, "origin_not_allowed", "request origin is not allowed")
            return False
        if not self._authorized():
            self._send_error(HTTPStatus.UNAUTHORIZED, "unauthorized", "valid Bearer authentication is required")
            return False
        return True

    def do_OPTIONS(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        if self._path() not in {SYNC_PATH, SNAPSHOT_PATH, HEALTH_PATH}:
            self._send_error(HTTPStatus.NOT_FOUND, "not_found", "endpoint not found")
            return
        if not self._origin_allowed():
            self._send_error(HTTPStatus.FORBIDDEN, "origin_not_allowed", "request origin is not allowed")
            return
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Content-Length", "0")
        self.send_header("Cache-Control", "no-store, no-transform")
        for key, value in self._cors_headers().items():
            self.send_header(key, value)
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        path = self._path()
        if path == HEALTH_PATH:
            if not self._origin_allowed():
                self._send_error(HTTPStatus.FORBIDDEN, "origin_not_allowed", "request origin is not allowed")
                return
            self._send_json(
                HTTPStatus.OK,
                {"ok": True, "status": "ok", "service": SERVICE_NAME, "version": SERVICE_VERSION},
            )
            return
        if path != SNAPSHOT_PATH:
            self._send_error(HTTPStatus.NOT_FOUND, "not_found", "endpoint not found")
            return
        if not self._require_api_access():
            return
        latest = self.server.store.get_latest(self.server.config.user_key)
        if latest is None:
            self._send_error(HTTPStatus.NOT_FOUND, "snapshot_not_found", "no snapshot has been stored")
            return
        self._send_json(
            HTTPStatus.OK,
            {"ok": True, **latest},
            {"ETag": f'"{latest["payloadSha256"]}"'},
        )

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        if self._path() != SYNC_PATH:
            self._send_error(HTTPStatus.NOT_FOUND, "not_found", "endpoint not found")
            return
        if not self._require_api_access():
            return
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            self._send_error(
                HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
                "unsupported_media_type",
                "Content-Type must be application/json",
            )
            return
        content_length_text = self.headers.get("Content-Length")
        if content_length_text is None:
            self._send_error(HTTPStatus.LENGTH_REQUIRED, "length_required", "Content-Length is required")
            return
        try:
            content_length = int(content_length_text)
        except ValueError:
            self._send_error(HTTPStatus.BAD_REQUEST, "invalid_content_length", "Content-Length must be an integer")
            return
        if content_length < 0:
            self._send_error(HTTPStatus.BAD_REQUEST, "invalid_content_length", "Content-Length must not be negative")
            return
        if content_length > self.server.config.max_body_bytes:
            self._send_error(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                "payload_too_large",
                f"request body exceeds {self.server.config.max_body_bytes} bytes",
            )
            return
        try:
            expected_sha256 = self._if_match_sha256()
        except ValueError as error:
            self._send_error(HTTPStatus.BAD_REQUEST, "invalid_if_match", str(error))
            return
        raw_body = self.rfile.read(content_length)
        if len(raw_body) != content_length:
            self._send_error(HTTPStatus.BAD_REQUEST, "incomplete_body", "request body was incomplete")
            return
        request_sha256 = hashlib.sha256(raw_body).hexdigest()
        try:
            decoded = json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send_error(HTTPStatus.BAD_REQUEST, "invalid_json", "request body must be valid UTF-8 JSON")
            return
        try:
            validated = validate_snapshot(decoded)
            sanitized, stripped = sanitize_snapshot(validated)
        except SensitivePayloadError as error:
            self._send_error(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "sensitive_fields",
                str(error),
                fields=error.paths,
            )
            return
        except BinaryPayloadError as error:
            self._send_error(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "binary_fields",
                str(error),
                fields=error.paths,
            )
            return
        except ValueError as error:
            self._send_error(HTTPStatus.UNPROCESSABLE_ENTITY, "invalid_snapshot", str(error))
            return

        try:
            stored = self.server.store.upsert(
                self.server.config.user_key,
                sanitized,
                expected_sha256,
            )
        except PreconditionRequiredError as error:
            self._send_json(
                HTTPStatus.PRECONDITION_REQUIRED,
                {
                    "ok": False,
                    "error": "precondition_required",
                    "message": str(error),
                    "currentPayloadSha256": error.current_sha256,
                },
                {"ETag": f'"{error.current_sha256}"'},
            )
            return
        except PreconditionFailedError as error:
            headers = (
                {"ETag": f'"{error.current_sha256}"'}
                if error.current_sha256 is not None
                else {}
            )
            self._send_json(
                HTTPStatus.PRECONDITION_FAILED,
                {
                    "ok": False,
                    "error": "precondition_failed",
                    "message": str(error),
                    "currentPayloadSha256": error.current_sha256,
                },
                headers,
            )
            return
        acknowledged_at = utc_now()
        self._send_json(
            HTTPStatus.OK,
            {
                "ok": True,
                "syncedAt": acknowledged_at,
                "updatedAt": stored["updatedAt"],
                "payloadSha256": stored["payloadSha256"],
                "requestSha256": request_sha256,
                "serverRevision": stored["serverRevision"],
                "counts": snapshot_counts(sanitized),
                "strippedSettings": stripped,
                "unchanged": stored["unchanged"],
            },
            {"ETag": f'"{stored["payloadSha256"]}"'},
        )


def create_server(host: str, port: int, config: SyncConfig) -> HealthySyncServer:
    return HealthySyncServer((host, port), config)


def main() -> int:
    try:
        config = SyncConfig.from_environment()
    except RuntimeError as error:
        print(f"configuration error: {error}", file=sys.stderr)
        return 2
    host = os.environ.get("HEALTHY_SYNC_HOST", "127.0.0.1")
    try:
        port = int(os.environ.get("HEALTHY_SYNC_PORT", "8787"))
    except ValueError:
        print("configuration error: HEALTHY_SYNC_PORT must be an integer", file=sys.stderr)
        return 2

    server = create_server(host, port, config)
    print(
        f"{SERVICE_NAME} {SERVICE_VERSION} listening on http://{host}:{port}; "
        f"database={config.database_path}",
        file=sys.stderr,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
