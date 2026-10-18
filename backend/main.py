"""APISentinel backend: score HTTP-like requests with the saved XGBoost model."""

from __future__ import annotations

import logging
import hashlib
import hmac
import ipaddress
import json
import os
import re
import secrets
import threading
import time
from collections import OrderedDict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from math import ceil, isfinite
from typing import Literal
from urllib.parse import unquote, urlsplit, urlunsplit
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, StrictFloat, StrictInt, field_validator, model_validator
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from database import (
    AlertRecord,
    MonitoringEvent,
    PredictionRecord,
    User,
    UserSession,
    Website,
    WebsiteIntegration,
    add_prediction,
    get_db,
    initialize_database,
    persist_prediction,
    utc_datetime,
)
from predictor import MODEL_PATH, get_model

logger = logging.getLogger(__name__)
SESSION_COOKIE_NAME = "apisentinel_session"
SESSION_MAX_AGE = 60 * 60 * 12
SESSION_TTL = timedelta(seconds=SESSION_MAX_AGE)
ALLOWED_ORIGINS = {
    "http://127.0.0.1:5173",
    "http://localhost:5173",
}
EMAIL_PATTERN = re.compile(r"^[^@\s]{1,64}@[^@\s.]+(?:\.[^@\s.]+)+$")
COOKIE_SECURE = os.environ.get("APISENTINEL_COOKIE_SECURE", "").strip().lower() in {"1", "true", "yes"}
MAX_EVENT_BODY_BYTES = 16 * 1024
MAX_PREDICT_BODY_BYTES = 512 * 1024
MAX_REQUEST_URL_LENGTH = 8_192
MAX_REQUEST_PAYLOAD_LENGTH = 256 * 1024
INGEST_WINDOW_SECONDS = 60.0
INGEST_RATE_LIMIT = max(1, int(os.environ.get("APISENTINEL_INGEST_RATE_LIMIT", "120")))
EVENT_RETENTION_DAYS = max(1, int(os.environ.get("APISENTINEL_EVENT_RETENTION_DAYS", "90")))
LOGIN_RATE_WINDOW_SECONDS = max(1, int(os.environ.get("APISENTINEL_LOGIN_RATE_WINDOW_SECONDS", "300")))
LOGIN_RATE_LIMIT = max(1, int(os.environ.get("APISENTINEL_LOGIN_RATE_LIMIT", "5")))
LOGIN_RATE_BUCKET_LIMIT = 10_000
_ingest_rate_lock = threading.Lock()
_ingest_rate_windows: dict[str, deque[float]] = {}
_login_rate_lock = threading.Lock()
_login_attempt_windows: OrderedDict[str, deque[float]] = OrderedDict()
FEATURE_NAMES = {
    "payload_len",
    "url_len",
    "param_count",
    "special_char_count",
    "digit_count",
    "encoded_char_count",
    "path_depth",
    "payload_entropy",
}
SENSITIVE_PATH_VALUE = re.compile(
    r"(?:[^/@\s]+@[^/@\s]+\.[^/@\s]+|"
    r"eyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}|"
    r"[A-Za-z0-9_-]{40,})",
    re.IGNORECASE,
)
ACTOR_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")


@asynccontextmanager
async def lifespan(app: FastAPI):
    initialize_database()
    yield


app = FastAPI(
    title="APISentinel",
    description="Anomaly detection for HTTP API requests using a trained XGBoost model.",
    version="0.1.0",
    lifespan=lifespan,
)


class PredictRequestSizeLimitMiddleware:
    def __init__(self, app: ASGIApp, max_body_bytes: int) -> None:
        self.app = app
        self.max_body_bytes = max_body_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] != "POST" or scope["path"] != "/predict":
            await self.app(scope, receive, send)
            return

        content_length = dict(scope["headers"]).get(b"content-length")
        if content_length and content_length.isdigit() and int(content_length) > self.max_body_bytes:
            await JSONResponse(
                status_code=413,
                content={"detail": "Prediction request exceeds the 512 KiB request size limit."},
            )(scope, receive, send)
            return

        body_chunks: list[bytes] = []
        body_size = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            if message["type"] != "http.request":
                continue
            chunk = message.get("body", b"")
            body_size += len(chunk)
            if body_size > self.max_body_bytes:
                await JSONResponse(
                    status_code=413,
                    content={"detail": "Prediction request exceeds the 512 KiB request size limit."},
                )(scope, receive, send)
                return
            body_chunks.append(chunk)
            if not message.get("more_body", False):
                break

        body = b"".join(body_chunks)
        body_sent = False

        async def replay_body() -> dict[str, object]:
            nonlocal body_sent
            if not body_sent:
                body_sent = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        await self.app(scope, replay_body, send)


app.add_middleware(
    PredictRequestSizeLimitMiddleware,
    max_body_bytes=MAX_PREDICT_BODY_BYTES,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(ALLOWED_ORIGINS),
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Accept", "X-CSRF-Token"],
    allow_credentials=True,
)


class RequestScan(BaseModel):
    method: str = Field(default="GET", examples=["GET", "POST"])
    url: str = Field(..., max_length=MAX_REQUEST_URL_LENGTH, examples=["/tienda1/publico/anadir.jsp?id=3"])
    payload: str = Field(default="", max_length=MAX_REQUEST_PAYLOAD_LENGTH, examples=["id=3&nombre=Vino"])


class FeatureScan(BaseModel):
    payload_len: float
    url_len: float
    param_count: float
    special_char_count: float
    digit_count: float
    encoded_char_count: float
    path_depth: float
    payload_entropy: float


class PredictionRecordResponse(BaseModel):
    id: str
    timestamp: str
    method: str
    url: str
    prediction: str
    class_id: int
    confidence: float
    normal_score: float | None
    anomalous_score: float | None
    features: dict[str, float]


class HistoryResponse(BaseModel):
    items: list[PredictionRecordResponse]
    total: int
    limit: int
    offset: int


class AlertResponse(BaseModel):
    id: str
    prediction_id: str
    created_at: str
    updated_at: str
    review_status: str
    analyst_notes: str
    prediction: PredictionRecordResponse


class AlertsResponse(BaseModel):
    items: list[AlertResponse]
    total: int
    limit: int
    offset: int


class AlertUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    review_status: Literal["New", "Under Review", "Resolved", "False Positive"] | None = None
    analyst_notes: str | None = Field(default=None, max_length=5000)

    @model_validator(mode="after")
    def require_at_least_one_update(self) -> AlertUpdate:
        if self.review_status is None and self.analyst_notes is None:
            raise ValueError("Provide a review_status or analyst_notes update.")
        return self


class AnalyticsSummaryResponse(BaseModel):
    total_requests: int
    normal_requests: int
    anomalous_requests: int
    anomaly_rate: float
    total_alerts: int


class UserResponse(BaseModel):
    id: str
    full_name: str
    email: str


class AuthSessionResponse(BaseModel):
    user: UserResponse | None
    csrf_token: str


class RegistrationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    full_name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=12, max_length=128)
    confirm_password: str = Field(min_length=12, max_length=128)

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Full name is required.")
        return value

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not EMAIL_PATTERN.fullmatch(normalized):
            raise ValueError("Enter a valid email address.")
        return normalized

    @model_validator(mode="after")
    def passwords_must_match(self) -> RegistrationRequest:
        if self.password != self.confirm_password:
            raise ValueError("Passwords do not match.")
        return self


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not EMAIL_PATTERN.fullmatch(normalized):
            raise ValueError("Enter a valid email address.")
        return normalized


INTEGRATION_TYPES = ("fastapi", "express", "manual")


def _normalize_base_url(value: str) -> str:
    candidate = value.strip()
    if (
        not candidate
        or len(candidate) > 2048
        or any(ord(character) <= 32 or character == "\\" for character in candidate)
        or "?" in candidate
        or "#" in candidate
    ):
        raise ValueError("Enter a valid HTTP or HTTPS base URL without query or fragment.")
    try:
        parsed = urlsplit(candidate)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError as exc:
        raise ValueError("Enter a valid HTTP or HTTPS base URL.") from exc
    scheme = parsed.scheme.lower()
    if scheme not in {"http", "https"} or not hostname or parsed.username or parsed.password or "@" in parsed.netloc:
        raise ValueError("Only HTTP or HTTPS URLs without embedded credentials are allowed.")
    hostname = hostname.rstrip(".").lower()
    if not hostname:
        raise ValueError("A hostname is required.")
    try:
        if ":" in hostname:
            hostname = ipaddress.IPv6Address(hostname).compressed
            host_for_url = f"[{hostname}]"
        else:
            hostname = hostname.encode("idna").decode("ascii")
            labels = hostname.split(".")
            if len(hostname) > 253 or any(
                not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
                for label in labels
            ):
                raise ValueError("The URL hostname is invalid.")
            host_for_url = hostname
    except (UnicodeError, ipaddress.AddressValueError) as exc:
        raise ValueError("The URL hostname is invalid.") from exc
    if port is not None and not 1 <= port <= 65535:
        raise ValueError("The URL port must be between 1 and 65535.")
    if port == (80 if scheme == "http" else 443):
        port = None
    netloc = host_for_url if port is None else f"{host_for_url}:{port}"
    path = parsed.path.rstrip("/")
    return urlunsplit((scheme, netloc, path, "", ""))


class WebsiteCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)
    base_url: str = Field(min_length=1, max_length=2048)
    description: str = Field(default="", max_length=2000)
    integration_type: Literal["fastapi", "express", "manual"]

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Website name is required.")
        return normalized

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, value: str) -> str:
        return _normalize_base_url(value)

    @field_validator("description")
    @classmethod
    def clean_description(cls, value: str) -> str:
        return value.strip()


class WebsiteUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=120)
    base_url: str | None = Field(default=None, min_length=1, max_length=2048)
    description: str | None = Field(default=None, max_length=2000)
    integration_type: Literal["fastapi", "express", "manual"] | None = None

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("Website name is required.")
        return normalized

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, value: str | None) -> str | None:
        return _normalize_base_url(value) if value is not None else None

    @field_validator("description")
    @classmethod
    def clean_description(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None

    @model_validator(mode="after")
    def require_update(self) -> WebsiteUpdate:
        if not self.model_fields_set:
            raise ValueError("Provide at least one website field to update.")
        return self


class WebsiteResponse(BaseModel):
    id: str
    name: str
    base_url: str
    description: str
    integration_type: str
    connection_status: str
    credential_active: bool
    last_event_at: str | None
    created_at: str
    updated_at: str


class IntegrationCredentialResponse(BaseModel):
    credential: str
    created_at: str


class MonitoringEventIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1"] = "1"
    event_id: str = Field(min_length=1, max_length=128)
    event_timestamp: datetime
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
    endpoint: str = Field(min_length=1, max_length=512)
    response_status: StrictInt = Field(ge=100, le=599)
    request_duration_ms: StrictFloat | StrictInt = Field(ge=0, le=3_600_000)
    request_size_bytes: StrictInt = Field(ge=0, le=10_000_000)
    features: object | None = None
    actor_id: str | None = Field(default=None, max_length=128)

    @field_validator("event_id")
    @classmethod
    def validate_event_id(cls, value: str) -> str:
        if value != value.strip() or any(ord(character) < 32 for character in value):
            raise ValueError("Event ID must be a non-blank identifier without control characters.")
        return value

    @field_validator("event_timestamp")
    @classmethod
    def require_aware_timestamp(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Event timestamp must include a timezone.")
        return value.astimezone(timezone.utc)

    @field_validator("endpoint")
    @classmethod
    def normalize_endpoint(cls, value: str) -> str:
        candidate = value.strip()
        if (
            not candidate.startswith("/")
            or candidate.startswith("//")
            or any(ord(character) < 32 or character == "\\" for character in candidate)
            or "?" in candidate
            or "#" in candidate
        ):
            raise ValueError("Endpoint must be a normalized path without query or fragment.")
        decoded = unquote(candidate)
        if "?" in decoded or "#" in decoded or "\\" in decoded or any(ord(character) < 32 for character in decoded):
            raise ValueError("Endpoint contains an invalid path value.")
        if SENSITIVE_PATH_VALUE.search(decoded):
            raise ValueError("Endpoint appears to contain a sensitive path value; use a route template.")
        segments = [segment for segment in decoded.split("/") if segment]
        if any(segment in {".", ".."} for segment in segments):
            raise ValueError("Endpoint path traversal segments are not allowed.")
        normalized = re.sub(r"/{2,}", "/", candidate).rstrip("/")
        return normalized or "/"

    @field_validator("actor_id")
    @classmethod
    def validate_actor_id(cls, value: str | None) -> str | None:
        if value is not None and not ACTOR_ID_PATTERN.fullmatch(value):
            raise ValueError("Actor ID must be a pseudonymous opaque identifier.")
        return value

    @field_validator("request_duration_ms")
    @classmethod
    def validate_duration(cls, value: StrictFloat | StrictInt) -> float:
        duration = float(value)
        if not isfinite(duration):
            raise ValueError("Request duration must be finite.")
        return duration


class MonitoringEventResponse(BaseModel):
    accepted: bool
    event_id: str
    received_at: str
    scoring_status: Literal["Not Scored", "scored"] = "Not Scored"
    not_scored_reason: str | None = None
    prediction_label: str | None = None
    model_score: float | None = None
    model_identifier: str | None = None


class MonitoringEventItemResponse(BaseModel):
    id: str
    event_id: str | None
    website_id: str
    website_name: str
    received_at: str
    event_timestamp: str
    method: str
    endpoint: str
    response_status: int
    request_duration_ms: float
    request_size_bytes: int
    scoring_status: str
    prediction_label: str | None
    model_score: float | None
    model_identifier: str | None


class MonitoringEventListResponse(BaseModel):
    items: list[MonitoringEventItemResponse]
    total: int
    limit: int
    offset: int


def _validated_event_features(features: object | None) -> tuple[dict[str, float] | None, str | None]:
    if not isinstance(features, dict):
        return None, "Features must be an object containing all eight required measurements."

    missing = sorted(FEATURE_NAMES - features.keys())
    unrecognized = sorted(str(name) for name in features if name not in FEATURE_NAMES)
    valid_features: dict[str, float] = {}
    invalid: list[str] = []
    for name in sorted(FEATURE_NAMES.intersection(features)):
        value = features[name]
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            invalid.append(name)
            continue
        try:
            measurement = float(value)
        except OverflowError:
            invalid.append(name)
            continue
        if not isfinite(measurement) or measurement < 0 or measurement > 10_000_000:
            invalid.append(name)
            continue
        valid_features[name] = measurement

    reasons = []
    if missing:
        reasons.append(f"Missing required features: {', '.join(missing)}.")
    if invalid:
        reasons.append(f"Invalid feature measurements: {', '.join(invalid)}.")
    if unrecognized:
        reasons.append("Unrecognized feature names were supplied.")
    return valid_features, " ".join(reasons) if reasons else None


def _website_response(website: Website, session: Session) -> WebsiteResponse:
    active_credential = session.scalar(
        select(WebsiteIntegration).where(
            WebsiteIntegration.website_id == website.id,
            WebsiteIntegration.revoked_at.is_(None),
        )
    )
    return WebsiteResponse(
        id=website.id,
        name=website.name,
        base_url=website.base_url,
        description=website.description,
        integration_type=website.integration_type,
        connection_status=website.connection_status,
        credential_active=active_credential is not None,
        last_event_at=(
            _iso_utc(active_credential.last_successful_event_at)
            if active_credential and active_credential.last_successful_event_at
            else None
        ),
        created_at=_iso_utc(website.created_at),
        updated_at=_iso_utc(website.updated_at),
    )


def _owned_website(session: Session, website_id: str, user_id: str) -> Website:
    website = session.scalar(
        select(Website).where(
            Website.id == website_id,
            Website.user_id == user_id,
            Website.deleted_at.is_(None),
        )
    )
    if website is None:
        raise HTTPException(status_code=404, detail="Website not found.")
    return website


def _new_integration_credential() -> tuple[str, str]:
    credential = f"aps_live_{secrets.token_urlsafe(32)}"
    return credential, hashlib.sha256(credential.encode("utf-8")).hexdigest()


def _check_ingest_rate_limit(integration_id: str) -> None:
    now = time.monotonic()
    with _ingest_rate_lock:
        window = _ingest_rate_windows.setdefault(integration_id, deque())
        cutoff = now - INGEST_WINDOW_SECONDS
        while window and window[0] <= cutoff:
            window.popleft()
        if len(window) >= INGEST_RATE_LIMIT:
            retry_after = max(1, int(INGEST_WINDOW_SECONDS - (now - window[0])))
            raise HTTPException(
                status_code=429,
                detail="Monitoring event rate limit exceeded.",
                headers={"Retry-After": str(retry_after)},
            )
        window.append(now)
        if len(_ingest_rate_windows) > 10_000:
            expired_keys = [
                key for key, timestamps in _ingest_rate_windows.items()
                if not timestamps or timestamps[-1] <= cutoff
            ]
            for key in expired_keys:
                _ingest_rate_windows.pop(key, None)


def _login_rate_bucket_key(email: str, client_host: str | None) -> str:
    try:
        address = ipaddress.ip_address(client_host or "")
        mapped_address = address.ipv4_mapped if isinstance(address, ipaddress.IPv6Address) else None
        source = str(mapped_address or address)
    except ValueError:
        source = "unknown"
    return hashlib.sha256(f"{source}\0{email}".encode("utf-8")).hexdigest()


def _check_login_rate_limit(bucket_key: str) -> None:
    now = time.monotonic()
    cutoff = now - LOGIN_RATE_WINDOW_SECONDS
    with _login_rate_lock:
        window = _login_attempt_windows.get(bucket_key)
        if window:
            while window and window[0] <= cutoff:
                window.popleft()
        if window and len(window) >= LOGIN_RATE_LIMIT:
            retry_after = max(1, ceil(LOGIN_RATE_WINDOW_SECONDS - (now - window[0])))
            raise HTTPException(
                status_code=429,
                detail="Too many login attempts. Try again later.",
                headers={"Retry-After": str(retry_after)},
            )
        if not window:
            window = deque()
            _login_attempt_windows[bucket_key] = window
        window.append(now)
        _login_attempt_windows.move_to_end(bucket_key)
        while len(_login_attempt_windows) > LOGIN_RATE_BUCKET_LIMIT:
            _login_attempt_windows.popitem(last=False)


def _iso_utc(value: datetime) -> str:
    return utc_datetime(value).isoformat().replace("+00:00", "Z")


def _prediction_response(record: PredictionRecord) -> PredictionRecordResponse:
    return PredictionRecordResponse(
        id=record.id,
        timestamp=_iso_utc(record.timestamp),
        method=record.method,
        url=record.sanitized_url,
        prediction=record.prediction,
        class_id=record.class_id,
        confidence=record.confidence,
        normal_score=record.normal_score,
        anomalous_score=record.anomalous_score,
        features=record.features,
    )


def _alert_response(alert: AlertRecord) -> AlertResponse:
    return AlertResponse(
        id=alert.id,
        prediction_id=alert.prediction_id,
        created_at=_iso_utc(alert.created_at),
        updated_at=_iso_utc(alert.updated_at),
        review_status=alert.review_status,
        analyst_notes=alert.analyst_notes,
        prediction=_prediction_response(alert.prediction),
    )


def _database_unavailable() -> HTTPException:
    logger.error("A database API request failed.")
    return HTTPException(status_code=503, detail="Database service is temporarily unavailable.")


def _session_token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    derived = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=64)
    return f"scrypt$16384$8$1${salt.hex()}${derived.hex()}"


def _verify_password(password: str, encoded_hash: str) -> bool:
    try:
        algorithm, n_value, r_value, p_value, salt_hex, expected_hex = encoded_hash.split("$")
        if algorithm != "scrypt":
            return False
        derived = hashlib.scrypt(
            password.encode("utf-8"),
            salt=bytes.fromhex(salt_hex),
            n=int(n_value),
            r=int(r_value),
            p=int(p_value),
            dklen=len(bytes.fromhex(expected_hex)),
        )
        return hmac.compare_digest(derived.hex(), expected_hex)
    except (ValueError, TypeError):
        return False


def _burn_password_work(password: str) -> None:
    hashlib.scrypt(password.encode("utf-8"), salt=b"\x00" * 16, n=2**14, r=8, p=1, dklen=64)


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=SESSION_MAX_AGE,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        path="/",
    )


