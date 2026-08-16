"""
db.py — SQLite persistence layer for Partifi.

All file paths and DB connections are managed here.  app.py imports only
the public functions; no SQLite calls exist anywhere else.

Schema overview
---------------
scores          — one row per uploaded PDF
setups          — zero or more named setup versions per score
generated_parts — cached output PDFs (one set per score, replaced on re-generate)

WAL mode and foreign-key enforcement are enabled on every connection.
"""

import hashlib
import json
import logging
import os
import shutil
import sqlite3
import time
import uuid

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Path constants
# ---------------------------------------------------------------------------

_HERE = os.path.dirname(os.path.abspath(__file__))

STORAGE_DIR = os.path.join(_HERE, "storage")
PDFS_DIR    = os.path.join(STORAGE_DIR, "pdfs")
PARTS_DIR   = os.path.join(STORAGE_DIR, "parts")
DB_PATH     = os.path.join(STORAGE_DIR, "partifi.db")


def pdf_path(score_id: str) -> str:
    """Absolute path to the stored PDF for a given score."""
    return os.path.join(PDFS_DIR, f"{score_id}.pdf")


def part_pdf_path(score_id: str, sanitized_name: str) -> str:
    """Absolute path to a cached generated-part PDF."""
    return os.path.join(PARTS_DIR, score_id, f"{sanitized_name}.pdf")


# ---------------------------------------------------------------------------
# Connection helper
# ---------------------------------------------------------------------------

def get_conn() -> sqlite3.Connection:
    """Open a SQLite connection with WAL mode and foreign-key support.

    Each call returns a new connection; callers are responsible for closing
    (use as context manager: ``with get_conn() as conn:``).
    """
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


# ---------------------------------------------------------------------------
# Schema initialisation (idempotent)
# ---------------------------------------------------------------------------

_DDL = """
CREATE TABLE IF NOT EXISTS scores (
    score_id    TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    composer    TEXT NOT NULL DEFAULT '',
    page_count  INTEGER NOT NULL,
    pages_meta  TEXT NOT NULL,
    pdf_hash    TEXT NOT NULL,
    created_at  REAL NOT NULL,
    updated_at  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS setups (
    setup_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    score_id        TEXT NOT NULL REFERENCES scores(score_id) ON DELETE CASCADE,
    version_name    TEXT NOT NULL DEFAULT 'Default',
    display_width   INTEGER NOT NULL,
    setup_json      TEXT NOT NULL,
    saved_at        REAL NOT NULL,
    UNIQUE (score_id, version_name)
);

CREATE TABLE IF NOT EXISTS generated_parts (
    score_id        TEXT NOT NULL REFERENCES scores(score_id) ON DELETE CASCADE,
    part_name       TEXT NOT NULL,
    page_count      INTEGER NOT NULL,
    staves_count    INTEGER NOT NULL,
    generated_at    REAL NOT NULL,
    PRIMARY KEY (score_id, part_name)
);

CREATE TABLE IF NOT EXISTS composers (
    composer_id   TEXT PRIMARY KEY,
    surname       TEXT NOT NULL,
    name          TEXT NOT NULL DEFAULT '',
    nationality   TEXT NOT NULL DEFAULT '',
    dob           TEXT,
    dod           TEXT,
    gender        TEXT,
    period        TEXT,
    imslp_url     TEXT,
    wikipedia_url TEXT,
    notes         TEXT,
    created_at    REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS score_composers (
    score_id      TEXT NOT NULL REFERENCES scores(score_id) ON DELETE CASCADE,
    composer_id   TEXT NOT NULL REFERENCES composers(composer_id) ON DELETE RESTRICT,
    role          TEXT NOT NULL DEFAULT 'composer',
    sort_order    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (score_id, composer_id)
);
"""


def init_db() -> None:
    """Create the storage directories and database tables if they don't exist."""
    os.makedirs(PDFS_DIR, exist_ok=True)
    os.makedirs(PARTS_DIR, exist_ok=True)
    with get_conn() as conn:
        conn.executescript(_DDL)
    logger.info("DB initialised at %s (pid %d)", DB_PATH, os.getpid())


# ---------------------------------------------------------------------------
# scores table
# ---------------------------------------------------------------------------

def insert_score(
    score_id: str,
    title: str,
    composer: str,
    page_count: int,
    pages_meta: list,
    pdf_hash: str,
) -> None:
    """Insert a new score row.  Raises sqlite3.IntegrityError on duplicate score_id."""
    now = time.time()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO scores
                (score_id, title, composer, page_count, pages_meta, pdf_hash,
                 created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (score_id, title, composer, page_count,
             json.dumps(pages_meta), pdf_hash, now, now),
        )


def get_score(score_id: str) -> sqlite3.Row | None:
    """Return the score row for *score_id*, or None if not found."""
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM scores WHERE score_id = ?", (score_id,)
        ).fetchone()


def list_scores() -> list[sqlite3.Row]:
    """Return all score rows ordered by updated_at descending."""
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM scores ORDER BY updated_at DESC"
        ).fetchall()


