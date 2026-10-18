"""SQLite persistence for prediction results and anomaly alerts."""

from __future__ import annotations

import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import uuid4

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Index, Integer, String, Text, create_engine, event, inspect, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATABASE_PATH = PROJECT_ROOT / "data" / "apisentinel.db"
DEFAULT_DATABASE_URL = f"sqlite:///{DEFAULT_DATABASE_PATH.as_posix()}"
SENSITIVE_QUERY_KEY = re.compile(
    r"(?:user(?:name)?|email|pass(?:word|wd)?|pwd|token|secret|credential|"
    r"api[_-]?key|authorization|auth|session(?:id)?|access[_-]?key|"
    r"client[_-]?secret|signature|sig|jwt|bearer|cookie|csrf|xsrf)",
    re.IGNORECASE,
)


def _database_url() -> str:
    configured = os.environ.get("DATABASE_URL", "").strip() or DEFAULT_DATABASE_URL
    parsed = make_url(configured)
    if parsed.get_backend_name() == "sqlite" and parsed.database not in (None, "", ":memory:"):
        path = Path(parsed.database).expanduser()
        if not path.is_absolute():
            path = PROJECT_ROOT / path
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        parsed = parsed.set(database=str(path.resolve()))
    return parsed.render_as_string(hide_password=False)


DATABASE_URL = _database_url()
_engine_options: dict[str, Any] = {"pool_pre_ping": True}
if make_url(DATABASE_URL).get_backend_name() == "sqlite":
    _engine_options["connect_args"] = {"check_same_thread": False}
engine = create_engine(DATABASE_URL, **_engine_options)


if make_url(DATABASE_URL).get_backend_name() == "sqlite":
    @event.listens_for(engine, "connect")
    def _enable_sqlite_foreign_keys(connection: Any, _record: Any) -> None:
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(254), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(256), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )


class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    session_token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    csrf_token: Mapped[str] = mapped_column(String(64), nullable=False)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    user: Mapped[User | None] = relationship()


