import asyncio
import json
import os
import shutil
import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend import database as db
from backend import pdf_utils

BASE_DIR = Path(__file__).parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"

app = FastAPI(title="CAD Printer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# SSE broadcast queue list
_sse_queues: list[asyncio.Queue] = []


async def broadcast(event_type: str, data: dict = {}):
    msg = json.dumps({"type": event_type, "data": data})
    for q in list(_sse_queues):
        await q.put(msg)


@app.on_event("startup")
def startup():
    db.init_db()


# ── SSE ──────────────────────────────────────────────────────────────────────

@app.get("/api/events")
async def sse_events(request: Request):
    queue: asyncio.Queue = asyncio.Queue()
    _sse_queues.append(queue)

    async def generator():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=25.0)
                    yield f"data: {msg}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            if queue in _sse_queues:
                _sse_queues.remove(queue)

    return StreamingResponse(generator(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ── Jobs ──────────────────────────────────────────────────────────────────────

@app.get("/api/jobs")
def list_jobs():
    conn = db.get_db()
    try:
        rows = db.db_list_jobs(conn)
        user_active = db.db_list_user_active_jobs(conn)
        return {"jobs": [dict(r) for r in rows], "userActiveJobs": user_active}
    finally:
        conn.close()


@app.get("/api/jobs/current")
def get_current_job():
    conn = db.get_db()
    try:
        row = db.db_get_current_job(conn)
        return dict(row) if row else None
    finally:
        conn.close()


class JobCreate(BaseModel):
    name: str
    format: str = "A3"  # A3 | A4


@app.post("/api/jobs", status_code=201)
async def create_job(body: JobCreate):
    if body.format not in ("A3", "A4"):
        raise HTTPException(400, "format must be A3 or A4")
    conn = db.get_db()
    try:
        job_id = db.db_create_job(conn, body.name.strip(), body.format)
        conn.commit()
        job = db.db_get_job_full(conn, job_id)
        await broadcast("job_created", {"job_id": job_id})
        return job
    finally:
        conn.close()


@app.get("/api/jobs/{job_id}")
def get_job(job_id: int):
    conn = db.get_db()
    try:
        job = db.db_get_job_full(conn, job_id)
        if not job:
            raise HTTPException(404, "Job not found")
        return job
    finally:
        conn.close()


class JobUpdate(BaseModel):
    name: Optional[str] = None
    format: Optional[str] = None


@app.patch("/api/jobs/{job_id}")
async def update_job(job_id: int, body: JobUpdate):
    conn = db.get_db()
    try:
        job = db.db_get_job(conn, job_id)
        if not job:
            raise HTTPException(404, "Job not found")
        if body.format and body.format not in ("A3", "A4"):
            raise HTTPException(400, "format must be A3 or A4")
        if body.name is not None:
            conn.execute("UPDATE jobs SET name = ? WHERE id = ?", (body.name.strip(), job_id))
        if body.format is not None:
            conn.execute("UPDATE jobs SET format = ? WHERE id = ?", (body.format, job_id))
        conn.commit()
        await broadcast("job_updated", {"job_id": job_id})
        return db.db_get_job_full(conn, job_id)
    finally:
        conn.close()


@app.delete("/api/jobs/{job_id}")
async def delete_job(job_id: int):
    conn = db.get_db()
    try:
        job = db.db_get_job(conn, job_id)
        if not job:
            raise HTTPException(404, "Job not found")
        # Delete PDF and preview files
        prints = conn.execute("SELECT * FROM prints WHERE job_id = ?", (job_id,)).fetchall()
        for p in prints:
            _delete_print_files(p["filename"], p["preview_path"])
        conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
        conn.commit()
        await broadcast("job_deleted", {"job_id": job_id})
        return {"ok": True}
    finally:
        conn.close()


@app.post("/api/jobs/{job_id}/activate")
async def activate_job(job_id: int):
    conn = db.get_db()
    try:
        if not db.db_get_job(conn, job_id):
            raise HTTPException(404, "Job not found")
        db.db_activate_job(conn, job_id)
        conn.commit()
        await broadcast("job_activated", {"job_id": job_id})
        return {"ok": True}
    finally:
        conn.close()


@app.get("/api/jobs/{job_id}/export")
def export_job(job_id: int):
    conn = db.get_db()
    try:
        job = db.db_get_job_full(conn, job_id)
        if not job:
            raise HTTPException(404, "Job not found")

        sheets_paths = []
        for sheet in job["sheets"]:
            enabled = [
                str(db.PRINTS_DIR / p["filename"])
                for p in sheet["prints"] if p["enabled"]
            ]
            if enabled:
                sheets_paths.append(enabled)

        if not sheets_paths:
            raise HTTPException(400, "No hay capas habilitadas para exportar")

        out_name = f"export_{job_id}_{uuid.uuid4().hex[:6]}.pdf"
        out_path = db.DATA_DIR / out_name
        ok = pdf_utils.export_job_pdf(sheets_paths, job["format"], str(out_path))
        if not ok:
            raise HTTPException(500, "Error generando PDF")

        safe_name = job["name"].replace(" ", "_") + ".pdf"
        return FileResponse(str(out_path), media_type="application/pdf",
                            filename=safe_name,
                            headers={"Content-Disposition": f'attachment; filename="{safe_name}"'})
    finally:
        conn.close()


# ── Sheets ────────────────────────────────────────────────────────────────────

@app.post("/api/jobs/{job_id}/sheets", status_code=201)
async def add_sheet(job_id: int):
    conn = db.get_db()
    try:
        if not db.db_get_job(conn, job_id):
            raise HTTPException(404, "Job not found")
        order = db.db_next_sheet_order(conn, job_id)
        name = f"Orria {order}"
        cur = conn.execute(
            "INSERT INTO sheets (job_id, name, order_num) VALUES (?, ?, ?)",
            (job_id, name, order)
        )
        sheet_id = cur.lastrowid
        conn.commit()
        await broadcast("sheet_added", {"job_id": job_id, "sheet_id": sheet_id})
        return dict(conn.execute("SELECT * FROM sheets WHERE id = ?", (sheet_id,)).fetchone())
    finally:
        conn.close()


class SheetUpdate(BaseModel):
    name: Optional[str] = None


@app.patch("/api/sheets/{sheet_id}")
async def update_sheet(sheet_id: int, body: SheetUpdate):
    conn = db.get_db()
    try:
        sheet = conn.execute("SELECT * FROM sheets WHERE id = ?", (sheet_id,)).fetchone()
        if not sheet:
            raise HTTPException(404, "Sheet not found")
        if body.name is not None:
            conn.execute("UPDATE sheets SET name = ? WHERE id = ?", (body.name.strip(), sheet_id))
        conn.commit()
        await broadcast("sheet_updated", {"sheet_id": sheet_id, "job_id": sheet["job_id"]})
        return dict(conn.execute("SELECT * FROM sheets WHERE id = ?", (sheet_id,)).fetchone())
    finally:
        conn.close()


@app.delete("/api/sheets/{sheet_id}")
async def delete_sheet(sheet_id: int):
    conn = db.get_db()
    try:
        sheet = conn.execute("SELECT * FROM sheets WHERE id = ?", (sheet_id,)).fetchone()
        if not sheet:
            raise HTTPException(404, "Sheet not found")
        job_id = sheet["job_id"]
        if db.db_count_sheets(conn, job_id) <= 1:
            raise HTTPException(400, "No se puede borrar la única hoja del trabajo")
        # Move prints to sheet 1
        first = db.db_get_first_sheet(conn, job_id)
        if first and first["id"] != sheet_id:
            conn.execute(
                "UPDATE prints SET sheet_id = ? WHERE sheet_id = ?", (first["id"], sheet_id)
            )
        conn.execute("DELETE FROM sheets WHERE id = ?", (sheet_id,))
        conn.commit()
        await broadcast("sheet_deleted", {"sheet_id": sheet_id, "job_id": job_id})
        return {"ok": True}
    finally:
        conn.close()


@app.get("/api/sheets/{sheet_id}/preview")
def sheet_preview(sheet_id: int):
    conn = db.get_db()
    try:
        sheet = conn.execute("SELECT * FROM sheets WHERE id = ?", (sheet_id,)).fetchone()
        if not sheet:
            raise HTTPException(404, "Sheet not found")
        job = db.db_get_job(conn, sheet["job_id"])
        prints = conn.execute(
            "SELECT * FROM prints WHERE sheet_id = ? AND enabled = 1 ORDER BY order_num, received_at",
            (sheet_id,)
        ).fetchall()
        paths = [str(db.PRINTS_DIR / p["filename"]) for p in prints]
        preview_path = str(db.PREVIEWS_DIR / f"sheet_{sheet_id}_combined.png")
        pdf_utils.generate_sheet_preview(paths, job["format"], preview_path)
        if not os.path.exists(preview_path):
            raise HTTPException(500, "Error generating preview")
        return FileResponse(preview_path, media_type="image/png",
                            headers={"Cache-Control": "no-store"})
    finally:
        conn.close()


# ── Prints ────────────────────────────────────────────────────────────────────

@app.post("/api/sheets/{sheet_id}/prints", status_code=201)
async def upload_print(sheet_id: int, file: UploadFile = File(...)):
    conn = db.get_db()
    try:
        sheet = conn.execute("SELECT * FROM sheets WHERE id = ?", (sheet_id,)).fetchone()
        if not sheet:
            raise HTTPException(404, "Sheet not found")
        print_id, filename, preview_path, print_fmt = _store_print_file(file, sheet["job_id"])
        order = _next_print_order(conn, sheet_id)
        conn.execute(
            """INSERT INTO prints (id, job_id, sheet_id, filename, original_name, preview_path, order_num, format)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (print_id, sheet["job_id"], sheet_id, filename,
             file.filename, preview_path, order, print_fmt)
        )
        conn.commit()
        row = dict(conn.execute("SELECT * FROM prints WHERE id = ?", (print_id,)).fetchone())
        await broadcast("print_added", {"job_id": sheet["job_id"], "sheet_id": sheet_id})
        return row
    finally:
        conn.close()


@app.get("/api/prints/{print_id}/preview")
def print_preview(print_id: int):
    conn = db.get_db()
    try:
        p = conn.execute("SELECT * FROM prints WHERE id = ?", (print_id,)).fetchone()
        if not p:
            raise HTTPException(404, "Print not found")
        preview = p["preview_path"]
        if not preview or not os.path.exists(preview):
            raise HTTPException(404, "Preview not available")
        return FileResponse(preview, media_type="image/png",
                            headers={"Cache-Control": "max-age=3600"})
    finally:
        conn.close()


class PrintUpdate(BaseModel):
    enabled: Optional[bool] = None
    sheet_id: Optional[int] = None
    order_num: Optional[int] = None


@app.patch("/api/prints/{print_id}")
async def update_print(print_id: int, body: PrintUpdate):
    conn = db.get_db()
    try:
        p = conn.execute("SELECT * FROM prints WHERE id = ?", (print_id,)).fetchone()
        if not p:
            raise HTTPException(404, "Print not found")
        if body.enabled is not None:
            conn.execute("UPDATE prints SET enabled = ? WHERE id = ?",
                         (1 if body.enabled else 0, print_id))
        if body.sheet_id is not None:
            sheet = conn.execute("SELECT * FROM sheets WHERE id = ?", (body.sheet_id,)).fetchone()
            if not sheet or sheet["job_id"] != p["job_id"]:
                raise HTTPException(400, "Invalid sheet")
            conn.execute("UPDATE prints SET sheet_id = ? WHERE id = ?", (body.sheet_id, print_id))
        if body.order_num is not None:
            conn.execute("UPDATE prints SET order_num = ? WHERE id = ?", (body.order_num, print_id))
        conn.commit()
        await broadcast("print_updated", {"print_id": print_id, "job_id": p["job_id"]})
        return dict(conn.execute("SELECT * FROM prints WHERE id = ?", (print_id,)).fetchone())
    finally:
        conn.close()


@app.delete("/api/prints/{print_id}")
async def delete_print(print_id: int):
    conn = db.get_db()
    try:
        p = conn.execute("SELECT * FROM prints WHERE id = ?", (print_id,)).fetchone()
        if not p:
            raise HTTPException(404, "Print not found")
        job_id = p["job_id"]
        _delete_print_files(p["filename"], p["preview_path"])
        conn.execute("DELETE FROM prints WHERE id = ?", (print_id,))
        conn.commit()
        await broadcast("print_deleted", {"print_id": print_id, "job_id": job_id})
        return {"ok": True}
    finally:
        conn.close()


# ── Internal (called by watcher) ──────────────────────────────────────────────

class InternalPrint(BaseModel):
    filepath: str
    filename: str
    original_name: Optional[str] = None
    source_user: Optional[str] = None


@app.post("/api/internal/new-print", status_code=201)
async def internal_new_print(body: InternalPrint):
    """Called by watcher.py when cups-pdf drops a new file."""
    conn = db.get_db()
    try:
        if body.source_user:
            job = db.db_get_user_active_job(conn, body.source_user)
            if not job:
                fmt = pdf_utils.detect_format(body.filepath)
                job_id = db.db_create_job(
                    conn, f"Lana {_job_counter(conn)}", fmt,
                    activate_globally=False, source_user=body.source_user
                )
                conn.commit()
                db.db_set_user_active_job(conn, body.source_user, job_id)
                conn.commit()
                job = db.db_get_job(conn, job_id)
                await broadcast("job_created", {"job_id": job_id})
            job_id = job["id"]
        else:
            job = db.db_get_current_job(conn)
            if not job:
                fmt = pdf_utils.detect_format(body.filepath)
                job_id = db.db_create_job(conn, f"Lana {_job_counter(conn)}", fmt)
                conn.commit()
                job = db.db_get_job(conn, job_id)
                await broadcast("job_created", {"job_id": job_id})
            job_id = job["id"]

        sheet = db.db_get_first_sheet(conn, job_id)
        sheet_id = sheet["id"]

        print_id = _new_id()
        preview_path = str(db.PREVIEWS_DIR / f"{print_id}.png")
        pdf_utils.generate_preview(body.filepath, preview_path)
        if not os.path.exists(preview_path):
            preview_path = None
        print_fmt = pdf_utils.detect_format(body.filepath)

        order = _next_print_order(conn, sheet_id)
        conn.execute(
            """INSERT INTO prints
               (id, job_id, sheet_id, filename, original_name, preview_path, order_num, format, source_user)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (print_id, job_id, sheet_id, body.filename,
             body.original_name or body.filename, preview_path, order, print_fmt, body.source_user)
        )
        conn.commit()
        await broadcast("print_added", {"job_id": job_id, "sheet_id": sheet_id})
        return {"ok": True, "print_id": print_id, "job_id": job_id}
    finally:
        conn.close()


@app.post("/api/users/{source_user}/jobs/{job_id}/activate")
async def activate_user_job(source_user: str, job_id: int):
    conn = db.get_db()
    try:
        if not db.db_get_job(conn, job_id):
            raise HTTPException(404, "Job not found")
        db.db_set_user_active_job(conn, source_user, job_id)
        conn.commit()
        await broadcast("job_activated", {"job_id": job_id, "source_user": source_user})
        return {"ok": True}
    finally:
        conn.close()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _new_id() -> int:
    import time
    return int(time.time() * 1000) % (2 ** 31)


def _job_counter(conn) -> int:
    return (conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] or 0) + 1


def _next_print_order(conn, sheet_id: int) -> int:
    row = conn.execute(
        "SELECT MAX(order_num) FROM prints WHERE sheet_id = ?", (sheet_id,)
    ).fetchone()
    return (row[0] or 0) + 1


def _store_print_file(file: UploadFile, job_id: int) -> tuple[int, str, Optional[str], str]:
    print_id = _new_id()
    ext = Path(file.filename).suffix or ".pdf"
    filename = f"{print_id}{ext}"
    pdf_path = str(db.PRINTS_DIR / filename)
    with open(pdf_path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    preview_path = str(db.PREVIEWS_DIR / f"{print_id}.png")
    ok = pdf_utils.generate_preview(pdf_path, preview_path)
    fmt = pdf_utils.detect_format(pdf_path)
    return print_id, filename, preview_path if ok else None, fmt


def _delete_print_files(filename: Optional[str], preview_path: Optional[str]):
    if filename:
        path = db.PRINTS_DIR / filename
        if path.exists():
            path.unlink(missing_ok=True)
    if preview_path and os.path.exists(preview_path):
        os.unlink(preview_path)


# ── CUPS user management ──────────────────────────────────────────────────────
# No passwords needed: printer uses auth-info-required=username only.
# Windows sends the login username automatically; cups-pdf routes to per-user
# subdirs via Out /var/spool/cups-pdf/${User}. Users appear automatically on
# first print. Management here is just listing/removing known users.

_CUPS_SPOOL = Path("/var/spool/cups-pdf")
_NON_USER_DIRS = {"SPOOL", "ANONYMOUS"}


def _cups_list_users() -> list:
    """Users from the cups-pdf spool subdirs + user_active_jobs table."""
    users = set()
    # From spool directories
    try:
        for d in _CUPS_SPOOL.iterdir():
            if d.is_dir() and d.name not in _NON_USER_DIRS:
                users.add(d.name)
    except Exception:
        pass
    # From user_active_jobs (users who have printed at least once)
    conn = db.get_db()
    try:
        for row in conn.execute("SELECT DISTINCT source_user FROM user_active_jobs WHERE source_user IS NOT NULL"):
            users.add(row[0])
        for row in conn.execute("SELECT DISTINCT source_user FROM jobs WHERE source_user IS NOT NULL"):
            users.add(row[0])
    finally:
        conn.close()
    return sorted(users)


@app.get("/api/cups-users")
def list_cups_users():
    return {"users": _cups_list_users()}


@app.delete("/api/cups-users/{username}")
async def delete_cups_user(username: str):
    """Remove all job assignments for a user (does not delete jobs themselves)."""
    conn = db.get_db()
    try:
        conn.execute("DELETE FROM user_active_jobs WHERE source_user = ?", (username,))
        conn.commit()
        await broadcast("users_changed", {})
        return {"ok": True}
    finally:
        conn.close()


# ── Static frontend ───────────────────────────────────────────────────────────

app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