def get_score_by_hash(pdf_hash: str) -> sqlite3.Row | None:
    """Return the most-recently-updated score with the given PDF hash, or None."""
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM scores WHERE pdf_hash = ? ORDER BY updated_at DESC LIMIT 1",
            (pdf_hash,),
        ).fetchone()


def touch_score(score_id: str) -> None:
    """Update updated_at to now (refreshes the library sort order)."""
    with get_conn() as conn:
        conn.execute(
            "UPDATE scores SET updated_at = ? WHERE score_id = ?",
            (time.time(), score_id),
        )


def delete_score(score_id: str) -> None:
    """Delete the score row (CASCADE removes setups + generated_parts rows)."""
    with get_conn() as conn:
        conn.execute("DELETE FROM scores WHERE score_id = ?", (score_id,))


def update_score_meta(score_id: str, title: str, composer: str) -> None:
    """Update title/composer for a score (for future use)."""
    with get_conn() as conn:
        conn.execute(
            "UPDATE scores SET title = ?, composer = ?, updated_at = ? WHERE score_id = ?",
            (title, composer, time.time(), score_id),
        )


# ---------------------------------------------------------------------------
# setups table — multiple named versions per score
# ---------------------------------------------------------------------------

def save_setup(
    score_id: str,
    version_name: str,
    display_width: int,
    setup_dict: dict,
    create_new: bool = False,
) -> int:
    """Insert or replace a named setup version.  Returns the setup_id.

    With create_new=True the name must be free: an existing one raises
    sqlite3.IntegrityError instead of being overwritten.  The UNIQUE
    constraint does the rejecting, so concurrent save-as calls cannot both
    pass a check-then-write.
    """
    now = time.time()
    upsert = """
            INSERT INTO setups (score_id, version_name, display_width, setup_json, saved_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(score_id, version_name) DO UPDATE SET
                display_width = excluded.display_width,
                setup_json    = excluded.setup_json,
                saved_at      = excluded.saved_at
            """
    insert_only = """
            INSERT INTO setups (score_id, version_name, display_width, setup_json, saved_at)
            VALUES (?, ?, ?, ?, ?)
            """
    with get_conn() as conn:
        cur = conn.execute(
            insert_only if create_new else upsert,
            (score_id, version_name, display_width, json.dumps(setup_dict), now),
        )
        # Retrieve the setup_id (INSERT OR UPDATE does not return lastrowid reliably)
        row = conn.execute(
            "SELECT setup_id FROM setups WHERE score_id = ? AND version_name = ?",
            (score_id, version_name),
        ).fetchone()
        return row["setup_id"] if row else -1


def load_setup(score_id: str, version_name: str) -> dict | None:
    """Return {setup_id, version_name, display_width, setup_json} or None."""
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT setup_id, version_name, display_width, setup_json, saved_at
            FROM setups WHERE score_id = ? AND version_name = ?
            """,
            (score_id, version_name),
        ).fetchone()
    if row is None:
        return None
    return {
        "setup_id":     row["setup_id"],
        "version_name": row["version_name"],
        "display_width": row["display_width"],
        "setup":        json.loads(row["setup_json"]),
        "saved_at":     row["saved_at"],
    }


def list_setups(score_id: str) -> list[dict]:
    """Return all setup versions for a score, ordered by saved_at descending."""
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT setup_id, version_name, display_width, saved_at
            FROM setups WHERE score_id = ?
            ORDER BY saved_at DESC
            """,
            (score_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def delete_setup(score_id: str, version_name: str) -> bool:
    """Delete a single named setup version.  Returns True if a row was removed."""
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM setups WHERE score_id = ? AND version_name = ?",
            (score_id, version_name),
        )
        return cur.rowcount > 0


def rename_setup(score_id: str, old_name: str, new_name: str) -> bool:
    """Rename a setup version.  Returns False if new_name already exists."""
    with get_conn() as conn:
        try:
            cur = conn.execute(
                "UPDATE setups SET version_name = ? WHERE score_id = ? AND version_name = ?",
                (new_name, score_id, old_name),
            )
            return cur.rowcount > 0
        except sqlite3.IntegrityError:
            return False  # new_name already exists for this score


# ---------------------------------------------------------------------------
# generated_parts table
# ---------------------------------------------------------------------------