def _rotate_auth_session(auth_session: UserSession, user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    auth_session.session_token_hash = _session_token_hash(token)
    auth_session.csrf_token = secrets.token_urlsafe(32)
    auth_session.user_id = user_id
    auth_session.created_at = datetime.now(timezone.utc)
    auth_session.expires_at = auth_session.created_at + SESSION_TTL
    return token


def get_optional_auth_session(
    request: Request,
    session: Session = Depends(get_db),
) -> UserSession | None:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        return None
    return session.scalar(
        select(UserSession)
        .where(
            UserSession.session_token_hash == _session_token_hash(token),
            UserSession.expires_at > datetime.now(timezone.utc),
        )
    )


def require_authenticated_user(
    auth_session: UserSession | None = Depends(get_optional_auth_session),
) -> User:
    if auth_session is None or auth_session.user is None:
        raise HTTPException(status_code=401, detail="Authentication required.")
    return auth_session.user


def require_csrf(
    request: Request,
    csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
    auth_session: UserSession | None = Depends(get_optional_auth_session),
) -> UserSession:
    origin = request.headers.get("origin")
    if origin and origin not in ALLOWED_ORIGINS:
        raise HTTPException(status_code=403, detail="Request origin is not allowed.")
    if (
        auth_session is None
        or csrf_token is None
        or not hmac.compare_digest(auth_session.csrf_token, csrf_token)
    ):
        raise HTTPException(status_code=403, detail="CSRF validation failed.")
    return auth_session


def _auth_response(user: User, auth_session: UserSession, response: Response, session: Session) -> AuthSessionResponse:
    token = _rotate_auth_session(auth_session, user.id)
    try:
        session.commit()
    except SQLAlchemyError as exc:
        session.rollback()
        logger.error("Could not create authenticated session (%s).", type(exc).__name__)
        raise _database_unavailable() from exc
    _set_session_cookie(response, token)
    return AuthSessionResponse(
        user=UserResponse(id=user.id, full_name=user.full_name, email=user.email),
        csrf_token=auth_session.csrf_token,
    )


@app.get("/auth/session", response_model=AuthSessionResponse)
def auth_session_status(
    response: Response,
    auth_session: UserSession | None = Depends(get_optional_auth_session),
    session: Session = Depends(get_db),
) -> AuthSessionResponse:
    if auth_session is None:
        token = secrets.token_urlsafe(32)
        auth_session = UserSession(
            session_token_hash=_session_token_hash(token),
            csrf_token=secrets.token_urlsafe(32),
            user_id=None,
            created_at=datetime.now(timezone.utc),
            expires_at=datetime.now(timezone.utc) + SESSION_TTL,
        )
        session.add(auth_session)
        try:
            session.commit()
        except SQLAlchemyError as exc:
            session.rollback()
            logger.error("Could not create anonymous auth session (%s).", type(exc).__name__)
            raise _database_unavailable() from exc
        _set_session_cookie(response, token)
    user = auth_session.user
    return AuthSessionResponse(
        user=UserResponse(id=user.id, full_name=user.full_name, email=user.email) if user else None,
        csrf_token=auth_session.csrf_token,
    )


@app.post("/auth/register", response_model=AuthSessionResponse)
def register(
    registration: RegistrationRequest,
    response: Response,
    auth_session: UserSession = Depends(require_csrf),
    session: Session = Depends(get_db),
) -> AuthSessionResponse:
    if auth_session.user_id is not None:
        raise HTTPException(status_code=409, detail="Sign out before registering another account.")
    user = User(
        id=str(uuid4()),
        full_name=registration.full_name,
        email=registration.email,
        password_hash=_hash_password(registration.password),
    )
    session.add(user)
    token = _rotate_auth_session(auth_session, user.id)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(status_code=409, detail="An account with this email already exists.") from exc
    except SQLAlchemyError as exc:
        session.rollback()
        logger.error("Could not register account (%s).", type(exc).__name__)
        raise _database_unavailable() from exc
    _set_session_cookie(response, token)
    return AuthSessionResponse(
        user=UserResponse(id=user.id, full_name=user.full_name, email=user.email),
        csrf_token=auth_session.csrf_token,
    )


@app.post("/auth/login", response_model=AuthSessionResponse)
def login(
    credentials: LoginRequest,
    request: Request,
    response: Response,
    auth_session: UserSession = Depends(require_csrf),
    session: Session = Depends(get_db),
) -> AuthSessionResponse:
    client_host = request.client.host if request.client else None
    rate_bucket = _login_rate_bucket_key(credentials.email, client_host)
    _check_login_rate_limit(rate_bucket)
    user = session.scalar(select(User).where(User.email == credentials.email))
    if user is None:
        _burn_password_work(credentials.password)
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
    if not _verify_password(credentials.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
    return _auth_response(user, auth_session, response, session)


@app.post("/auth/logout")
def logout(
    response: Response,
    _user: User = Depends(require_authenticated_user),
    auth_session: UserSession = Depends(require_csrf),
    session: Session = Depends(get_db),
) -> dict[str, bool]:
    session.delete(auth_session)
    try:
        session.commit()
    except SQLAlchemyError as exc:
        session.rollback()
        logger.error("Could not terminate authenticated session (%s).", type(exc).__name__)
        raise _database_unavailable() from exc
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path="/",
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
    )
    return {"ok": True}


@app.get("/")
def home() -> dict:
    return {
        "name": "APISentinel",
        "message": "Backend is running. Open /docs to try the API.",
        "endpoints": [
            "/health",
            "/model-info",
            "/predict",
            "/predict-features",
            "/history",
            "/alerts",
            "/analytics/summary",
            "/websites",
            "/docs",
        ],
    }


@app.get("/health")
def health() -> dict:
    model = get_model()
    return {
        "status": "ok",
        "model": model.info.get("model"),
        "features": model.feature_names,
    }


@app.get("/model-info")
def model_info() -> dict:
    return get_model().info


@app.post("/websites", response_model=WebsiteResponse, status_code=201)
def create_website(
    website_data: WebsiteCreate,
    user: User = Depends(require_authenticated_user),
    _csrf: UserSession = Depends(require_csrf),
    session: Session = Depends(get_db),
) -> WebsiteResponse:
    now = datetime.now(timezone.utc)
    website = Website(
        user_id=user.id,
        name=website_data.name,
        base_url=website_data.base_url,
        description=website_data.description,
        integration_type=website_data.integration_type,
        connection_status="Not Connected",
        created_at=now,
        updated_at=now,
    )
    session.add(website)
    try:
        session.commit()
        session.refresh(website)
        return _website_response(website, session)
    except SQLAlchemyError as exc:
        session.rollback()
        logger.error("Could not create website registration (%s).", type(exc).__name__)
        raise _database_unavailable() from exc


@app.get("/websites", response_model=list[WebsiteResponse])
def list_websites(
    user: User = Depends(require_authenticated_user),
    session: Session = Depends(get_db),
) -> list[WebsiteResponse]:
    try:
        websites = session.scalars(
            select(Website)
            .where(Website.user_id == user.id, Website.deleted_at.is_(None))
            .order_by(Website.created_at.desc(), Website.id.desc())
        ).all()
        return [_website_response(website, session) for website in websites]
    except SQLAlchemyError as exc:
        logger.error("Could not list websites (%s).", type(exc).__name__)
        raise _database_unavailable() from exc


@app.get("/websites/{website_id}", response_model=WebsiteResponse)
def get_website(
    website_id: str,
    user: User = Depends(require_authenticated_user),
    session: Session = Depends(get_db),
) -> WebsiteResponse:
    try:
        website = session.scalar(
            select(Website).where(
                Website.id == website_id,
                Website.user_id == user.id,
                Website.deleted_at.is_(None),
            )
        )
    except SQLAlchemyError as exc:
        logger.error("Could not read website registration (%s).", type(exc).__name__)
        raise _database_unavailable() from exc
    if website is None:
        raise HTTPException(status_code=404, detail="Website not found.")
    return _website_response(website, session)


@app.patch("/websites/{website_id}", response_model=WebsiteResponse)
def update_website(
    website_id: str,
    update: WebsiteUpdate,
    user: User = Depends(require_authenticated_user),
    _csrf: UserSession = Depends(require_csrf),
    session: Session = Depends(get_db),
) -> WebsiteResponse:
    try:
        website = session.scalar(
            select(Website).where(
                Website.id == website_id,
                Website.user_id == user.id,
                Website.deleted_at.is_(None),
            )
        )
    except SQLAlchemyError as exc:
        logger.error("Could not read website registration for update (%s).", type(exc).__name__)
        raise _database_unavailable() from exc
    if website is None:
        raise HTTPException(status_code=404, detail="Website not found.")
    changes = update.model_dump(exclude_unset=True)
    if not changes or all(value is None for value in changes.values()):
        raise HTTPException(status_code=422, detail="Provide at least one website field to update.")
    for field, value in changes.items():
        if value is not None:
            setattr(website, field, value)
    website.updated_at = datetime.now(timezone.utc)
    try:
        session.commit()
        session.refresh(website)
        return _website_response(website, session)
    except SQLAlchemyError as exc:
        session.rollback()
        logger.error("Could not update website registration (%s).", type(exc).__name__)
        raise _database_unavailable() from exc


@app.delete("/websites/{website_id}")
def remove_website(
    website_id: str,
    user: User = Depends(require_authenticated_user),
    _csrf: UserSession = Depends(require_csrf),
    session: Session = Depends(get_db),
) -> dict[str, bool]:
    try:
        website = session.scalar(
            select(Website).where(
                Website.id == website_id,
                Website.user_id == user.id,
                Website.deleted_at.is_(None),
            )
        )
    except SQLAlchemyError as exc:
        logger.error("Could not read website registration for removal (%s).", type(exc).__name__)
        raise _database_unavailable() from exc
    if website is None:
        raise HTTPException(status_code=404, detail="Website not found.")
    now = datetime.now(timezone.utc)
    website.deleted_at = now
    website.updated_at = now
    try:
        active_credentials = session.scalars(
            select(WebsiteIntegration).where(
                WebsiteIntegration.website_id == website.id,
                WebsiteIntegration.revoked_at.is_(None),
            )
        ).all()
        for credential in active_credentials:
            credential.revoked_at = now
        if active_credentials:
            website.connection_status = "Disconnected"
        session.commit()
        return {"ok": True}
    except SQLAlchemyError as exc:
        session.rollback()
        logger.error("Could not remove website registration (%s).", type(exc).__name__)
        raise _database_unavailable() from exc


def _issue_website_credential(
    website_id: str,
    *,
    user: User,
    session: Session,
    rotate: bool,
) -> IntegrationCredentialResponse:
    try:
        website = _owned_website(session, website_id, user.id)
        now = datetime.now(timezone.utc)
        active_credentials = session.scalars(
            select(WebsiteIntegration).where(
                WebsiteIntegration.website_id == website.id,
                WebsiteIntegration.revoked_at.is_(None),
            )
        ).all()
        if active_credentials and not rotate:
            raise HTTPException(
                status_code=409,
                detail="An active credential already exists; use the rotation endpoint.",
            )
        for active_credential in active_credentials:
            active_credential.revoked_at = now
        session.flush()

        plaintext, credential_hash = _new_integration_credential()
        integration = WebsiteIntegration(
            website_id=website.id,
            credential_hash=credential_hash,
            created_at=now,
        )
        session.add(integration)
        website.connection_status = "Not Connected"
        website.updated_at = now
        session.commit()
        return IntegrationCredentialResponse(credential=plaintext, created_at=_iso_utc(now))
    except HTTPException:
        session.rollback()
        raise
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(
            status_code=409,
            detail="A credential change conflicted with another request; retry once.",
        ) from exc
    except SQLAlchemyError as exc:
        session.rollback()
        logger.error("Could not update website integration credential (%s).", type(exc).__name__)
        raise _database_unavailable() from exc


@app.post(
    "/websites/{website_id}/integration/credentials",
    response_model=IntegrationCredentialResponse,
    status_code=201,
)
def create_website_credential(
    website_id: str,
    user: User = Depends(require_authenticated_user),
    _csrf: UserSession = Depends(require_csrf),
    session: Session = Depends(get_db),
) -> IntegrationCredentialResponse:
    return _issue_website_credential(website_id, user=user, session=session, rotate=False)


@app.post(
    "/websites/{website_id}/integration/credentials/rotate",
    response_model=IntegrationCredentialResponse,
)
def rotate_website_credential(
    website_id: str,
    user: User = Depends(require_authenticated_user),
    _csrf: UserSession = Depends(require_csrf),
    session: Session = Depends(get_db),
) -> IntegrationCredentialResponse:
    return _issue_website_credential(website_id, user=user, session=session, rotate=True)


@app.post("/websites/{website_id}/integration/credentials/revoke")
def revoke_website_credential(
    website_id: str,
    user: User = Depends(require_authenticated_user),
    _csrf: UserSession = Depends(require_csrf),
    session: Session = Depends(get_db),
) -> dict[str, bool]:
    try:
        website = _owned_website(session, website_id, user.id)
        now = datetime.now(timezone.utc)
        active_credentials = session.scalars(
            select(WebsiteIntegration).where(
                WebsiteIntegration.website_id == website.id,
                WebsiteIntegration.revoked_at.is_(None),
            )
        ).all()
        if not active_credentials:
            raise HTTPException(status_code=404, detail="Active integration credential not found.")
        for integration in active_credentials:
            integration.revoked_at = now
        website.connection_status = "Disconnected"
        website.updated_at = now
        session.commit()
        return {"ok": True}
    except HTTPException:
        session.rollback()
        raise
    except SQLAlchemyError as exc:
        session.rollback()
        logger.error("Could not revoke website integration credential (%s).", type(exc).__name__)
        raise _database_unavailable() from exc


@app.post("/monitoring/events", response_model=MonitoringEventResponse)
async def ingest_monitoring_event(
    request: Request,
    integration_key: str | None = Header(default=None, alias="X-APISentinel-Integration-Key"),
    session: Session = Depends(get_db),
) -> MonitoringEventResponse:
    if not integration_key or len(integration_key) > 128 or not integration_key.startswith("aps_live_"):
        raise HTTPException(status_code=401, detail="Valid integration credentials are required.")
    credential_hash = hashlib.sha256(integration_key.encode("utf-8")).hexdigest()
    try:
        integration = session.scalar(
            select(WebsiteIntegration)
            .join(WebsiteIntegration.website)
            .where(
                WebsiteIntegration.credential_hash == credential_hash,
                WebsiteIntegration.revoked_at.is_(None),
                Website.deleted_at.is_(None),
            )
        )
    except SQLAlchemyError as exc:
        logger.error("Could not validate monitoring integration credential (%s).", type(exc).__name__)
        raise _database_unavailable() from exc
    if integration is None:
        raise HTTPException(status_code=401, detail="Valid integration credentials are required.")

    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type != "application/json":
        raise HTTPException(status_code=415, detail="Monitoring events must use application/json.")
    content_length = request.headers.get("content-length")
    if content_length:
        if not content_length.isdecimal():
            raise HTTPException(status_code=400, detail="Invalid request content length.")
        if int(content_length) > MAX_EVENT_BODY_BYTES:
            raise HTTPException(status_code=413, detail="Monitoring event exceeds the request size limit.")

    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_EVENT_BODY_BYTES:
            raise HTTPException(status_code=413, detail="Monitoring event exceeds the request size limit.")
    try:
        submitted_event = json.loads(body)
        event_data = MonitoringEventIn.model_validate(submitted_event)
        canonical_event = json.dumps(
            submitted_event,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        )
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="Monitoring event did not match the accepted schema.") from exc

    content_hash = hashlib.sha256(canonical_event.encode("utf-8")).hexdigest()
    website = integration.website
    try:
        existing_event = session.scalar(
            select(MonitoringEvent).where(
                MonitoringEvent.website_id == website.id,
                MonitoringEvent.event_id == event_data.event_id,
            )
        )
    except SQLAlchemyError as exc:
        logger.error("Could not check monitoring event idempotency (%s).", type(exc).__name__)
        raise _database_unavailable() from exc

    if existing_event is not None:
        if not hmac.compare_digest(existing_event.content_hash or "", content_hash):
            raise HTTPException(
                status_code=409,
                detail="This event ID was already used for different event content.",
            )
        return MonitoringEventResponse(
            accepted=True,
            event_id=existing_event.id,
            received_at=_iso_utc(existing_event.ingested_at or existing_event.received_at),
            scoring_status=existing_event.scoring_status,
            not_scored_reason=existing_event.not_scored_reason,
            prediction_label=existing_event.prediction_label,
            model_score=existing_event.model_score,
            model_identifier=existing_event.model_identifier,
        )

    _check_ingest_rate_limit(integration.id)

    now = datetime.now(timezone.utc)
    normalized_features, feature_reason = _validated_event_features(event_data.features)
    event_record = MonitoringEvent(
        website_id=website.id,
        owner_user_id=website.user_id,
        event_id=event_data.event_id,
        event_timestamp=event_data.event_timestamp,
        event_timestamp_utc=event_data.event_timestamp,
        received_at=now,
        ingested_at=now,
        method=event_data.method,
        endpoint=event_data.endpoint,
        response_status=event_data.response_status,
        request_duration_ms=float(event_data.request_duration_ms),
        request_size_bytes=event_data.request_size_bytes,
        features=normalized_features,
        actor_id=event_data.actor_id,
        scoring_status="Not Scored",
        not_scored_reason=feature_reason,
        content_hash=content_hash,
    )
    prediction_result: dict | None = None
    if feature_reason is None and normalized_features is not None:
        try:
            prediction_result = get_model().predict_from_features(normalized_features)
            prediction_label = str(prediction_result["prediction"]).lower()
            model_score = float(prediction_result["confidence"])
            if prediction_label not in {"normal", "anomalous"}:
                raise ValueError("The model returned an unsupported prediction label.")
            if not isfinite(model_score) or not 0 <= model_score <= 1:
                raise ValueError("The model returned an invalid score.")
        except Exception as exc:
            logger.error("Could not score monitoring event (%s).", type(exc).__name__)
            event_record.not_scored_reason = (
                f"Model scoring failed: {type(exc).__name__}."
            )
            prediction_result = None
        else:
            event_record.scoring_status = "scored"
            event_record.not_scored_reason = None
            event_record.prediction_label = prediction_label
            event_record.model_score = model_score
            event_record.model_identifier = MODEL_PATH.stem
            add_prediction(
                session,
                method=event_data.method,
                url=event_data.endpoint,
                result=prediction_result,
                user_id=website.user_id,
            )
    integration.last_successful_event_at = now
    website.connection_status = "Receiving Events"
    website.updated_at = now
    session.add(event_record)
    try:
        expiration = now - timedelta(days=EVENT_RETENTION_DAYS)
        expired_event_ids = (
            select(MonitoringEvent.id)
            .where(MonitoringEvent.received_at < expiration)
            .limit(500)
        )
        session.execute(delete(MonitoringEvent).where(MonitoringEvent.id.in_(expired_event_ids)))
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        try:
            existing_event = session.scalar(
                select(MonitoringEvent).where(
                    MonitoringEvent.website_id == website.id,
                    MonitoringEvent.event_id == event_data.event_id,
                )
            )
        except SQLAlchemyError as lookup_exc:
            logger.error("Could not resolve monitoring event ID conflict (%s).", type(lookup_exc).__name__)
            raise _database_unavailable() from lookup_exc
        if existing_event is not None:
            if not hmac.compare_digest(existing_event.content_hash or "", content_hash):
                raise HTTPException(
                    status_code=409,
                    detail="This event ID was already used for different event content.",
                ) from exc
            return MonitoringEventResponse(
                accepted=True,
                event_id=existing_event.id,
                received_at=_iso_utc(existing_event.ingested_at or existing_event.received_at),
                scoring_status=existing_event.scoring_status,
                not_scored_reason=existing_event.not_scored_reason,
                prediction_label=existing_event.prediction_label,
                model_score=existing_event.model_score,
                model_identifier=existing_event.model_identifier,
            )
        logger.error("Could not persist monitoring event (%s).", type(exc).__name__)
        raise _database_unavailable() from exc
    except SQLAlchemyError as exc:
        session.rollback()
        logger.error("Could not persist monitoring event (%s).", type(exc).__name__)
        raise _database_unavailable() from exc
    return MonitoringEventResponse(
        accepted=True,
        event_id=event_record.id,
        received_at=_iso_utc(now),
        scoring_status=event_record.scoring_status,
        not_scored_reason=event_record.not_scored_reason,
        prediction_label=event_record.prediction_label,
        model_score=event_record.model_score,
        model_identifier=event_record.model_identifier,
    )


