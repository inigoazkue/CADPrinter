import sqlite3
import os
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "cad_printer.db"
PRINTS_DIR = DATA_DIR / "prints"
PREVIEWS_DIR = DATA_DIR / "previews"

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    format      TEXT    NOT NULL DEFAULT 'A3',
    is_current  INTEGER NOT NULL DEFAULT 0,
    source_user TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    status      TEXT    NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS sheets (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id     INTEGER NOT NULL,
    name       TEXT,
    order_num  INTEGER NOT NULL DEFAULT 1,
    rotation   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS prints (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id        INTEGER NOT NULL,
    sheet_id      INTEGER,
    filename      TEXT    NOT NULL,
    original_name TEXT,
    preview_path  TEXT,
    format        TEXT,
    source_user   TEXT,
    order_num     INTEGER NOT NULL DEFAULT 0,
    enabled       INTEGER NOT NULL DEFAULT 1,
    received_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    offset_x_mm   REAL    DEFAULT 0,
    offset_y_mm   REAL    DEFAULT 0,
    scale         REAL    DEFAULT 1.0,
    tile_col      INTEGER,
    tile_row      INTEGER,
    FOREIGN KEY (job_id)   REFERENCES jobs(id)   ON DELETE CASCADE,
    FOREIGN KEY (sheet_id) REFERENCES sheets(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS user_active_jobs (
    source_user TEXT    PRIMARY KEY,
    job_id      INTEGER,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
);
"""


def init_db():
    os.makedirs(PRINTS_DIR, exist_ok=True)
    os.makedirs(PREVIEWS_DIR, exist_ok=True)
    conn = get_db()
    conn.executescript(SCHEMA)
    # Migrations for existing installs
    print_cols = [row[1] for row in conn.execute("PRAGMA table_info(prints)")]
    if 'format' not in print_cols:
        conn.execute("ALTER TABLE prints ADD COLUMN format TEXT")
    if 'source_user' not in print_cols:
        conn.execute("ALTER TABLE prints ADD COLUMN source_user TEXT")
    if 'offset_x_mm' not in print_cols:
        conn.execute("ALTER TABLE prints ADD COLUMN offset_x_mm REAL DEFAULT 0")
    if 'offset_y_mm' not in print_cols:
        conn.execute("ALTER TABLE prints ADD COLUMN offset_y_mm REAL DEFAULT 0")
    if 'scale' not in print_cols:
        conn.execute("ALTER TABLE prints ADD COLUMN scale REAL DEFAULT 1.0")
    if 'tile_col' not in print_cols:
        conn.execute("ALTER TABLE prints ADD COLUMN tile_col INTEGER")
    if 'tile_row' not in print_cols:
        conn.execute("ALTER TABLE prints ADD COLUMN tile_row INTEGER")
    job_cols = [row[1] for row in conn.execute("PRAGMA table_info(jobs)")]
    if 'source_user' not in job_cols:
        conn.execute("ALTER TABLE jobs ADD COLUMN source_user TEXT")
    sheet_cols = [row[1] for row in conn.execute("PRAGMA table_info(sheets)")]
    if 'rotation' not in sheet_cols:
        conn.execute("ALTER TABLE sheets ADD COLUMN rotation INTEGER NOT NULL DEFAULT 0")
    # Old auto-names ("Orria N") → NULL so they renumber sequentially in the UI.
    conn.execute("UPDATE sheets SET name = NULL WHERE name LIKE 'Orria %'")
    conn.commit()
    conn.close()


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.row_factory = sqlite3.Row
    return conn


# ── Job helpers ──────────────────────────────────────────────────────────────

def db_list_jobs(conn):
    # Counts exclude the "Iturriak" reference sheet (and its original print),
    # since it is not a real output sheet.
    return conn.execute("""
        SELECT j.*,
               (SELECT COUNT(*) FROM sheets s
                  WHERE s.job_id = j.id AND COALESCE(s.name, '') != 'Iturriak') AS sheet_count,
               (SELECT COUNT(*) FROM prints p
                  LEFT JOIN sheets s2 ON p.sheet_id = s2.id
                  WHERE p.job_id = j.id AND COALESCE(s2.name, '') != 'Iturriak') AS print_count
        FROM jobs j ORDER BY j.created_at DESC
    """).fetchall()


def db_get_job(conn, job_id: int):
    return conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()


def db_get_current_job(conn):
    return conn.execute("SELECT * FROM jobs WHERE is_current = 1 LIMIT 1").fetchone()


def db_get_job_full(conn, job_id: int):
    job = db_get_job(conn, job_id)
    if not job:
        return None
    sheets = conn.execute(
        "SELECT * FROM sheets WHERE job_id = ? ORDER BY order_num", (job_id,)
    ).fetchall()
    result = dict(job)
    result["sheets"] = []
    for sheet in sheets:
        prints = conn.execute(
            "SELECT * FROM prints WHERE sheet_id = ? ORDER BY received_at, id",
            (sheet["id"],)
        ).fetchall()
        result["sheets"].append({**dict(sheet), "prints": [dict(p) for p in prints]})
    return result


def db_create_job(conn, name: str, fmt: str, activate_globally: bool = True,
                  source_user: str = None) -> int:
    if activate_globally:
        conn.execute("UPDATE jobs SET is_current = 0")
    cur = conn.execute(
        "INSERT INTO jobs (name, format, is_current, source_user) VALUES (?, ?, ?, ?)",
        (name, fmt, 1 if activate_globally else 0, source_user)
    )
    job_id = cur.lastrowid
    # name NULL → frontend shows the sequential "N. orria" label.
    conn.execute(
        "INSERT INTO sheets (job_id, name, order_num) VALUES (?, NULL, 1)", (job_id,)
    )
    return job_id


def db_activate_job(conn, job_id: int):
    conn.execute("UPDATE jobs SET is_current = 0")
    conn.execute("UPDATE jobs SET is_current = 1 WHERE id = ?", (job_id,))


def db_get_first_sheet(conn, job_id: int):
    return conn.execute(
        "SELECT * FROM sheets WHERE job_id = ? ORDER BY order_num LIMIT 1", (job_id,)
    ).fetchone()


# ── Sheet helpers ─────────────────────────────────────────────────────────────

def db_count_sheets(conn, job_id: int) -> int:
    return conn.execute(
        "SELECT COUNT(*) FROM sheets WHERE job_id = ?", (job_id,)
    ).fetchone()[0]


def db_next_sheet_order(conn, job_id: int) -> int:
    row = conn.execute(
        "SELECT MAX(order_num) FROM sheets WHERE job_id = ?", (job_id,)
    ).fetchone()
    return (row[0] or 0) + 1


# ── User active job helpers ───────────────────────────────────────────────────

def db_get_user_active_job(conn, source_user: str):
    return conn.execute(
        """SELECT j.* FROM user_active_jobs u
           JOIN jobs j ON j.id = u.job_id
           WHERE u.source_user = ? AND u.job_id IS NOT NULL""",
        (source_user,)
    ).fetchone()


def db_set_user_active_job(conn, source_user: str, job_id: int):
    conn.execute(
        "INSERT OR REPLACE INTO user_active_jobs (source_user, job_id) VALUES (?, ?)",
        (source_user, job_id)
    )


def db_list_user_active_jobs(conn) -> dict:
    rows = conn.execute(
        "SELECT source_user, job_id FROM user_active_jobs WHERE job_id IS NOT NULL"
    ).fetchall()
    return {row[0]: row[1] for row in rows}