def save_generated_parts(score_id: str, parts_list: list[dict]) -> None:
    """Replace all generated-part rows for a score.

    *parts_list* entries must have keys: name (str), page_count (int),
    staves_count (int).
    """
    now = time.time()
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM generated_parts WHERE score_id = ?", (score_id,)
        )
        conn.executemany(
            """
            INSERT INTO generated_parts
                (score_id, part_name, page_count, staves_count, generated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            [
                (score_id, p["name"], p["page_count"], p["staves_count"], now)
                for p in parts_list
            ],
        )


def get_generated_parts(score_id: str) -> list[sqlite3.Row]:
    """Return all generated-part rows for a score."""
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM generated_parts WHERE score_id = ?", (score_id,)
        ).fetchall()


def invalidate_generated_parts(score_id: str) -> None:
    """Remove DB rows and cached PDF files for all generated parts of a score."""
    parts_dir = os.path.join(PARTS_DIR, score_id)
    if os.path.isdir(parts_dir):
        shutil.rmtree(parts_dir)
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM generated_parts WHERE score_id = ?", (score_id,)
        )


# ---------------------------------------------------------------------------
# Utility: SHA-256 hash of file/bytes
# ---------------------------------------------------------------------------

def sha256_of_bytes(data: bytes) -> str:
    """Return the hex SHA-256 digest of *data*."""
    return hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------------------
# composers table
# ---------------------------------------------------------------------------

def insert_composer(
    surname: str,
    name: str = '',
    nationality: str = '',
    dob: str | None = None,
    dod: str | None = None,
    gender: str | None = None,
    period: str | None = None,
    imslp_url: str | None = None,
    wikipedia_url: str | None = None,
    notes: str | None = None,
) -> str:
    """Insert a new composer row and return the generated UUID."""
    composer_id = str(uuid.uuid4())
    now = time.time()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO composers
                (composer_id, surname, name, nationality, dob, dod, gender,
                 period, imslp_url, wikipedia_url, notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (composer_id, surname, name, nationality, dob, dod, gender,
             period, imslp_url, wikipedia_url, notes, now),
        )
    return composer_id


def search_scores(query: str) -> list[sqlite3.Row]:
    """Return scores whose title contains *query* (case-insensitive).

    Returns at most 10 results ordered by updated_at descending.
    """
    pattern = f"%{query}%"
    with get_conn() as conn:
        return conn.execute(
            """
            SELECT score_id, title
            FROM scores
            WHERE title LIKE ?
            ORDER BY updated_at DESC
            LIMIT 10
            """,
            (pattern,),
        ).fetchall()


def update_composer(composer_id: str, **fields) -> bool:
    """Update any subset of composer fields.

    Only keys present in *fields* are written; unknown keys are silently ignored.
    Returns True if a row was updated, False if composer_id was not found.
    """
    _allowed = {
        'surname', 'name', 'nationality', 'dob', 'dod',
        'gender', 'period', 'imslp_url', 'wikipedia_url', 'notes',
    }
    updates = {k: v for k, v in fields.items() if k in _allowed}
    if not updates:
        return False
    cols = ', '.join(f"{k} = ?" for k in updates)
    vals = list(updates.values()) + [composer_id]
    with get_conn() as conn:
        cur = conn.execute(
            f"UPDATE composers SET {cols} WHERE composer_id = ?", vals
        )
        return cur.rowcount > 0


def search_composers(query: str) -> list[sqlite3.Row]:
    """Return composers whose surname or name contains *query* (case-insensitive).

    The user-supplied value is bound as a parameterised ``?`` — no SQL injection risk.
    Returns at most 20 results ordered by surname then name.
    """
    pattern = f"%{query}%"
    with get_conn() as conn:
        return conn.execute(
            """
            SELECT composer_id, surname, name, nationality, period,
                   dob, dod, gender, imslp_url, wikipedia_url, notes
            FROM composers
            WHERE surname LIKE ? OR name LIKE ?
            ORDER BY surname, name
            LIMIT 20
            """,
            (pattern, pattern),
        ).fetchall()


def get_all_composers() -> list[sqlite3.Row]:
    """Return all composers ordered by surname then name."""
    with get_conn() as conn:
        return conn.execute(
            """
            SELECT composer_id, surname, name, nationality, period,
                   dob, dod, gender, imslp_url, wikipedia_url, notes
            FROM composers
            ORDER BY surname, name
            """
        ).fetchall()


# ---------------------------------------------------------------------------
# score_composers join table
# ---------------------------------------------------------------------------

def link_score_composer(
    score_id: str,
    composer_id: str,
    role: str = 'composer',
    sort_order: int = 0,
) -> None:
    """Insert or update a score–composer link.

    Uses ``ON CONFLICT DO UPDATE`` so calling this twice is idempotent.
    Raises ``sqlite3.IntegrityError`` if either FK target does not exist.
    """
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO score_composers (score_id, composer_id, role, sort_order)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(score_id, composer_id) DO UPDATE SET
                role       = excluded.role,
                sort_order = excluded.sort_order
            """,
            (score_id, composer_id, role, sort_order),
        )


def get_score_composers(score_id: str) -> list[sqlite3.Row]:
    """Return all composers linked to a score, ordered by sort_order."""
    with get_conn() as conn:
        return conn.execute(
            """
            SELECT c.composer_id, c.surname, c.name, c.nationality, c.period,
                   c.dob, c.dod, c.gender, c.imslp_url, c.wikipedia_url, c.notes,
                   sc.role, sc.sort_order
            FROM score_composers sc
            JOIN composers c ON c.composer_id = sc.composer_id
            WHERE sc.score_id = ?
            ORDER BY sc.sort_order, c.surname
            """,
            (score_id,),
        ).fetchall()


def unlink_score_composer(score_id: str, composer_id: str) -> bool:
    """Remove a score–composer link.  Returns True if a row was deleted."""
    with get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM score_composers WHERE score_id = ? AND composer_id = ?",
            (score_id, composer_id),
        )
        return cur.rowcount > 0