@app.get("/monitoring/events", response_model=MonitoringEventListResponse)
def list_monitoring_events(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    website_id: str | None = Query(default=None, min_length=1, max_length=36),
    user: User = Depends(require_authenticated_user),
    session: Session = Depends(get_db),
) -> MonitoringEventListResponse:
    try:
        statement = (
            select(MonitoringEvent, Website.name)
            .join(Website, MonitoringEvent.website_id == Website.id)
            .where(MonitoringEvent.owner_user_id == user.id)
        )
        count_statement = (
            select(func.count())
            .select_from(MonitoringEvent)
            .where(MonitoringEvent.owner_user_id == user.id)
        )
        if website_id is not None:
            owned_website = session.scalar(
                select(Website.id).where(
                    Website.id == website_id,
                    Website.user_id == user.id,
                    Website.deleted_at.is_(None),
                )
            )
            if owned_website is None:
                raise HTTPException(status_code=404, detail="Website not found.")
            statement = statement.where(MonitoringEvent.website_id == website_id)
            count_statement = count_statement.where(MonitoringEvent.website_id == website_id)

        rows = session.execute(
            statement
            .order_by(MonitoringEvent.received_at.desc(), MonitoringEvent.id.desc())
            .limit(limit)
            .offset(offset)
        ).all()
        total = session.scalar(count_statement) or 0
        return MonitoringEventListResponse(
            items=[
                MonitoringEventItemResponse(
                    id=event.id,
                    event_id=event.event_id,
                    website_id=event.website_id,
                    website_name=website_name,
                    received_at=_iso_utc(event.received_at),
                    event_timestamp=_iso_utc(event.event_timestamp_utc or event.event_timestamp),
                    method=event.method,
                    endpoint=event.endpoint,
                    response_status=event.response_status,
                    request_duration_ms=event.request_duration_ms,
                    request_size_bytes=event.request_size_bytes,
                    scoring_status=event.scoring_status,
                    prediction_label=event.prediction_label,
                    model_score=event.model_score,
                    model_identifier=event.model_identifier,
                )
                for event, website_name in rows
            ],
            total=total,
            limit=limit,
            offset=offset,
        )
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        logger.error("Could not read monitoring events (%s).", type(exc).__name__)
        raise _database_unavailable() from exc