class Website(Base):
    __tablename__ = "websites"
    __table_args__ = (Index("ix_websites_owner_deleted", "user_id", "deleted_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    base_url: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    integration_type: Mapped[str] = mapped_column(String(32), nullable=False)
    connection_status: Mapped[str] = mapped_column(String(32), nullable=False, default="Not Connected")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    integrations: Mapped[list[WebsiteIntegration]] = relationship(
        back_populates="website", cascade="all, delete-orphan"
    )


class WebsiteIntegration(Base):
    __tablename__ = "website_integrations"
    __table_args__ = (
        Index(
            "uq_website_integrations_active",
            "website_id",
            unique=True,
            sqlite_where=text("revoked_at IS NULL"),
        ),
        Index("ix_website_integrations_website_revoked", "website_id", "revoked_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    website_id: Mapped[str] = mapped_column(
        ForeignKey("websites.id", ondelete="CASCADE"), nullable=False, index=True
    )
    credential_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    last_successful_event_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    website: Mapped[Website] = relationship(back_populates="integrations")


class MonitoringEvent(Base):
    __tablename__ = "monitoring_events"
    __table_args__ = (
        Index("ix_monitoring_events_website_time", "website_id", "event_timestamp"),
        Index("ix_monitoring_events_owner_time", "owner_user_id", "event_timestamp"),
        Index(
            "uq_monitoring_events_website_event_id",
            "website_id",
            "event_id",
            unique=True,
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    website_id: Mapped[str] = mapped_column(
        ForeignKey("websites.id", ondelete="CASCADE"), nullable=False, index=True
    )
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    event_timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    method: Mapped[str] = mapped_column(String(10), nullable=False)
    endpoint: Mapped[str] = mapped_column(String(512), nullable=False)
    response_status: Mapped[int] = mapped_column(Integer, nullable=False)
    request_duration_ms: Mapped[float] = mapped_column(Float, nullable=False)
    request_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    features: Mapped[dict[str, float] | None] = mapped_column(JSON, nullable=True)
    actor_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    scoring_status: Mapped[str] = mapped_column(String(32), nullable=False, default="Not Scored")
    event_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    event_timestamp_utc: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ingested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    not_scored_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    prediction_label: Mapped[str | None] = mapped_column(String(32), nullable=True)
    model_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    model_identifier: Mapped[str | None] = mapped_column(String(128), nullable=True)
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    website: Mapped[Website] = relationship()


class PredictionRecord(Base):
    __tablename__ = "prediction_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), index=True)
    method: Mapped[str] = mapped_column(String(16), nullable=False)
    sanitized_url: Mapped[str] = mapped_column(Text, nullable=False)
    prediction: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    class_id: Mapped[int] = mapped_column(Integer, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    normal_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    anomalous_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    features: Mapped[dict[str, float]] = mapped_column(JSON, nullable=False)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    alert: Mapped[AlertRecord | None] = relationship(back_populates="prediction", uselist=False)


class AlertRecord(Base):
    __tablename__ = "alerts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    prediction_id: Mapped[str] = mapped_column(
        ForeignKey("prediction_records.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), index=True)
    review_status: Mapped[str] = mapped_column(String(20), nullable=False, default="New")
    analyst_notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    prediction: Mapped[PredictionRecord] = relationship(back_populates="alert")


def initialize_database() -> None:
    User.__table__.create(bind=engine, checkfirst=True)
    UserSession.__table__.create(bind=engine, checkfirst=True)
    existing_tables = set(inspect(engine).get_table_names())

    # Backwards-compatible additive migrations for small schema changes.
    # Add user_id to a couple of legacy tables when missing (existing behaviour).
    for table_name in ("prediction_records", "alerts"):
        if table_name not in existing_tables:
            continue
        columns = {column["name"] for column in inspect(engine).get_columns(table_name)}
        if "user_id" not in columns:
            with engine.begin() as connection:
                connection.execute(
                    text(f'ALTER TABLE "{table_name}" ADD COLUMN user_id VARCHAR(36) REFERENCES users(id)')
                )

    # Additive migration for monitoring_events: add new nullable columns and a unique index
    # so existing rows are preserved and future rows can use the new fields.
    if "monitoring_events" in existing_tables:
        columns = {column["name"] for column in inspect(engine).get_columns("monitoring_events")}
        with engine.begin() as connection:
            # Add sender-provided event id (nullable for existing rows)
            if "event_id" not in columns:
                connection.execute(text('ALTER TABLE "monitoring_events" ADD COLUMN event_id VARCHAR(128)'))

            # Original event timestamp (preserve existing event_timestamp as-is; this is the sender's UTC time)
            if "event_timestamp_utc" not in columns:
                connection.execute(text('ALTER TABLE "monitoring_events" ADD COLUMN event_timestamp_utc DATETIME'))

            # Server ingestion time; default to current timestamp for new rows, nullable for old rows
            if "ingested_at" not in columns:
                # Add ingestion timestamp column (nullable for existing rows). Avoid non-constant defaults for ALTER TABLE
                connection.execute(text('ALTER TABLE "monitoring_events" ADD COLUMN ingested_at DATETIME'))

            # Scoring fields: scoring_status already exists on current schema; add not_scored_reason if missing
            if "not_scored_reason" not in columns:
                connection.execute(text('ALTER TABLE "monitoring_events" ADD COLUMN not_scored_reason TEXT'))

            # Prediction and model metadata
            if "prediction_label" not in columns:
                connection.execute(text('ALTER TABLE "monitoring_events" ADD COLUMN prediction_label VARCHAR(32)'))
            if "model_score" not in columns:
                connection.execute(text('ALTER TABLE "monitoring_events" ADD COLUMN model_score FLOAT'))
            if "model_identifier" not in columns:
                connection.execute(text('ALTER TABLE "monitoring_events" ADD COLUMN model_identifier VARCHAR(128)'))

            # Content hash to detect conflicting duplicate IDs
            if "content_hash" not in columns:
                connection.execute(text('ALTER TABLE "monitoring_events" ADD COLUMN content_hash VARCHAR(128)'))

            # Add a UNIQUE index across website_id + event_id to enforce sender-provided uniqueness
            # Use CREATE UNIQUE INDEX IF NOT EXISTS to avoid table rewrite and to be additive-safe.
            connection.execute(
                text(
                    'CREATE UNIQUE INDEX IF NOT EXISTS uq_monitoring_events_website_event_id ON monitoring_events(website_id, event_id)'
                )
            )

    # Create any remaining tables from the model (no destructive ops performed here)
    Base.metadata.create_all(bind=engine)
    if make_url(DATABASE_URL).database == str(DEFAULT_DATABASE_PATH.resolve()):
        os.chmod(DEFAULT_DATABASE_PATH.parent, 0o700)
        os.chmod(DEFAULT_DATABASE_PATH, 0o600)


def get_db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def sanitize_url(value: str) -> str:
    """Remove URL credentials, fragments, and values of sensitive query parameters."""
    try:
        parsed = urlsplit(value)
        safe_query = [
            (key, "[REDACTED]" if SENSITIVE_QUERY_KEY.search(key) else query_value)
            for key, query_value in parse_qsl(parsed.query, keep_blank_values=True)
        ]
        safe_netloc = parsed.netloc.rsplit("@", 1)[-1]
        return urlunsplit((parsed.scheme, safe_netloc, parsed.path, urlencode(safe_query), ""))
    except (ValueError, UnicodeError):
        return value.split("?", 1)[0].split("#", 1)[0]


def utc_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def persist_prediction(
    session: Session,
    *,
    method: str,
    url: str,
    result: dict[str, Any],
    user_id: str,
) -> PredictionRecord:
    record = add_prediction(
        session,
        method=method,
        url=url,
        result=result,
        user_id=user_id,
    )
    try:
        session.commit()
        session.refresh(record)
    except SQLAlchemyError:
        session.rollback()
        raise
    return record


def add_prediction(
    session: Session,
    *,
    method: str,
    url: str,
    result: dict[str, Any],
    user_id: str,
) -> PredictionRecord:
    """Stage a prediction and its alert in the caller's transaction."""
    probabilities = result.get("probabilities") or {}
    record = PredictionRecord(
        method=method.upper(),
        sanitized_url=sanitize_url(url),
        prediction=str(result["prediction"]).lower(),
        class_id=int(result["class_id"]),
        confidence=float(result["confidence"]),
        normal_score=probabilities.get("normal"),
        anomalous_score=probabilities.get("anomalous"),
        features={key: float(value) for key, value in result["features"].items()},
        user_id=user_id,
    )
    session.add(record)
    if record.prediction == "anomalous":
        session.add(AlertRecord(prediction=record, user_id=user_id))
    return record
