import importlib
import sqlite3
from pathlib import Path

import pytest


def setup_initial_db(path: Path) -> None:
    conn = sqlite3.connect(str(path))
    cur = conn.cursor()
    # Create the old monitoring_events table schema (pre-migration)
    cur.execute(
        '''CREATE TABLE monitoring_events (
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
        );'''
    )
    # Insert a sample row to ensure migrations handle existing data
    cur.execute(
        "INSERT INTO monitoring_events (id, website_id, owner_user_id, event_timestamp, received_at, method, endpoint, response_status, request_duration_ms, request_size_bytes, scoring_status) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (
            "1",
            "w1",
            "u1",
            "2026-10-01T00:00:00",
            "2026-10-01T00:00:01",
            "GET",
            "/",
            200,
            100.0,
            512,
            "Not Scored",
        ),
    )
    conn.commit()
    conn.close()


def read_table_columns(path: Path, table: str):
    conn = sqlite3.connect(str(path))
    cur = conn.cursor()
    cur.execute(f"PRAGMA table_info('{table}')")
    cols = [r[1] for r in cur.fetchall()]
    conn.close()
    return cols


def read_index_list(path: Path, table: str):
    conn = sqlite3.connect(str(path))
    cur = conn.cursor()
    cur.execute(f"PRAGMA index_list('{table}')")
    idxs = [r[1] for r in cur.fetchall()]
    conn.close()
    return idxs


def test_monitoring_event_additive_migration(tmp_path, monkeypatch):
    db_path = tmp_path / "test_migration.db"
    setup_initial_db(db_path)

    # Point the application to the temporary DB before importing the module
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")

    # Ensure project root is importable and reload the module to pick up env var
    import sys

    sys.path.insert(0, str(Path.cwd()))
    import backend.database as db

    importlib.reload(db)

    # Run the additive migration
    db.initialize_database()

    # Verify new columns were added
    cols = read_table_columns(db_path, "monitoring_events")
    expected_columns = [
        "event_id",
        "event_timestamp_utc",
        "ingested_at",
        "not_scored_reason",
        "prediction_label",
        "model_score",
        "model_identifier",
        "content_hash",
    ]
    for c in expected_columns:
        assert c in cols, f"Expected column {c} in monitoring_events"

    # Verify unique index exists
    idxs = read_index_list(db_path, "monitoring_events")
    assert "uq_monitoring_events_website_event_id" in idxs
