"""
Persistent Job Store — SQLite Backend
Replaces the in-memory `jobs` dict so job state survives Gunicorn worker restarts.
Uses WAL mode for concurrent read/write safety across threads.
"""

import os
import json
import time
import sqlite3
import threading
from typing import Optional

# Database file lives next to the app
DB_PATH = os.path.join(os.path.dirname(__file__), "jobs.db")

# Auto-purge completed/errored jobs older than this (seconds)
CLEANUP_AGE = 3600  # 1 hour


class JobStore:
    """Thread-safe, SQLite-backed job store with dict-like access."""

    def __init__(self, db_path: str = DB_PATH):
        self._db_path = db_path
        self._lock = threading.Lock()
        self._init_db()

    # ── Connection helper ──────────────────────────────────────
    def _connect(self) -> sqlite3.Connection:
        """Create a new connection (safe to call from any thread)."""
        conn = sqlite3.connect(self._db_path, check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        """Create the jobs table if it doesn't exist."""
        with self._lock:
            conn = self._connect()
            try:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS jobs (
                        id          TEXT PRIMARY KEY,
                        data        TEXT    NOT NULL,
                        created_at  REAL    NOT NULL,
                        updated_at  REAL    NOT NULL
                    )
                """)
                conn.commit()
            finally:
                conn.close()

    # ── Public API ─────────────────────────────────────────────
    def create(self, job_id: str, job_data: dict):
        """Insert a new job."""
        now = time.time()
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    "INSERT INTO jobs (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)",
                    (job_id, json.dumps(job_data), now, now),
                )
                conn.commit()
            finally:
                conn.close()

    def get(self, job_id: str) -> Optional[dict]:
        """Retrieve a job by ID. Returns None if not found."""
        conn = self._connect()
        try:
            row = conn.execute("SELECT data FROM jobs WHERE id = ?", (job_id,)).fetchone()
            if row:
                return json.loads(row["data"])
            return None
        finally:
            conn.close()

    def exists(self, job_id: str) -> bool:
        """Check if a job exists."""
        conn = self._connect()
        try:
            row = conn.execute("SELECT 1 FROM jobs WHERE id = ?", (job_id,)).fetchone()
            return row is not None
        finally:
            conn.close()

    def update(self, job_id: str, **fields):
        """
        Merge `fields` into the existing job data and persist.
        Usage: job_store.update(job_id, status="processing", progress=42)
        """
        with self._lock:
            conn = self._connect()
            try:
                row = conn.execute("SELECT data FROM jobs WHERE id = ?", (job_id,)).fetchone()
                if not row:
                    return  # Job was cleaned up or never existed
                data = json.loads(row["data"])
                data.update(fields)
                conn.execute(
                    "UPDATE jobs SET data = ?, updated_at = ? WHERE id = ?",
                    (json.dumps(data), time.time(), job_id),
                )
                conn.commit()
            finally:
                conn.close()

    def delete(self, job_id: str):
        """Remove a job."""
        with self._lock:
            conn = self._connect()
            try:
                conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
                conn.commit()
            finally:
                conn.close()

    def cleanup_old(self):
        """Purge completed/errored jobs older than CLEANUP_AGE."""
        cutoff = time.time() - CLEANUP_AGE
        with self._lock:
            conn = self._connect()
            try:
                # Find old jobs that are finished
                rows = conn.execute(
                    "SELECT id, data FROM jobs WHERE updated_at < ?", (cutoff,)
                ).fetchall()
                for row in rows:
                    data = json.loads(row["data"])
                    if data.get("status") in ("completed", "error"):
                        conn.execute("DELETE FROM jobs WHERE id = ?", (row["id"],))
                conn.commit()
            finally:
                conn.close()