@app.post("/predict")
def predict(
    scan: RequestScan,
    user: User = Depends(require_authenticated_user),
    _csrf: UserSession = Depends(require_csrf),
    session: Session = Depends(get_db),
) -> dict:
    try:
        result = get_model().predict_from_request(url=scan.url, payload=scan.payload)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        persist_prediction(
            session,
            method=scan.method,
            url=scan.url,
            result=result,
            user_id=user.id,
        )
    except SQLAlchemyError:
        logger.error("Could not persist a prediction; returning the existing prediction response.")
    result["method"] = scan.method.upper()
    result["url"] = scan.url
    return result


@app.post("/predict-features")
def predict_features(
    scan: FeatureScan,
    _user: User = Depends(require_authenticated_user),
    _csrf: UserSession = Depends(require_csrf),
) -> dict:
    try:
        result = get_model().predict_from_features(scan.model_dump())
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return result


@app.get("/history", response_model=HistoryResponse)
def history(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    classification: Literal["normal", "anomalous"] | None = None,
    user: User = Depends(require_authenticated_user),
    session: Session = Depends(get_db),
) -> HistoryResponse:
    try:
        statement = select(PredictionRecord).where(PredictionRecord.user_id == user.id)
        count_statement = select(func.count()).select_from(PredictionRecord).where(PredictionRecord.user_id == user.id)
        if classification:
            statement = statement.where(PredictionRecord.prediction == classification)
            count_statement = count_statement.where(PredictionRecord.prediction == classification)
        records = session.scalars(
            statement.order_by(PredictionRecord.timestamp.desc(), PredictionRecord.id.desc())
            .limit(limit)
            .offset(offset)
        ).all()
        total = session.scalar(count_statement) or 0
        return HistoryResponse(
            items=[_prediction_response(record) for record in records],
            total=total,
            limit=limit,
            offset=offset,
        )
    except SQLAlchemyError as exc:
        logger.error("Could not read prediction history (%s).", type(exc).__name__)
        raise _database_unavailable() from exc


