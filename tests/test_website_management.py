"""Integration tests for authenticated website registration and ownership."""

from __future__ import annotations

import hashlib
import http.client
import http.cookiejar
import json
import os
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import HTTPCookieProcessor, Request, build_opener
from uuid import uuid4


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = PROJECT_ROOT / "backend"


class WebsiteManagementTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.temp_dir = tempfile.TemporaryDirectory(prefix="apisentinel-website-tests-")
        cls.database_path = Path(cls.temp_dir.name) / "website-tests.db"
        cls._create_legacy_event_row(cls.database_path)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            cls.port = sock.getsockname()[1]
        cls.base_url = f"http://127.0.0.1:{cls.port}"
        environment = os.environ.copy()
        environment["DATABASE_URL"] = f"sqlite:///{cls.database_path}"
        environment["DYLD_LIBRARY_PATH"] = str(PROJECT_ROOT / "vendor" / "libomp")
        environment["APISENTINEL_INGEST_RATE_LIMIT"] = "3"
        environment["APISENTINEL_LOGIN_RATE_LIMIT"] = "3"
        cls.server = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "main:app",
                "--host",
                "127.0.0.1",
                "--port",
                str(cls.port),
                "--log-level",
                "error",
            ],
            cwd=BACKEND_DIR,
            env=environment,
            stdout=subprocess.DEVNULL,
            stderr=None,
        )
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            if cls.server.poll() is not None:
                raise RuntimeError("Test FastAPI server exited before becoming ready.")
            try:
                cls.request(build_opener(), "GET", "/health")
                break
            except (URLError, TimeoutError):
                time.sleep(0.2)
        else:
            cls.server.terminate()
            raise RuntimeError("Timed out waiting for the isolated FastAPI test server.")

    @staticmethod
    def _create_legacy_event_row(database_path: Path) -> None:
        received_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat(sep=" ")
        with sqlite3.connect(database_path) as connection:
            connection.execute(
                """CREATE TABLE monitoring_events (
                    id VARCHAR(36) PRIMARY KEY,
                    website_id VARCHAR(36) NOT NULL,
                    owner_user_id VARCHAR(36) NOT NULL,
                    event_timestamp DATETIME NOT NULL,
                    received_at DATETIME NOT NULL,
                    method VARCHAR(10) NOT NULL,
                    endpoint VARCHAR(512) NOT NULL,
                    response_status INTEGER NOT NULL,
                    request_duration_ms FLOAT NOT NULL,
                    request_size_bytes INTEGER NOT NULL,
                    features JSON,
                    actor_id VARCHAR(128),
                    scoring_status VARCHAR(32) NOT NULL
                )"""
            )
            connection.execute(
                """INSERT INTO monitoring_events (
                    id, website_id, owner_user_id, event_timestamp, received_at,
                    method, endpoint, response_status, request_duration_ms,
                    request_size_bytes, scoring_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    "legacy-event-before-d2",
                    "legacy-website",
                    "legacy-owner",
                    "2026-10-18 00:00:00",
                    received_at,
                    "GET",
                    "/legacy",
                    200,
                    1.0,
                    0,
                    "Not Scored",
                ),
            )

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.terminate()
        try:
            cls.server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            cls.server.kill()
            cls.server.wait(timeout=10)
        cls.temp_dir.cleanup()

    @classmethod
    def request(
        cls,
        opener,
        method: str,
        path: str,
        payload: dict | None = None,
        csrf: str | None = None,
        extra_headers: dict[str, str] | None = None,
        response_headers: dict[str, str] | None = None,
        raw_body: bytes | None = None,
    ) -> tuple[int, object]:
        headers = {"Accept": "application/json"}
        if payload is not None and raw_body is not None:
            raise ValueError("Provide either a JSON payload or a raw request body, not both.")
        data = raw_body
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
        if data is not None:
            headers["Content-Type"] = "application/json"
        if csrf:
            headers["X-CSRF-Token"] = csrf
        if extra_headers:
            headers.update(extra_headers)
        request = Request(
            f"{cls.base_url}{path}",
            data=data,
            headers=headers,
            method=method,
        )
        try:
            with opener.open(request, timeout=10) as response:
                body = response.read()
                if response_headers is not None:
                    response_headers.update(
                        {name.lower(): value for name, value in response.headers.items()}
                    )
                return response.status, json.loads(body) if body else None
        except HTTPError as error:
            body = error.read()
            if response_headers is not None:
                response_headers.update(
                    {name.lower(): value for name, value in error.headers.items()}
                )
            return error.code, json.loads(body) if body else None

    @classmethod
    def new_client(cls) -> tuple[object, str]:
        opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
        status, session_data = cls.request(opener, "GET", "/auth/session")
        if status != 200:
            raise AssertionError(f"Could not bootstrap session: HTTP {status}")
        return opener, session_data["csrf_token"]

    @classmethod
    def register_user(cls, email: str) -> tuple[object, str]:
        opener, csrf = cls.new_client()
        status, response = cls.request(
            opener,
            "POST",
            "/auth/register",
            {
                "full_name": "Website Test User",
                "email": email,
                "password": "Website-Test-Password-42!",
                "confirm_password": "Website-Test-Password-42!",
            },
            csrf,
        )
        if status != 200:
            raise AssertionError(f"Could not register isolated test user: HTTP {status}: {response}")
        return opener, response["csrf_token"]

    def create_website(self, opener, csrf: str, **overrides) -> tuple[int, object]:
        data = {
            "name": "My Test API",
            "base_url": " HTTPS://Example.COM:443/store/ ",
            "description": "Owned test service",
            "integration_type": "fastapi",
        }
        data.update(overrides)
        return self.request(opener, "POST", "/websites", data, csrf)

    def create_site_and_credential(self, email: str):
        client, csrf = self.register_user(email)
        status, website = self.create_website(client, csrf)
        self.assertEqual(status, 201)
        status, credential = self.request(
            client,
            "POST",
            f"/websites/{website['id']}/integration/credentials",
            {},
            csrf,
        )
        self.assertEqual(status, 201)
        return client, csrf, website, credential["credential"]

    def send_event(self, credential: str, payload: dict | None = None):
        event_payload = payload.copy() if payload is not None else {
            "event_id": str(uuid4()),
            "schema_version": "1",
            "event_timestamp": "2026-10-17T01:00:00Z",
            "method": "GET",
            "endpoint": "/api/orders/{order_id}",
            "response_status": 200,
            "request_duration_ms": 18.4,
            "request_size_bytes": 0,
            "actor_id": "anon-session-9f03",
            "features": {"url_len": 22, "payload_entropy": 0.5},
        }
        event_payload.setdefault("event_id", str(uuid4()))
        return self.request(
            build_opener(),
            "POST",
            "/monitoring/events",
            event_payload,
            extra_headers={"X-APISentinel-Integration-Key": credential},
        )

    @staticmethod
    def valid_event(event_id: str) -> dict:
        return {
            "schema_version": "1",
            "event_id": event_id,
            "event_timestamp": "2001-01-01T05:30:00+05:30",
            "method": "GET",
            "endpoint": "/api/items",
            "response_status": 200,
            "request_duration_ms": 1.5,
            "request_size_bytes": 20,
            "features": {
                "payload_len": 2,
                "url_len": 14,
                "param_count": 1,
                "special_char_count": 0,
                "digit_count": 0,
                "encoded_char_count": 0,
                "path_depth": 2,
                "payload_entropy": 1.0,
            },
        }

    @staticmethod
    def attack_like_features() -> dict[str, float]:
        return {
            "payload_len": 1000,
            "url_len": 500,
            "param_count": 20,
            "special_char_count": 100,
            "digit_count": 100,
            "encoded_char_count": 50,
            "path_depth": 20,
            "payload_entropy": 7.0,
        }

    def test_unauthenticated_requests_are_rejected(self) -> None:
        anonymous = build_opener()
        self.assertEqual(self.request(anonymous, "GET", "/websites")[0], 401)
        self.assertEqual(
            self.request(
                anonymous,
                "POST",
                "/websites",
                {
                    "name": "No session",
                    "base_url": "https://example.test",
                    "integration_type": "manual",
                },
            )[0],
            401,
        )

    def test_login_rejects_invalid_password(self) -> None:
        self.register_user("invalid-password@example.test")
        anonymous, csrf = self.new_client()

        status, response = self.request(
            anonymous,
            "POST",
            "/auth/login",
            {"email": "invalid-password@example.test", "password": "Incorrect-Password-42!"},
            csrf,
        )

        self.assertEqual(status, 401)
        self.assertEqual(response["detail"], "Email or password is incorrect.")
        self.assertEqual(self.request(anonymous, "GET", "/websites")[0], 401)

    def test_login_rejects_unknown_account(self) -> None:
        anonymous, csrf = self.new_client()

        status, response = self.request(
            anonymous,
            "POST",
            "/auth/login",
            {"email": "unknown-account@example.test", "password": "Unknown-Password-42!"},
            csrf,
        )

        self.assertEqual(status, 401)
        self.assertEqual(response["detail"], "Email or password is incorrect.")
        self.assertEqual(self.request(anonymous, "GET", "/websites")[0], 401)

    def test_login_rate_limit_is_scoped_to_account_and_source(self) -> None:
        self.register_user("rate-limited@example.test")
        self.register_user("unaffected@example.test")
        anonymous, csrf = self.new_client()

        for _ in range(3):
            status, response = self.request(
                anonymous,
                "POST",
                "/auth/login",
                {"email": "rate-limited@example.test", "password": "Incorrect-Password-42!"},
                csrf,
            )
            self.assertEqual(status, 401)
            self.assertEqual(response["detail"], "Email or password is incorrect.")

        limited_headers: dict[str, str] = {}
        limited_status, limited_response = self.request(
            anonymous,
            "POST",
            "/auth/login",
            {
                "email": "rate-limited@example.test",
                "password": "Website-Test-Password-42!",
            },
            csrf,
            response_headers=limited_headers,
        )
        self.assertEqual(limited_status, 429)
        self.assertGreaterEqual(int(limited_headers["retry-after"]), 1)
        self.assertEqual(
            limited_response["detail"],
            "Too many login attempts. Try again later.",
        )
        self.assertEqual(self.request(anonymous, "GET", "/websites")[0], 401)

        other_status, other_session = self.request(
            anonymous,
            "POST",
            "/auth/login",
            {"email": "unaffected@example.test", "password": "Website-Test-Password-42!"},
            csrf,
        )
        self.assertEqual(other_status, 200)
        self.assertEqual(other_session["user"]["email"], "unaffected@example.test")

    def test_manual_prediction_request_size_and_string_limits(self) -> None:
        client, csrf = self.register_user("request-size-limits@example.test")
        request_url = "/" + "u" * (8_192 - 1)
        request_payload = "x" * (256 * 1024 - 1)

        status, _ = self.request(
            client,
            "POST",
            "/predict",
            {"method": "GET", "url": request_url, "payload": request_payload},
            csrf,
        )
        self.assertEqual(status, 200)

        invalid_cases = (
            ("url", {"method": "GET", "url": "/" + "u" * 8_192, "payload": ""}),
            ("payload", {"method": "GET", "url": "/", "payload": "x" * (256 * 1024 + 1)}),
        )
        for field_name, body in invalid_cases:
            with self.subTest(field=field_name):
                status, response = self.request(
                    client,
                    "POST",
                    "/predict",
                    body,
                    csrf,
                )
                self.assertEqual(status, 422)
                self.assertIn("detail", response)

        valid_json = json.dumps(
            {"method": "GET", "url": "/size-boundary", "payload": ""},
            separators=(",", ":"),
        ).encode("utf-8")
        accepted_body = valid_json + b" " * (512 * 1024 - 1 - len(valid_json))
        accepted_status, _ = self.request(
            client,
            "POST",
            "/predict",
            csrf=csrf,
            raw_body=accepted_body,
        )
        self.assertEqual(accepted_status, 200)

        cookie_processor = next(
            handler for handler in client.handlers if isinstance(handler, HTTPCookieProcessor)
        )
        cookie_header = "; ".join(
            f"{cookie.name}={cookie.value}" for cookie in cookie_processor.cookiejar
        )
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        connection.putrequest("POST", "/predict")
        connection.putheader("Content-Type", "application/json")
        connection.putheader("Content-Length", str(512 * 1024 + 1))
        connection.putheader("Cookie", cookie_header)
        connection.putheader("X-CSRF-Token", csrf)
        connection.endheaders()
        length_response = connection.getresponse()
        length_status = length_response.status
        rejected_response = json.loads(length_response.read())
        connection.close()
        self.assertEqual(length_status, 413)
        self.assertEqual(
            rejected_response["detail"],
            "Prediction request exceeds the 512 KiB request size limit.",
        )

        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        connection.putrequest("POST", "/predict")
        connection.putheader("Content-Type", "application/json")
        connection.putheader("Transfer-Encoding", "chunked")
        connection.putheader("Cookie", cookie_header)
        connection.putheader("X-CSRF-Token", csrf)
        connection.endheaders()
        oversized_chunk = b" " * (512 * 1024 + 1)
        connection.send(f"{len(oversized_chunk):X}\r\n".encode("ascii"))
        connection.send(oversized_chunk + b"\r\n")
        chunked_response = connection.getresponse()
        chunked_status = chunked_response.status
        chunked_body = json.loads(chunked_response.read())
        connection.close()
        self.assertEqual(chunked_status, 413)
        self.assertEqual(
            chunked_body["detail"],
            "Prediction request exceeds the 512 KiB request size limit.",
        )

    def test_authenticated_prediction_still_uses_existing_model_workflow(self) -> None:
        client, csrf = self.register_user("prediction@example.test")
        status, result = self.request(
            client,
            "POST",
            "/predict",
            {"method": "GET", "url": "/stage-b-regression", "payload": ""},
            csrf,
        )
        self.assertEqual(status, 200)
        self.assertEqual(result["prediction"], "normal")
        self.assertEqual(result["class_id"], 0)
        self.assertAlmostEqual(result["confidence"], 0.9857472777366638, places=6)
        self.assertAlmostEqual(
            result["probabilities"]["anomalous"],
            0.014252728782594204,
            places=6,
        )
        self.assertEqual(set(result["features"]), {
            "payload_len",
            "url_len",
            "param_count",
            "special_char_count",
            "digit_count",
            "encoded_char_count",
            "path_depth",
            "payload_entropy",
        })
        feature_status, feature_result = self.request(
            client,
            "POST",
            "/predict-features",
            result["features"],
            csrf,
        )
        self.assertEqual(feature_status, 200)
        for field in ("prediction", "class_id", "confidence", "probabilities", "features"):
            self.assertEqual(feature_result[field], result[field])
        status, history = self.request(client, "GET", "/history?limit=1")
        self.assertEqual(status, 200)
        self.assertEqual(history["total"], 1)
        self.assertEqual(history["items"][0]["url"], "/stage-b-regression")

    def test_suspicious_request_is_saved_in_history_with_owned_reviewable_alert(self) -> None:
        owner, csrf = self.register_user("suspicious-request-owner@example.test")
        other_user, other_csrf = self.register_user("suspicious-request-other@example.test")

        status, prediction = self.request(
            owner,
            "POST",
            "/predict",
            {
                "method": "POST",
                "url": "/api/search?q=1",
                "payload": "<script>alert(1)</script>",
            },
            csrf,
        )

        self.assertEqual(status, 200)
        self.assertEqual(prediction["prediction"], "anomalous")
        self.assertEqual(prediction["class_id"], 1)
        self.assertEqual(prediction["method"], "POST")
        self.assertEqual(prediction["url"], "/api/search?q=1")

        history_status, history = self.request(
            owner,
            "GET",
            "/history?classification=anomalous",
        )
        self.assertEqual(history_status, 200)
        self.assertEqual(history["total"], 1)
        stored_prediction = history["items"][0]
        self.assertEqual(stored_prediction["prediction"], "anomalous")
        self.assertEqual(stored_prediction["url"], "/api/search?q=1")
        self.assertEqual(stored_prediction["method"], prediction["method"])
        self.assertEqual(stored_prediction["class_id"], prediction["class_id"])
        self.assertEqual(stored_prediction["confidence"], prediction["confidence"])

        alerts_status, alerts = self.request(owner, "GET", "/alerts")
        self.assertEqual(alerts_status, 200)
        self.assertEqual(alerts["total"], 1)
        alert = alerts["items"][0]
        self.assertEqual(alert["prediction_id"], stored_prediction["id"])
        self.assertEqual(alert["prediction"]["prediction"], "anomalous")
        self.assertEqual(alert["review_status"], "New")
        with sqlite3.connect(self.database_path) as connection:
            owner_id = connection.execute(
                "SELECT id FROM users WHERE email = ?",
                ("suspicious-request-owner@example.test",),
            ).fetchone()[0]
            stored_owner = connection.execute(
                "SELECT user_id FROM prediction_records WHERE id = ?",
                (stored_prediction["id"],),
            ).fetchone()[0]
            alert_owner = connection.execute(
                "SELECT user_id FROM alerts WHERE id = ?",
                (alert["id"],),
            ).fetchone()[0]
        self.assertEqual(stored_owner, owner_id)
        self.assertEqual(alert_owner, owner_id)

        update_payload = {
            "review_status": "Under Review",
            "analyst_notes": "Reviewed suspicious request indicators.",
        }
        denied_status, denied_response = self.request(
            other_user,
            "PATCH",
            f"/alerts/{alert['id']}",
            update_payload,
            other_csrf,
        )
        self.assertEqual(denied_status, 404)
        self.assertEqual(denied_response["detail"], "Alert not found.")

        update_status, updated_alert = self.request(
            owner,
            "PATCH",
            f"/alerts/{alert['id']}",
            update_payload,
            csrf,
        )
        self.assertEqual(update_status, 200)
        self.assertEqual(updated_alert["id"], alert["id"])
        self.assertEqual(updated_alert["prediction_id"], stored_prediction["id"])
        self.assertEqual(updated_alert["review_status"], "Under Review")
        self.assertEqual(updated_alert["analyst_notes"], update_payload["analyst_notes"])

    def test_website_crud_and_soft_removal(self) -> None:
        client, csrf = self.register_user("crud@example.test")
        self.assertEqual(self.create_website(client, "")[0], 403)
        status, website = self.create_website(client, csrf)
        self.assertEqual(status, 201)
        self.assertEqual(website["base_url"], "https://example.com/store")
        self.assertEqual(website["connection_status"], "Not Connected")
        self.assertNotIn("user_id", website)

        status, websites = self.request(client, "GET", "/websites")
        self.assertEqual(status, 200)
        self.assertEqual(len(websites), 1)
        website_id = website["id"]
        self.assertEqual(self.request(client, "GET", f"/websites/{website_id}")[0], 200)

        status, updated = self.request(
            client,
            "PATCH",
            f"/websites/{website_id}",
            {"name": "Updated API", "description": ""},
            csrf,
        )
        self.assertEqual(status, 200)
        self.assertEqual(updated["name"], "Updated API")
        self.assertEqual(updated["description"], "")
        self.assertEqual(updated["connection_status"], "Not Connected")

        self.assertEqual(
            self.request(
                client,
                "PATCH",
                f"/websites/{website_id}",
                {"connection_status": "Connected"},
                csrf,
            )[0],
            422,
        )
        self.assertEqual(self.request(client, "DELETE", f"/websites/{website_id}", csrf=csrf)[0], 200)
        self.assertEqual(self.request(client, "GET", "/websites")[1], [])
        self.assertEqual(self.request(client, "GET", f"/websites/{website_id}")[0], 404)

        with sqlite3.connect(self.database_path) as connection:
            stored_count, deleted_count = connection.execute(
                "SELECT COUNT(*), SUM(deleted_at IS NOT NULL) FROM websites WHERE id = ?",
                (website_id,),
            ).fetchone()
        self.assertEqual(stored_count, 1)
        self.assertEqual(deleted_count, 1)

    def test_websites_are_isolated_between_users(self) -> None:
        owner, owner_csrf = self.register_user("owner@example.test")
        other_user, other_csrf = self.register_user("other@example.test")
        status, website = self.create_website(owner, owner_csrf)
        self.assertEqual(status, 201)
        website_id = website["id"]

        self.assertEqual(self.request(other_user, "GET", "/websites")[1], [])
        self.assertEqual(self.request(other_user, "GET", f"/websites/{website_id}")[0], 404)
        self.assertEqual(
            self.request(
                other_user,
                "PATCH",
                f"/websites/{website_id}",
                {"name": "Takeover"},
                other_csrf,
            )[0],
            404,
        )
        self.assertEqual(
            self.request(other_user, "DELETE", f"/websites/{website_id}", csrf=other_csrf)[0],
            404,
        )
        self.assertEqual(self.request(owner, "GET", f"/websites/{website_id}")[0], 200)

    def test_website_urls_are_validated_without_network_requests(self) -> None:
        client, csrf = self.register_user("urls@example.test")
        invalid_urls = [
            "ftp://example.test",
            "https://user:password@example.test",
            "https://example.test/path?token=value",
            "https://example.test/path#fragment",
            "https://bad host.test",
            "https://example.test:99999",
            "javascript:alert(1)",
        ]
        for value in invalid_urls:
            with self.subTest(base_url=value):
                self.assertEqual(
                    self.create_website(client, csrf, base_url=value)[0],
                    422,
                )
        self.assertEqual(self.create_website(client, csrf, base_url="http://127.0.0.1:9000/api/")[0], 201)

    def test_integration_credentials_are_hashed_rotatable_and_revocable(self) -> None:
        client, csrf, website, first_credential = self.create_site_and_credential("keys@example.test")
        website_path = f"/websites/{website['id']}"
        self.assertTrue(first_credential.startswith("aps_live_"))
        self.assertGreaterEqual(len(first_credential), 50)
        self.assertTrue(self.request(client, "GET", website_path)[1]["credential_active"])
        self.assertEqual(self.request(client, "GET", website_path)[1]["connection_status"], "Not Connected")

        with sqlite3.connect(self.database_path) as connection:
            stored_hash = connection.execute(
                "SELECT credential_hash FROM website_integrations WHERE website_id = ?",
                (website["id"],),
            ).fetchone()[0]
        import hashlib
        self.assertEqual(stored_hash, hashlib.sha256(first_credential.encode()).hexdigest())
        self.assertNotEqual(stored_hash, first_credential)

        self.assertEqual(
            self.request(
                client,
                "POST",
                f"{website_path}/integration/credentials",
                {},
            )[0],
            403,
        )
        self.assertEqual(
            self.request(
                client,
                "POST",
                f"{website_path}/integration/credentials",
                {},
                csrf,
            )[0],
            409,
        )
        status, rotated = self.request(
            client,
            "POST",
            f"{website_path}/integration/credentials/rotate",
            {},
            csrf,
        )
        self.assertEqual(status, 200)
        second_credential = rotated["credential"]
        self.assertNotEqual(first_credential, second_credential)
        self.assertEqual(self.send_event(first_credential)[0], 401)
        self.assertEqual(self.send_event(second_credential)[0], 200)

        status, response = self.request(
            client,
            "POST",
            f"{website_path}/integration/credentials/revoke",
            {},
            csrf,
        )
        self.assertEqual(status, 200)
        self.assertEqual(response, {"ok": True})
        self.assertEqual(self.send_event(second_credential)[0], 401)
        website_state = self.request(client, "GET", website_path)[1]
        self.assertFalse(website_state["credential_active"])
        self.assertEqual(website_state["connection_status"], "Disconnected")
        self.assertEqual(self.send_event("aps_live_invalid")[0], 401)

    def test_events_persist_and_are_scoped_by_credential_not_sender_fields(self) -> None:
        client_a, _, website_a, credential_a = self.create_site_and_credential("event-owner-a@example.test")
        client_b, _, website_b, credential_b = self.create_site_and_credential("event-owner-b@example.test")

        status, response = self.send_event(credential_a)
        self.assertEqual(status, 200)
        self.assertTrue(response["accepted"])
        self.assertEqual(response["scoring_status"], "Not Scored")
        self.assertNotIn("website_id", response)

        status, _ = self.send_event(
            credential_a,
            {
                "schema_version": "1",
                "event_timestamp": "2026-10-17T01:00:00Z",
                "method": "POST",
                "endpoint": "/api/cart",
                "response_status": 201,
                "request_duration_ms": 7,
                "request_size_bytes": 12,
                "website_id": website_b["id"],
                "user_id": "attacker-selected-user",
            },
        )
        self.assertEqual(status, 422)

        status, _ = self.send_event(credential_b, {
            "schema_version": "1",
            "event_timestamp": "2026-10-17T01:00:00Z",
            "method": "POST",
            "endpoint": "/api/cart",
            "response_status": 201,
            "request_duration_ms": 7,
            "request_size_bytes": 12,
        })
        self.assertEqual(status, 200)

        with sqlite3.connect(self.database_path) as connection:
            rows = connection.execute(
                "SELECT website_id, owner_user_id, endpoint, features, actor_id, scoring_status FROM monitoring_events WHERE website_id IN (?, ?) ORDER BY received_at",
                (website_a["id"], website_b["id"]),
            ).fetchall()
            credentials = connection.execute(
                "SELECT credential_hash FROM website_integrations WHERE website_id IN (?, ?) ORDER BY created_at",
                (website_a["id"], website_b["id"]),
            ).fetchall()
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0][0], website_a["id"])
        self.assertNotEqual(rows[0][1], rows[1][1])
        self.assertEqual(rows[0][2], "/api/orders/{order_id}")
        self.assertIn('"url_len": 22.0', rows[0][3])
        self.assertEqual(rows[0][4], "anon-session-9f03")
        self.assertEqual(rows[0][5], "Not Scored")
        self.assertNotIn(credential_a.encode().decode(), {row[0] for row in credentials})
        self.assertNotIn(credential_b.encode().decode(), {row[0] for row in credentials})

        state_a = self.request(client_a, "GET", f"/websites/{website_a['id']}")[1]
        state_b = self.request(client_b, "GET", f"/websites/{website_b['id']}")[1]
        self.assertEqual(state_a["connection_status"], "Receiving Events")
        self.assertIsNotNone(state_a["last_event_at"])
        self.assertEqual(state_b["connection_status"], "Receiving Events")

    def test_monitoring_event_list_requires_authentication_and_returns_empty_results(self) -> None:
        status, response = self.request(build_opener(), "GET", "/monitoring/events")
        self.assertEqual(status, 401)
        self.assertEqual(response["detail"], "Authentication required.")

        client, _ = self.register_user("empty-monitor-events@example.test")
        status, response = self.request(client, "GET", "/monitoring/events")
        self.assertEqual(status, 200)
        self.assertEqual(response, {"items": [], "total": 0, "limit": 50, "offset": 0})

    def test_monitoring_event_list_is_owner_scoped_and_omits_unapproved_fields(self) -> None:
        client_a, _, website_a, credential_a = self.create_site_and_credential("monitor-list-a@example.test")
        _, _, website_b, credential_b = self.create_site_and_credential("monitor-list-b@example.test")
        event_a = self.valid_event("owner-a-monitor-event")
        event_b = self.valid_event("owner-b-monitor-event")
        self.assertEqual(self.send_event(credential_a, event_a)[0], 200)
        self.assertEqual(self.send_event(credential_b, event_b)[0], 200)

        status, response = self.request(client_a, "GET", "/monitoring/events")
        self.assertEqual(status, 200)
        self.assertEqual(response["total"], 1)
        self.assertEqual(len(response["items"]), 1)
        item = response["items"][0]
        self.assertEqual(item["event_id"], event_a["event_id"])
        self.assertEqual(item["website_id"], website_a["id"])
        self.assertEqual(item["website_name"], website_a["name"])
        self.assertEqual(item["scoring_status"], "scored")
        self.assertEqual(item["prediction_label"], "normal")
        self.assertIsInstance(item["model_score"], float)
        self.assertNotEqual(item["website_id"], website_b["id"])
        self.assertTrue({
            "id",
            "event_id",
            "website_id",
            "website_name",
            "received_at",
            "event_timestamp",
            "method",
            "endpoint",
            "response_status",
            "request_duration_ms",
            "request_size_bytes",
            "scoring_status",
            "prediction_label",
            "model_score",
            "model_identifier",
        }.issuperset(set(item)))
        for private_field in (
            "owner_user_id",
            "features",
            "actor_id",
            "content_hash",
            "credential_hash",
            "not_scored_reason",
        ):
            self.assertNotIn(private_field, item)

    def test_monitoring_event_list_checks_website_owner(self) -> None:
        client_a, _, website_a, credential_a = self.create_site_and_credential("monitor-filter-a@example.test")
        _, _, website_b, credential_b = self.create_site_and_credential("monitor-filter-b@example.test")
        self.assertEqual(self.send_event(credential_a, self.valid_event("filter-owner-a"))[0], 200)
        self.assertEqual(self.send_event(credential_b, self.valid_event("filter-owner-b"))[0], 200)

        status, response = self.request(
            client_a,
            "GET",
            f"/monitoring/events?website_id={website_a['id']}",
        )
        self.assertEqual(status, 200)
        self.assertEqual(response["total"], 1)
        self.assertEqual(response["items"][0]["website_id"], website_a["id"])

        status, response = self.request(
            client_a,
            "GET",
            f"/monitoring/events?website_id={website_b['id']}",
        )
        self.assertEqual(status, 404)
        self.assertEqual(response["detail"], "Website not found.")

    def test_monitoring_event_list_is_stably_ordered_and_paginated(self) -> None:
        client, _, website, credential = self.create_site_and_credential("monitor-pages@example.test")
        event_ids = ["monitor-page-one", "monitor-page-two", "monitor-page-three"]
        for event_id in event_ids:
            self.assertEqual(self.send_event(credential, self.valid_event(event_id))[0], 200)

        with sqlite3.connect(self.database_path) as connection:
            for event_id, received_at in zip(
                event_ids,
                ("2026-10-18 00:00:01", "2026-10-18 00:00:02", "2026-10-18 00:00:03"),
            ):
                connection.execute(
                    "UPDATE monitoring_events SET received_at = ? WHERE website_id = ? AND event_id = ?",
                    (received_at, website["id"], event_id),
                )

        status, first_page = self.request(
            client,
            "GET",
            f"/monitoring/events?limit=2&offset=0&website_id={website['id']}",
        )
        self.assertEqual(status, 200)
        self.assertEqual(first_page["total"], 3)
        self.assertEqual(first_page["limit"], 2)
        self.assertEqual(first_page["offset"], 0)
        self.assertEqual(
            [item["event_id"] for item in first_page["items"]],
            ["monitor-page-three", "monitor-page-two"],
        )

        status, second_page = self.request(
            client,
            "GET",
            f"/monitoring/events?limit=2&offset=2&website_id={website['id']}",
        )
        self.assertEqual(status, 200)
        self.assertEqual(second_page["total"], 3)
        self.assertEqual([item["event_id"] for item in second_page["items"]], ["monitor-page-one"])

        status, _ = self.request(client, "GET", "/monitoring/events?limit=101")
        self.assertEqual(status, 422)

    def test_monitoring_event_list_serializes_unscored_events_without_prediction_data(self) -> None:
        client, _, website, credential = self.create_site_and_credential("monitor-unscored@example.test")
        event = self.valid_event("monitor-not-scored")
        event.pop("features")
        self.assertEqual(self.send_event(credential, event)[0], 200)

        status, response = self.request(client, "GET", f"/monitoring/events?website_id={website['id']}")
        self.assertEqual(status, 200)
        item = response["items"][0]
        self.assertEqual(item["scoring_status"], "Not Scored")
        self.assertIsNone(item["prediction_label"])
        self.assertIsNone(item["model_score"])
        self.assertIsNone(item["model_identifier"])

    def test_event_schema_rejects_sensitive_or_unsafe_fields(self) -> None:
        _, _, website, credential = self.create_site_and_credential("schema-events@example.test")
        base_event = {
            "schema_version": "1",
            "event_id": "schema-valid-event",
            "event_timestamp": "2026-10-17T01:00:00Z",
            "method": "GET",
            "endpoint": "/api/items",
            "response_status": 200,
            "request_duration_ms": 1.2,
            "request_size_bytes": 10,
        }
        invalid_events = [
            {**base_event, "event_timestamp": "2026-10-17T01:00:00"},
            {**base_event, "method": "TRACE"},
            {**base_event, "endpoint": "/api/items?email=user@example.test"},
            {**base_event, "endpoint": "/api/user@example.test"},
            {**base_event, "endpoint": "/api/../admin"},
            {**base_event, "response_status": 99},
            {**base_event, "request_duration_ms": -1},
            {**base_event, "request_size_bytes": -1},
            {**base_event, "actor_id": "real-user@example.test"},
            {**base_event, "raw_body": "password=do-not-store"},
            {**base_event, "authorization": "Bearer do-not-store"},
        ]
        for event in invalid_events:
            with self.subTest(event=event):
                self.assertEqual(self.send_event(credential, event)[0], 422)

        self.assertEqual(self.request(
            build_opener(),
            "POST",
            "/monitoring/events",
            base_event,
            extra_headers={"X-APISentinel-Integration-Key": credential},
        )[0], 200)
        with sqlite3.connect(self.database_path) as connection:
            self.assertEqual(
                connection.execute(
                    "SELECT COUNT(*) FROM monitoring_events WHERE website_id = ?",
                    (website["id"],),
                ).fetchone()[0],
                1,
            )
            self.assertEqual(connection.execute(
                "SELECT COUNT(*) FROM monitoring_events WHERE website_id = ? AND endpoint LIKE '%user@example.test%'",
                (website["id"],),
            ).fetchone()[0], 0)
        self.assertIsNotNone(website["id"])

    def test_valid_event_stores_sender_id_utc_timestamps_and_hash(self) -> None:
        _, _, website, credential = self.create_site_and_credential("valid-event@example.test")
        payload = self.valid_event("valid-old-event-id")

        status, response = self.send_event(credential, payload)
        self.assertEqual(status, 200)
        self.assertEqual(response["scoring_status"], "scored")
        self.assertIn(response["prediction_label"], {"normal", "anomalous"})
        self.assertGreaterEqual(response["model_score"], 0)
        self.assertLessEqual(response["model_score"], 1)
        self.assertEqual(response["model_identifier"], "apisentinel_model")
        self.assertIsNone(response["not_scored_reason"])

        with sqlite3.connect(self.database_path) as connection:
            row = connection.execute(
                """SELECT event_id, website_id, owner_user_id, event_timestamp_utc,
                          ingested_at, received_at, scoring_status, not_scored_reason,
                          prediction_label, model_score, model_identifier, content_hash
                   FROM monitoring_events WHERE event_id = ?""",
                (payload["event_id"],),
            ).fetchone()
            expected_owner = connection.execute(
                "SELECT user_id FROM websites WHERE id = ?",
                (website["id"],),
            ).fetchone()[0]
        self.assertIsNotNone(row)
        self.assertEqual(row[0], payload["event_id"])
        self.assertEqual(row[1], website["id"])
        self.assertEqual(row[2], expected_owner)
        stored_event_time = datetime.fromisoformat(row[3]).replace(tzinfo=timezone.utc)
        self.assertEqual(stored_event_time, datetime(2001, 1, 1, tzinfo=timezone.utc))
        self.assertIsNotNone(row[4])
        self.assertEqual(row[4], row[5])
        self.assertEqual(row[6], "scored")
        self.assertIsNone(row[7])
        self.assertEqual(row[8], response["prediction_label"])
        self.assertEqual(row[9], response["model_score"])
        self.assertEqual(row[10], "apisentinel_model")
        expected_hash = hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        ).hexdigest()
        self.assertEqual(row[11], expected_hash)
        self.assertEqual(response["received_at"], row[4].replace(" ", "T") + "Z")
        with sqlite3.connect(self.database_path) as connection:
            prediction_count = connection.execute(
                "SELECT COUNT(*) FROM prediction_records WHERE user_id = ?",
                (expected_owner,),
            ).fetchone()[0]
        self.assertEqual(prediction_count, 1)

    def test_attack_like_event_creates_an_owned_alert(self) -> None:
        client, _, website, credential = self.create_site_and_credential("attack-event@example.test")
        payload = self.valid_event("attack-like-event")
        payload["endpoint"] = "/api/attack-like"
        payload["features"] = self.attack_like_features()

        status, response = self.send_event(credential, payload)
        self.assertEqual(status, 200)
        self.assertEqual(response["scoring_status"], "scored")
        self.assertEqual(response["prediction_label"], "anomalous")

        with sqlite3.connect(self.database_path) as connection:
            owner_id = connection.execute(
                "SELECT user_id FROM websites WHERE id = ?",
                (website["id"],),
            ).fetchone()[0]
            prediction = connection.execute(
                "SELECT id, user_id, prediction FROM prediction_records WHERE user_id = ?",
                (owner_id,),
            ).fetchone()
            alerts = connection.execute(
                "SELECT user_id, prediction_id FROM alerts",
            ).fetchall()
        self.assertEqual(prediction[1:], (owner_id, "anomalous"))
        self.assertEqual(alerts, [(owner_id, prediction[0])])
        status, visible_alerts = self.request(client, "GET", "/alerts")
        self.assertEqual(status, 200)
        self.assertEqual(visible_alerts["total"], 1)
        self.assertEqual(visible_alerts["items"][0]["prediction"]["url"], "/api/attack-like")

    def test_identical_event_retry_returns_existing_record(self) -> None:
        _, _, website, credential = self.create_site_and_credential("retry-event@example.test")
        payload = self.valid_event("retry-event-id")

        first_status, first = self.send_event(credential, payload)
        retry_status, retry = self.send_event(credential, payload)

        self.assertEqual(first_status, 200)
        self.assertEqual(retry_status, 200)
        self.assertEqual(retry["event_id"], first["event_id"])
        self.assertEqual(retry["received_at"], first["received_at"])
        self.assertEqual(retry["scoring_status"], first["scoring_status"])
        self.assertEqual(retry["prediction_label"], first["prediction_label"])
        self.assertEqual(retry["model_score"], first["model_score"])
        self.assertEqual(retry["model_identifier"], first["model_identifier"])
        with sqlite3.connect(self.database_path) as connection:
            event_count = connection.execute(
                "SELECT COUNT(*) FROM monitoring_events WHERE website_id = ? AND event_id = ?",
                (website["id"], payload["event_id"]),
            ).fetchone()[0]
            prediction_count = connection.execute(
                "SELECT COUNT(*) FROM prediction_records WHERE user_id = "
                "(SELECT user_id FROM websites WHERE id = ?)",
                (website["id"],),
            ).fetchone()[0]
            alert_count = connection.execute(
                "SELECT COUNT(*) FROM alerts WHERE user_id = "
                "(SELECT user_id FROM websites WHERE id = ?)",
                (website["id"],),
            ).fetchone()[0]
        self.assertEqual(event_count, 1)
        self.assertEqual(prediction_count, 1)
        self.assertEqual(alert_count, int(first["prediction_label"] == "anomalous"))

    def test_conflicting_duplicate_event_id_returns_409(self) -> None:
        _, _, website, credential = self.create_site_and_credential("conflicting-event@example.test")
        payload = self.valid_event("conflicting-event-id")
        self.assertEqual(self.send_event(credential, payload)[0], 200)

        conflicting_payload = {**payload, "endpoint": "/api/changed"}
        status, response = self.send_event(credential, conflicting_payload)
        self.assertEqual(status, 409)
        self.assertIn("already used for different event content", response["detail"])
        with sqlite3.connect(self.database_path) as connection:
            count = connection.execute(
                "SELECT COUNT(*) FROM monitoring_events WHERE website_id = ? AND event_id = ?",
                (website["id"], payload["event_id"]),
            ).fetchone()[0]
        self.assertEqual(count, 1)

    def test_invalid_timestamps_and_missing_event_id_are_rejected(self) -> None:
        _, _, website, credential = self.create_site_and_credential("invalid-timestamp@example.test")
        payload = self.valid_event("invalid-timestamp-event")
        for timestamp in ("2001-01-01T05:30:00", "not-a-timestamp"):
            with self.subTest(timestamp=timestamp):
                self.assertEqual(
                    self.send_event(credential, {**payload, "event_timestamp": timestamp})[0],
                    422,
                )
        missing_event_id = {key: value for key, value in payload.items() if key != "event_id"}
        self.assertEqual(
            self.request(
                build_opener(),
                "POST",
                "/monitoring/events",
                missing_event_id,
                extra_headers={"X-APISentinel-Integration-Key": credential},
            )[0],
            422,
        )
        with sqlite3.connect(self.database_path) as connection:
            count = connection.execute(
                "SELECT COUNT(*) FROM monitoring_events WHERE website_id = ?",
                (website["id"],),
            ).fetchone()[0]
        self.assertEqual(count, 0)

    def test_missing_or_invalid_features_are_saved_as_not_scored(self) -> None:
        _, _, website, credential = self.create_site_and_credential("invalid-features@example.test")
        complete_features = self.valid_event("feature-template")["features"]
        payloads = [
            {
                **self.valid_event("missing-feature-event"),
                "features": {name: value for name, value in complete_features.items() if name != "payload_len"},
            },
            {
                **self.valid_event("invalid-feature-event"),
                "features": {**complete_features, "url_len": True, "password": 1},
            },
            {
                **self.valid_event("no-features-event"),
                "features": None,
            },
        ]
        for payload in payloads:
            with self.subTest(event_id=payload["event_id"]):
                self.assertEqual(self.send_event(credential, payload)[0], 200)

        with sqlite3.connect(self.database_path) as connection:
            rows = connection.execute(
                "SELECT event_id, scoring_status, not_scored_reason, features FROM monitoring_events "
                "WHERE website_id = ? AND event_id IN (?, ?, ?)",
                (website["id"], *(payload["event_id"] for payload in payloads)),
            ).fetchall()
        self.assertEqual(len(rows), len(payloads))
        records = {row[0]: row[1:] for row in rows}
        self.assertEqual({record[0] for record in records.values()}, {"Not Scored"})
        self.assertIn("Missing required features: payload_len.", records["missing-feature-event"][1])
        self.assertIn("Invalid feature measurements: url_len.", records["invalid-feature-event"][1])
        self.assertIn("Unrecognized feature names were supplied.", records["invalid-feature-event"][1])
        self.assertIn("object containing all eight", records["no-features-event"][1])
        self.assertNotIn("payload_len", json.loads(records["missing-feature-event"][2]))
        self.assertNotIn("url_len", json.loads(records["invalid-feature-event"][2]))
        self.assertNotIn("password", json.loads(records["invalid-feature-event"][2]))
        self.assertIsNone(json.loads(records["no-features-event"][2]))
        with sqlite3.connect(self.database_path) as connection:
            self.assertEqual(
                connection.execute(
                    "SELECT COUNT(*) FROM prediction_records WHERE user_id = "
                    "(SELECT user_id FROM websites WHERE id = ?)",
                    (website["id"],),
                ).fetchone()[0],
                0,
            )

    def test_model_failure_is_saved_as_not_scored_without_failing_ingestion(self) -> None:
        script = """
import http.cookiejar
import sqlite3
import socket
import threading
import time
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener
from unittest.mock import patch
import uvicorn
from main import app

with patch("main.get_model", side_effect=RuntimeError("model unavailable")) as model_loader:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error")
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 20
    while not server.started and time.monotonic() < deadline:
        time.sleep(0.05)
    assert server.started, "The isolated test server did not start."
    opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def send(method, path, payload=None, headers=None):
        request_headers = {"Accept": "application/json"}
        body = None
        if payload is not None:
            import json
            request_headers["Content-Type"] = "application/json"
            body = json.dumps(payload).encode("utf-8")
        if headers:
            request_headers.update(headers)
        request = Request(
            f"http://127.0.0.1:{port}{path}",
            data=body,
            headers=request_headers,
            method=method,
        )
        try:
            with opener.open(request, timeout=10) as response:
                return response.status, response.read()
        except HTTPError as error:
            return error.code, error.read()

    try:
        import json
        status, session_body = send("GET", "/auth/session")
        assert status == 200
        csrf = json.loads(session_body)["csrf_token"]
        status, registration_body = send(
            "POST",
            "/auth/register",
            {
                "full_name": "Failure Test User",
                "email": "model-failure@example.test",
                "password": "Failure-Test-Password-42!",
                "confirm_password": "Failure-Test-Password-42!",
            },
            {"X-CSRF-Token": csrf},
        )
        assert status == 200, registration_body
        csrf = json.loads(registration_body)["csrf_token"]
        status, website_body = send(
            "POST",
            "/websites",
            {
                "name": "Failure Test API",
                "base_url": "https://example.test",
                "integration_type": "fastapi",
            },
            {"X-CSRF-Token": csrf},
        )
        assert status == 201, website_body
        website_id = json.loads(website_body)["id"]
        status, credential_body = send(
            "POST",
            f"/websites/{website_id}/integration/credentials",
            {},
            {"X-CSRF-Token": csrf},
        )
        assert status == 201, credential_body
        credential = json.loads(credential_body)["credential"]
        event_payload = {
            "schema_version": "1",
            "event_id": "model-failure-event",
            "event_timestamp": "2026-10-18T00:00:00Z",
            "method": "GET",
            "endpoint": "/api/model-failure",
            "response_status": 200,
            "request_duration_ms": 1,
            "request_size_bytes": 0,
            "features": {
                "payload_len": 2,
                "url_len": 14,
                "param_count": 1,
                "special_char_count": 0,
                "digit_count": 0,
                "encoded_char_count": 0,
                "path_depth": 2,
                "payload_entropy": 1,
            },
        }
        status, event_body = send(
            "POST",
            "/monitoring/events",
            event_payload,
            {"X-APISentinel-Integration-Key": credential},
        )
        assert status == 200, event_body
        event = json.loads(event_body)
        assert event["scoring_status"] == "Not Scored"
        assert "RuntimeError" in event["not_scored_reason"]
        status, retry_body = send(
            "POST",
            "/monitoring/events",
            event_payload,
            {"X-APISentinel-Integration-Key": credential},
        )
        assert status == 200, retry_body
        assert json.loads(retry_body) == event
        assert model_loader.call_count == 1
    finally:
        server.should_exit = True
        thread.join(timeout=10)

with sqlite3.connect(__import__("os").environ["TEST_DATABASE_PATH"]) as connection:
    stored = connection.execute(
        "SELECT scoring_status, not_scored_reason, prediction_label, model_score, model_identifier "
        "FROM monitoring_events WHERE event_id = 'model-failure-event'"
    ).fetchone()
    assert stored[0] == "Not Scored"
    assert "RuntimeError" in stored[1]
    assert stored[2:] == (None, None, None)
    assert connection.execute("SELECT COUNT(*) FROM prediction_records").fetchone()[0] == 0
    assert connection.execute("SELECT COUNT(*) FROM alerts").fetchone()[0] == 0
"""
        with tempfile.TemporaryDirectory(prefix="apisentinel-model-failure-") as temp_dir:
            database_path = Path(temp_dir) / "model-failure.db"
            environment = os.environ.copy()
            environment["DATABASE_URL"] = f"sqlite:///{database_path}"
            environment["PYTHONPATH"] = str(BACKEND_DIR)
            environment["TEST_DATABASE_PATH"] = str(database_path)
            completed = subprocess.run(
                [sys.executable, "-c", script],
                cwd=BACKEND_DIR,
                env=environment,
                capture_output=True,
                text=True,
                timeout=60,
            )
            self.assertEqual(
                completed.returncode,
                0,
                f"Isolated model-failure test failed:\n{completed.stdout}\n{completed.stderr}",
            )

    def test_events_are_scoped_to_their_validated_website(self) -> None:
        client_a, _, website_a, credential_a = self.create_site_and_credential("event-scope-a@example.test")
        client_b, _, website_b, credential_b = self.create_site_and_credential("event-scope-b@example.test")
        payload_a = self.valid_event("same-id-on-different-websites")
        payload_a["endpoint"] = "/api/site-a"
        payload_a["features"] = self.attack_like_features()
        payload_b = {**payload_a, "endpoint": "/api/site-b"}

        self.assertEqual(self.send_event(credential_a, payload_a)[0], 200)
        self.assertEqual(self.send_event(credential_b, payload_b)[0], 200)
        self.assertEqual(self.request(client_a, "GET", f"/websites/{website_b['id']}")[0], 404)
        with sqlite3.connect(self.database_path) as connection:
            rows = connection.execute(
                "SELECT website_id, owner_user_id FROM monitoring_events WHERE event_id = ?",
                (payload_a["event_id"],),
            ).fetchall()
        self.assertEqual({row[0] for row in rows}, {website_a["id"], website_b["id"]})
        self.assertEqual(len({row[1] for row in rows}), 2)
        for client, own_endpoint, other_endpoint in (
            (client_a, "/api/site-a", "/api/site-b"),
            (client_b, "/api/site-b", "/api/site-a"),
        ):
            history_status, history = self.request(client, "GET", "/history")
            alert_status, alerts = self.request(client, "GET", "/alerts")
            self.assertEqual(history_status, 200)
            self.assertEqual(alert_status, 200)
            self.assertEqual([item["url"] for item in history["items"]], [own_endpoint])
            self.assertEqual(alerts["total"], 1)
            self.assertEqual(
                [item["prediction"]["url"] for item in alerts["items"]],
                [own_endpoint],
            )
            self.assertNotIn(other_endpoint, {item["url"] for item in history["items"]})

    def test_legacy_monitoring_event_survives_additive_migration(self) -> None:
        with sqlite3.connect(self.database_path) as connection:
            row = connection.execute(
                "SELECT id, endpoint, scoring_status, event_id FROM monitoring_events "
                "WHERE id = 'legacy-event-before-d2'"
            ).fetchone()
        self.assertEqual(row, ("legacy-event-before-d2", "/legacy", "Not Scored", None))

    def test_unique_index_rejects_duplicate_website_event_id(self) -> None:
        _, _, website, credential = self.create_site_and_credential("unique-index@example.test")
        payload = self.valid_event("unique-index-event")
        self.assertEqual(self.send_event(credential, payload)[0], 200)
        with sqlite3.connect(self.database_path) as connection:
            with self.assertRaises(sqlite3.IntegrityError):
                connection.execute(
                    """INSERT INTO monitoring_events (
                        id, website_id, owner_user_id, event_id, event_timestamp,
                        event_timestamp_utc, ingested_at, received_at, method, endpoint,
                        response_status, request_duration_ms, request_size_bytes,
                        scoring_status, content_hash
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        str(uuid4()),
                        website["id"],
                        connection.execute(
                            "SELECT user_id FROM websites WHERE id = ?",
                            (website["id"],),
                        ).fetchone()[0],
                        payload["event_id"],
                        "2001-01-01 00:00:00",
                        "2001-01-01 00:00:00",
                        "2026-10-18 00:00:00",
                        "2026-10-18 00:00:00",
                        "GET",
                        "/duplicate",
                        200,
                        1.0,
                        0,
                        "Not Scored",
                        "duplicate",
                    ),
                )

    def test_monitoring_event_retention_prunes_expired_events(self) -> None:
        _, _, website, credential = self.create_site_and_credential("retention-events@example.test")
        self.assertEqual(self.send_event(credential)[0], 200)
        with sqlite3.connect(self.database_path) as connection:
            connection.execute(
                "UPDATE monitoring_events SET received_at = '2020-01-01 00:00:00'"
            )
        self.assertEqual(
            self.send_event(
                credential,
                {
                    "schema_version": "1",
                    "event_timestamp": "2026-10-17T01:00:00Z",
                    "method": "GET",
                    "endpoint": "/api/current",
                    "response_status": 200,
                    "request_duration_ms": 1,
                    "request_size_bytes": 0,
                },
            )[0],
            200,
        )
        with sqlite3.connect(self.database_path) as connection:
            events = connection.execute(
                "SELECT endpoint FROM monitoring_events WHERE website_id = ?",
                (website["id"],),
            ).fetchall()
        self.assertEqual(events, [("/api/current",)])

    def test_ingestion_body_size_and_rate_limits(self) -> None:
        _, _, website, credential = self.create_site_and_credential("rate-events@example.test")
        oversized = {
            "schema_version": "1",
            "event_timestamp": "2026-10-17T01:00:00Z",
            "method": "POST",
            "endpoint": "/api/large",
            "response_status": 200,
            "request_duration_ms": 4,
            "request_size_bytes": 100,
            "actor_id": "a" * 20_000,
        }
        self.assertEqual(self.send_event(credential, oversized)[0], 413)
        self.assertEqual(self.send_event(credential)[0], 200)
        self.assertEqual(self.send_event(credential)[0], 200)
        self.assertEqual(self.send_event(credential)[0], 200)
        status, _ = self.send_event(credential)
        self.assertEqual(status, 429)
        self.assertEqual(self.request(
            build_opener(),
            "POST",
            "/monitoring/events",
            {
                "schema_version": "1",
                "event_id": "rate-limited-direct-event",
                "event_timestamp": "2026-10-17T01:00:00Z",
                "method": "GET",
                "endpoint": "/api/items",
                "response_status": 200,
                "request_duration_ms": 1,
                "request_size_bytes": 0,
            },
            extra_headers={"X-APISentinel-Integration-Key": credential},
        )[0], 429)
        self.assertTrue(website["id"])

    def test_logout_invalidates_session_and_login_restores_it(self) -> None:
        client, csrf = self.register_user("login@example.test")
        self.assertEqual(self.request(client, "GET", "/websites")[0], 200)
        self.assertEqual(self.request(client, "POST", "/auth/logout", csrf=csrf)[0], 200)
        self.assertEqual(self.request(client, "GET", "/websites")[0], 401)

        status, anonymous_session = self.request(client, "GET", "/auth/session")
        self.assertEqual(status, 200)
        status, logged_in = self.request(
            client,
            "POST",
            "/auth/login",
            {"email": "login@example.test", "password": "Website-Test-Password-42!"},
            anonymous_session["csrf_token"],
        )
        self.assertEqual(status, 200)
        self.assertEqual(logged_in["user"]["email"], "login@example.test")
        self.assertEqual(self.request(client, "GET", "/websites")[0], 200)


if __name__ == "__main__":
    unittest.main()
