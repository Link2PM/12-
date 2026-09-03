#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import http.client
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest import mock

from server import MAX_BODY_BYTES, SyncConfig, create_server, snapshot_state_sha256


ORIGIN = "https://health.gaindar.com"
SECRET = "unit-test-secret-not-for-production"


def make_snapshot(marker: str = "first") -> dict:
    return {
        "exportedAt": "2026-09-03T10:00:00.000Z",
        "appVersion": "1.2.0",
        "workoutLogs": [
            {
                "id": 1,
                "date": "2026-09-03",
                "exerciseId": "w1-mon-pullup",
                "completed": True,
                "marker": marker,
            }
        ],
        "exerciseNotes": [],
        "dailyHabits": [],
        "bodyMetrics": [],
        "settings": [
            {"key": "startDate", "value": "2026-09-07"},
            {"key": "syncSecret", "value": "must-not-be-stored"},
            {"key": "aiApiKey", "value": "must-not-be-stored"},
        ],
        "aiAnalysis": [],
    }


class SyncConfigTest(unittest.TestCase):
    def test_environment_rejects_example_secret_and_wildcard_origin(self) -> None:
        with mock.patch.dict(
            os.environ,
            {"HEALTHY_SYNC_SECRET": "REPLACE_WITH_A_RANDOM_SECRET"},
            clear=True,
        ):
            with self.assertRaisesRegex(RuntimeError, "example placeholder"):
                SyncConfig.from_environment()

        with mock.patch.dict(
            os.environ,
            {
                "HEALTHY_SYNC_SECRET": SECRET,
                "HEALTHY_ALLOWED_ORIGINS": "*",
            },
            clear=True,
        ):
            with self.assertRaisesRegex(RuntimeError, "explicit origins"):
                SyncConfig.from_environment()

        with mock.patch.dict(
            os.environ,
            {"HEALTHY_SYNC_SECRET": "非ASCII密钥不可用于Authorization头部123456789"},
            clear=True,
        ):
            with self.assertRaisesRegex(RuntimeError, "ASCII"):
                SyncConfig.from_environment()


class HealthySyncEndToEndTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        config = SyncConfig(
            secret=SECRET,
            database_path=Path(self.tempdir.name) / "healthy.sqlite3",
            user_key="test-user",
            allowed_origins=frozenset({ORIGIN}),
        )
        self.server = create_server("127.0.0.1", 0, config)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.host, self.port = self.server.server_address
        self.base_url = f"http://{self.host}:{self.port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
        self.tempdir.cleanup()

    def request(
        self,
        method: str,
        path: str,
        *,
        payload: dict | None = None,
        raw_body: bytes | None = None,
        authorized: bool = False,
        origin: str | None = ORIGIN,
        content_type: str | None = "application/json",
        extra_headers: dict[str, str] | None = None,
    ) -> tuple[int, dict, dict[str, str]]:
        data = raw_body
        if payload is not None:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers: dict[str, str] = {}
        if origin is not None:
            headers["Origin"] = origin
        if authorized:
            headers["Authorization"] = f"Bearer {SECRET}"
        if content_type is not None:
            headers["Content-Type"] = content_type
        headers.update(extra_headers or {})
        request = urllib.request.Request(
            self.base_url + path,
            data=data,
            headers=headers,
            method=method,
        )
        try:
            response = urllib.request.urlopen(request, timeout=3)
        except urllib.error.HTTPError as error:
            response = error
        try:
            body_bytes = response.read()
            body = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
            return response.status, body, dict(response.headers.items())
        finally:
            response.close()

    def test_health_and_allowed_cors_preflight(self) -> None:
        status, body, headers = self.request("GET", "/api/health")
        self.assertEqual(200, status)
        self.assertTrue(body["ok"])
        self.assertEqual("healthy-sync", body["service"])
        self.assertEqual(ORIGIN, headers["Access-Control-Allow-Origin"])

        status, body, headers = self.request(
            "OPTIONS",
            "/api/sync",
            raw_body=None,
            content_type=None,
        )
        self.assertEqual(204, status)
        self.assertEqual({}, body)
        self.assertIn("POST", headers["Access-Control-Allow-Methods"])
        self.assertIn("Authorization", headers["Access-Control-Allow-Headers"])
        self.assertIn("If-Match", headers["Access-Control-Allow-Headers"])
        self.assertEqual("ETag", headers["Access-Control-Expose-Headers"])

    def test_disallowed_origin_and_missing_auth_are_rejected(self) -> None:
        status, body, _ = self.request(
            "POST",
            "/api/sync",
            payload=make_snapshot(),
            authorized=True,
            origin="https://attacker.example",
        )
        self.assertEqual(403, status)
        self.assertEqual("origin_not_allowed", body["error"])

        status, body, headers = self.request("POST", "/api/sync", payload=make_snapshot())
        self.assertEqual(401, status)
        self.assertEqual("unauthorized", body["error"])
        self.assertEqual(ORIGIN, headers["Access-Control-Allow-Origin"])

        status, body, headers = self.request(
            "OPTIONS",
            "/api/sync",
            raw_body=None,
            origin="https://attacker.example",
            content_type=None,
        )
        self.assertEqual(403, status)
        self.assertEqual("origin_not_allowed", body["error"])
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_post_strips_sensitive_settings_and_get_returns_sanitized_snapshot(self) -> None:
        snapshot = make_snapshot()
        snapshot["settings"].extend(
            [
                {"key": "aiProvider", "value": "claude"},
                {"key": "aiModel", "value": "claude-test"},
                {"key": "lastSyncAt", "value": "not-durable"},
                {"key": "syncUrl", "value": "https://example.invalid"},
                {"key": "openaiKey", "value": "must-not-be-stored"},
                {"key": "authorization", "value": "must-not-be-stored"},
            ]
        )
        snapshot["media"] = [{"dataUrl": "data:image/png;base64,not-stored"}]
        status, body, post_headers = self.request(
            "POST", "/api/sync", payload=snapshot, authorized=True
        )
        self.assertEqual(200, status)
        self.assertTrue(body["ok"])
        self.assertEqual(
            [
                "aiApiKey",
                "authorization",
                "lastSyncAt",
                "openaiKey",
                "syncSecret",
                "syncUrl",
            ],
            body["strippedSettings"],
        )
        self.assertEqual(3, body["counts"]["settings"])
        self.assertFalse(body["unchanged"])
        self.assertEqual(1, body["serverRevision"])
        self.assertEqual(f'"{body["payloadSha256"]}"', post_headers["ETag"])
        expected_request = json.dumps(snapshot, ensure_ascii=False).encode("utf-8")
        self.assertEqual(hashlib.sha256(expected_request).hexdigest(), body["requestSha256"])

        status, body, get_headers = self.request("GET", "/api/snapshot", authorized=True)
        self.assertEqual(200, status)
        stored = body["snapshot"]
        self.assertEqual(
            [
                {"key": "startDate", "value": "2026-09-07"},
                {"key": "aiProvider", "value": "claude"},
                {"key": "aiModel", "value": "claude-test"},
            ],
            stored["settings"],
        )
        self.assertNotIn("media", stored)
        self.assertNotIn("must-not-be-stored", json.dumps(stored))
        self.assertEqual(snapshot_state_sha256(stored), body["payloadSha256"])
        self.assertEqual(post_headers["ETag"], get_headers["ETag"])

    def test_sensitive_field_outside_settings_rejects_entire_payload(self) -> None:
        snapshot = make_snapshot()
        snapshot["workoutLogs"][0]["accessToken"] = "must-not-be-stored"
        status, body, _ = self.request(
            "POST", "/api/sync", payload=snapshot, authorized=True
        )
        self.assertEqual(422, status)
        self.assertEqual("sensitive_fields", body["error"])
        self.assertEqual(["$.workoutLogs[0].accessToken"], body["fields"])

        status, body, _ = self.request("GET", "/api/snapshot", authorized=True)
        self.assertEqual(404, status)
        self.assertEqual("snapshot_not_found", body["error"])

    def test_secret_shaped_extra_field_inside_setting_is_stripped(self) -> None:
        snapshot = make_snapshot()
        snapshot["settings"] = [
            {"key": "startDate", "value": "2026-09-07", "private_key": "must-not-be-stored"}
        ]
        status, body, _ = self.request(
            "POST", "/api/sync", payload=snapshot, authorized=True
        )
        self.assertEqual(200, status)
        self.assertEqual(["startDate"], body["strippedSettings"])
        self.assertEqual(0, body["counts"]["settings"])

        status, body, _ = self.request("GET", "/api/snapshot", authorized=True)
        self.assertEqual(200, status)
        self.assertEqual([], body["snapshot"]["settings"])
        self.assertNotIn("must-not-be-stored", json.dumps(body["snapshot"]))

    def test_media_disguised_as_a_safe_setting_value_is_stripped(self) -> None:
        snapshot = make_snapshot()
        snapshot["settings"] = [
            {
                "key": "aiModel",
                "value": {"innocentName": "data:image/png;base64,must-not-be-stored"},
            }
        ]
        status, body, _ = self.request(
            "POST", "/api/sync", payload=snapshot, authorized=True
        )
        self.assertEqual(200, status)
        self.assertEqual(["aiModel"], body["strippedSettings"])
        self.assertEqual(0, body["counts"]["settings"])

        status, body, _ = self.request("GET", "/api/snapshot", authorized=True)
        self.assertEqual(200, status)
        self.assertNotIn("must-not-be-stored", json.dumps(body["snapshot"]))

    def test_latest_snapshot_is_upserted_and_repeat_is_idempotent(self) -> None:
        first = make_snapshot("first")
        status, first_response, first_headers = self.request(
            "POST", "/api/sync", payload=first, authorized=True
        )
        self.assertEqual(200, status)
        self.assertEqual(1, first_response["serverRevision"])

        second = make_snapshot("second")
        second["exportedAt"] = "2026-09-03T10:01:00.000Z"
        status, second_response, second_headers = self.request(
            "POST",
            "/api/sync",
            payload=second,
            authorized=True,
            extra_headers={"If-Match": first_headers["ETag"]},
        )
        self.assertEqual(200, status)
        self.assertFalse(second_response["unchanged"])
        self.assertNotEqual(first_response["payloadSha256"], second_response["payloadSha256"])
        self.assertEqual(2, second_response["serverRevision"])

        status, stored_response, _ = self.request("GET", "/api/snapshot", authorized=True)
        self.assertEqual(200, status)
        self.assertEqual("second", stored_response["snapshot"]["workoutLogs"][0]["marker"])

        same_state_new_export = dict(second)
        same_state_new_export["exportedAt"] = "2026-09-03T10:02:00.000Z"
        status, repeat_response, repeat_headers = self.request(
            "POST", "/api/sync", payload=same_state_new_export, authorized=True
        )
        self.assertEqual(200, status)
        self.assertTrue(repeat_response["unchanged"])
        self.assertEqual(second_response["updatedAt"], repeat_response["updatedAt"])
        self.assertEqual(2, repeat_response["serverRevision"])
        self.assertEqual(second_headers["ETag"], repeat_headers["ETag"])

    def test_changed_snapshot_requires_current_etag(self) -> None:
        status, first, first_headers = self.request(
            "POST", "/api/sync", payload=make_snapshot("first"), authorized=True
        )
        self.assertEqual(200, status)

        changed = make_snapshot("changed")
        status, body, headers = self.request(
            "POST", "/api/sync", payload=changed, authorized=True
        )
        self.assertEqual(428, status)
        self.assertEqual("precondition_required", body["error"])
        self.assertEqual(first["payloadSha256"], body["currentPayloadSha256"])
        self.assertEqual(first_headers["ETag"], headers["ETag"])

        status, body, headers = self.request(
            "POST",
            "/api/sync",
            payload=changed,
            authorized=True,
            extra_headers={"If-Match": f'"{"0" * 64}"'},
        )
        self.assertEqual(412, status)
        self.assertEqual("precondition_failed", body["error"])
        self.assertEqual(first_headers["ETag"], headers["ETag"])

        status, body, _ = self.request(
            "POST",
            "/api/sync",
            payload=changed,
            authorized=True,
            extra_headers={"If-Match": "not-an-etag"},
        )
        self.assertEqual(400, status)
        self.assertEqual("invalid_if_match", body["error"])

    def test_stale_browser_etag_can_bootstrap_an_empty_database(self) -> None:
        status, body, headers = self.request(
            "POST",
            "/api/sync",
            payload=make_snapshot("restored-local"),
            authorized=True,
            extra_headers={"If-Match": f'"{"f" * 64}"'},
        )
        self.assertEqual(200, status)
        self.assertFalse(body["unchanged"])
        self.assertEqual(1, body["serverRevision"])
        self.assertEqual(f'"{body["payloadSha256"]}"', headers["ETag"])

    def test_delayed_old_request_cannot_overwrite_new_snapshot(self) -> None:
        old = make_snapshot("old")
        status, _, old_headers = self.request(
            "POST", "/api/sync", payload=old, authorized=True
        )
        self.assertEqual(200, status)

        new = make_snapshot("new")
        new["exportedAt"] = "2026-09-03T10:01:00.000Z"
        status, _, new_headers = self.request(
            "POST",
            "/api/sync",
            payload=new,
            authorized=True,
            extra_headers={"If-Match": old_headers["ETag"]},
        )
        self.assertEqual(200, status)

        status, body, headers = self.request(
            "POST",
            "/api/sync",
            payload=old,
            authorized=True,
            extra_headers={"If-Match": old_headers["ETag"]},
        )
        self.assertEqual(412, status)
        self.assertEqual("precondition_failed", body["error"])
        self.assertEqual(new_headers["ETag"], headers["ETag"])

        status, latest, _ = self.request("GET", "/api/snapshot", authorized=True)
        self.assertEqual(200, status)
        self.assertEqual("new", latest["snapshot"]["workoutLogs"][0]["marker"])

    def test_concurrent_identical_first_writes_have_one_mutation(self) -> None:
        snapshot = make_snapshot("parallel")

        def write_once(_: int) -> dict:
            return self.server.store.upsert("parallel-user", snapshot, None)

        with ThreadPoolExecutor(max_workers=20) as executor:
            results = list(executor.map(write_once, range(20)))

        self.assertEqual(1, sum(not result["unchanged"] for result in results))
        self.assertEqual({1}, {result["serverRevision"] for result in results})

    def test_unknown_top_level_and_nested_binary_fields_are_rejected(self) -> None:
        unknown = make_snapshot()
        unknown["metadata"] = {"source": "unexpected"}
        status, body, _ = self.request(
            "POST", "/api/sync", payload=unknown, authorized=True
        )
        self.assertEqual(422, status)
        self.assertEqual("invalid_snapshot", body["error"])

        nested_binary = make_snapshot()
        nested_binary["exerciseNotes"] = [
            {"id": 1, "exerciseId": "w1-mon-pullup", "dataUrl": "data:image/png;base64,x"}
        ]
        status, body, _ = self.request(
            "POST", "/api/sync", payload=nested_binary, authorized=True
        )
        self.assertEqual(422, status)
        self.assertEqual("binary_fields", body["error"])
        self.assertEqual(["$.exerciseNotes[0].dataUrl"], body["fields"])

        disguised_data_url = make_snapshot()
        disguised_data_url["exerciseNotes"] = [
            {"id": 1, "exerciseId": "w1-mon-pullup", "innocent": "data:image/png;base64,x"}
        ]
        status, body, _ = self.request(
            "POST", "/api/sync", payload=disguised_data_url, authorized=True
        )
        self.assertEqual(422, status)
        self.assertEqual("binary_fields", body["error"])
        self.assertEqual(["$.exerciseNotes[0].innocent"], body["fields"])

        minimal_data_url = make_snapshot()
        minimal_data_url["exerciseNotes"] = [
            {"id": 1, "exerciseId": "w1-mon-pullup", "innocent": "data:,payload"}
        ]
        status, body, _ = self.request(
            "POST", "/api/sync", payload=minimal_data_url, authorized=True
        )
        self.assertEqual(422, status)
        self.assertEqual("binary_fields", body["error"])
        self.assertEqual(["$.exerciseNotes[0].innocent"], body["fields"])

        long_header_data_url = make_snapshot()
        long_header_data_url["exerciseNotes"] = [
            {
                "id": 1,
                "exerciseId": "w1-mon-pullup",
                "innocent": f"data:{'a' * 300},payload",
            }
        ]
        status, body, _ = self.request(
            "POST", "/api/sync", payload=long_header_data_url, authorized=True
        )
        self.assertEqual(422, status)
        self.assertEqual("binary_fields", body["error"])
        self.assertEqual(["$.exerciseNotes[0].innocent"], body["fields"])

    def test_invalid_json_shape_and_media_type_are_rejected(self) -> None:
        status, body, _ = self.request(
            "POST",
            "/api/sync",
            raw_body=b"{not-json",
            authorized=True,
        )
        self.assertEqual(400, status)
        self.assertEqual("invalid_json", body["error"])

        status, body, _ = self.request(
            "POST",
            "/api/sync",
            raw_body=b"{}",
            authorized=True,
            content_type="text/plain",
        )
        self.assertEqual(415, status)
        self.assertEqual("unsupported_media_type", body["error"])

        invalid_shape = make_snapshot()
        invalid_shape["bodyMetrics"] = {}
        status, body, _ = self.request(
            "POST", "/api/sync", payload=invalid_shape, authorized=True
        )
        self.assertEqual(422, status)
        self.assertEqual("invalid_snapshot", body["error"])

    def test_request_larger_than_five_megabytes_is_rejected_before_body_read(self) -> None:
        connection = http.client.HTTPConnection(self.host, self.port, timeout=3)
        connection.putrequest("POST", "/api/sync")
        connection.putheader("Authorization", f"Bearer {SECRET}")
        connection.putheader("Origin", ORIGIN)
        connection.putheader("Content-Type", "application/json")
        connection.putheader("Content-Length", str(MAX_BODY_BYTES + 1))
        connection.endheaders()
        response = connection.getresponse()
        body = json.loads(response.read().decode("utf-8"))
        connection.close()
        self.assertEqual(413, response.status)
        self.assertEqual("payload_too_large", body["error"])

    def test_representative_three_hundred_kibibyte_snapshot_round_trip(self) -> None:
        snapshot = make_snapshot()
        snapshot["settings"] = [{"key": "startDate", "value": "2026-09-07"}]
        snapshot["exerciseNotes"] = [
            {"id": 1, "exerciseId": "w1-mon-pullup", "text": "动作记录" * 38_000}
        ]
        encoded_size = len(json.dumps(snapshot, ensure_ascii=False).encode("utf-8"))
        self.assertGreater(encoded_size, 300 * 1024)
        self.assertLess(encoded_size, MAX_BODY_BYTES)

        status, posted, _ = self.request(
            "POST", "/api/sync", payload=snapshot, authorized=True
        )
        self.assertEqual(200, status)
        self.assertEqual(1, posted["counts"]["exerciseNotes"])

        status, fetched, _ = self.request("GET", "/api/snapshot", authorized=True)
        self.assertEqual(200, status)
        self.assertEqual(snapshot["exerciseNotes"], fetched["snapshot"]["exerciseNotes"])

    def test_unknown_endpoint_is_not_found(self) -> None:
        status, body, _ = self.request("GET", "/api/unknown", authorized=True)
        self.assertEqual(404, status)
        self.assertEqual("not_found", body["error"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