@app.get("/alerts", response_model=AlertsResponse)
def alerts(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(require_authenticated_user),
    session: Session = Depends(get_db),
) -> AlertsResponse:
    try:
        statement = (
            select(AlertRecord)
            .join(AlertRecord.prediction)
            .where(AlertRecord.user_id == user.id)
            .order_by(AlertRecord.created_at.desc(), AlertRecord.id.desc())
            .limit(limit)
            .offset(offset)
        )
        records = session.scalars(statement).all()
        total = session.scalar(
            select(func.count()).select_from(AlertRecord).where(AlertRecord.user_id == user.id)
        ) or 0
        return AlertsResponse(
            items=[_alert_response(record) for record in records],
            total=total,
            limit=limit,
            offset=offset,
        )
    except SQLAlchemyError as exc:
        logger.error("Could not read security alerts (%s).", type(exc).__name__)
        raise _database_unavailable() from exc


@app.patch("/alerts/{alert_id}", response_model=AlertResponse)
def update_alert(
    alert_id: str,
    update: AlertUpdate,
    user: User = Depends(require_authenticated_user),
    _csrf: UserSession = Depends(require_csrf),
    session: Session = Depends(get_db),
) -> AlertResponse:
    try:
        alert = session.scalar(
            select(AlertRecord).where(AlertRecord.id == alert_id, AlertRecord.user_id == user.id)
        )
        if alert is None:
            raise HTTPException(status_code=404, detail="Alert not found.")
        changes = update.model_dump(exclude_unset=True)
        if "review_status" in changes and changes["review_status"] is not None:
            alert.review_status = changes["review_status"]
        if "analyst_notes" in changes and changes["analyst_notes"] is not None:
            alert.analyst_notes = changes["analyst_notes"]
        alert.updated_at = datetime.now(timezone.utc)
        session.commit()
        session.refresh(alert)
        return _alert_response(alert)
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        session.rollback()
        logger.error("Could not update alert (%s).", type(exc).__name__)
        raise _database_unavailable() from exc


@app.get("/analytics/summary", response_model=AnalyticsSummaryResponse)
def analytics_summary(
    user: User = Depends(require_authenticated_user),
    session: Session = Depends(get_db),
) -> AnalyticsSummaryResponse:
    try:
        total_requests = session.scalar(
            select(func.count()).select_from(PredictionRecord).where(PredictionRecord.user_id == user.id)
        ) or 0
        normal_requests = session.scalar(
            select(func.count())
            .select_from(PredictionRecord)
            .where(PredictionRecord.user_id == user.id, PredictionRecord.prediction == "normal")
        ) or 0
        anomalous_requests = session.scalar(
            select(func.count())
            .select_from(PredictionRecord)
            .where(PredictionRecord.user_id == user.id, PredictionRecord.prediction == "anomalous")
        ) or 0
        total_alerts = session.scalar(
            select(func.count()).select_from(AlertRecord).where(AlertRecord.user_id == user.id)
        ) or 0
        return AnalyticsSummaryResponse(
            total_requests=total_requests,
            normal_requests=normal_requests,
            anomalous_requests=anomalous_requests,
            anomaly_rate=(anomalous_requests / total_requests) if total_requests else 0.0,
            total_alerts=total_alerts,
        )
    except SQLAlchemyError as exc:
        logger.error("Could not read analytics summary (%s).", type(exc).__name__)
        raise _database_unavailable() from exc
