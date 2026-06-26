import asyncio
import json
import os
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse, Response
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


VALID_FORMATS = {"A0", "A1", "A2", "A3", "A4", "A5", "A6"}


class JobCreate(BaseModel):
    name: str
    format: str = "A3"
    source_user: Optional[str] = None
    activate: bool = True


@app.post("/api/jobs", status_code=201)
async def create_job(body: JobCreate):
    if body.format not in VALID_FORMATS:
        raise HTTPException(400, f"format must be one of {', '.join(sorted(VALID_FORMATS))}")
    source_user = body.source_user.strip() if body.source_user else None
    conn = db.get_db()
    try:
        activate_globally = (not source_user) and body.activate
        job_id = db.db_create_job(conn, body.name.strip(), body.format,
                                   activate_globally=activate_globally,
                                   source_user=source_user)
        conn.commit()
        if source_user and body.activate:
            db.db_set_user_active_job(conn, source_user, job_id)
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
        sheets_offsets = []
        sheet_formats = []
        sheet_rotations = []
        for sheet in job["sheets"]:
            enabled = [p for p in sheet["prints"] if p["enabled"]]
            if not enabled:
                continue
            # A sheet with split tiles exports as ONE page at the tile format,
            # overlaying the pieces at their offsets (same as the preview).
            tile_prints = [p for p in enabled if p.get("tile_col") is not None]
            fmt_for_sheet = (tile_prints[0].get("format") or job["format"]) if tile_prints else job["format"]
            sheets_paths.append([str(db.PRINTS_DIR / p["filename"]) for p in enabled])
            sheets_offsets.append([{"x_mm": p.get("offset_x_mm") or 0, "y_mm": p.get("offset_y_mm") or 0} for p in enabled])
            sheet_formats.append(fmt_for_sheet)
            sheet_rotations.append(sheet.get("rotation") or 0)

        if not sheets_paths:
            raise HTTPException(400, "No hay capas habilitadas para exportar")

        out_name = f"export_{job_id}_{uuid.uuid4().hex[:6]}.pdf"
        out_path = db.DATA_DIR / out_name
        ok = pdf_utils.export_job_pdf(sheets_paths, job["format"], str(out_path),
                                      sheets_offsets=sheets_offsets, sheet_formats=sheet_formats,
                                      sheet_rotations=sheet_rotations)
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
        # name NULL → frontend numbers default sheets sequentially ("N. orria").
        cur = conn.execute(
            "INSERT INTO sheets (job_id, name, order_num) VALUES (?, NULL, ?)",
            (job_id, order)
        )
        sheet_id = cur.lastrowid
        conn.commit()
        await broadcast("sheet_added", {"job_id": job_id, "sheet_id": sheet_id})
        return dict(conn.execute("SELECT * FROM sheets WHERE id = ?", (sheet_id,)).fetchone())
    finally:
        conn.close()


class SheetUpdate(BaseModel):
    name: Optional[str] = None
    rotation: Optional[int] = None


@app.patch("/api/sheets/{sheet_id}")
async def update_sheet(sheet_id: int, body: SheetUpdate):
    conn = db.get_db()
    try:
        sheet = conn.execute("SELECT * FROM sheets WHERE id = ?", (sheet_id,)).fetchone()
        if not sheet:
            raise HTTPException(404, "Sheet not found")
        if body.name is not None:
            conn.execute("UPDATE sheets SET name = ? WHERE id = ?", (body.name.strip(), sheet_id))
        if body.rotation is not None:
            conn.execute("UPDATE sheets SET rotation = ? WHERE id = ?",
                         (body.rotation % 360, sheet_id))
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
        preview_path = str(db.PREVIEWS_DIR / f"sheet_{sheet_id}_combined.png")

        # If the sheet holds split tiles, the combined preview is rendered at the
        # tile format (e.g. A3) and the tiles are OVERLAID (superimposed), each
        # at its own offset, so the user can reposition the pieces over a single
        # sheet. Otherwise use the job format.
        tile_prints = [p for p in prints if p["tile_col"] is not None]
        fmt = (tile_prints[0]["format"] or job["format"]) if tile_prints else job["format"]
        paths = [str(db.PRINTS_DIR / p["filename"]) for p in prints]
        offsets = [{"x_mm": p["offset_x_mm"] or 0, "y_mm": p["offset_y_mm"] or 0} for p in prints]
        rotation = sheet["rotation"] if "rotation" in sheet.keys() else 0
        # auto_orient=False: the sheet canvas does NOT follow the layers; its
        # orientation is controlled ONLY by the manual sheet rotation (↻ button).
        pdf_utils.generate_sheet_preview(paths, fmt, preview_path, offsets=offsets,
                                         rotation=rotation or 0, auto_orient=False)

        if not os.path.exists(preview_path):
            raise HTTPException(500, "Error generating preview")
        return FileResponse(preview_path, media_type="image/png",
                            headers={"Cache-Control": "no-store"})
    finally:
        conn.close()


@app.get("/api/sheets/{sheet_id}/ghost")
def sheet_ghost(sheet_id: int, exclude: int = 0):
    """Composite of the OTHER enabled layers on the sheet (excluding `exclude`),
    on the base folio (no manual rotation). Used as a faint background in the
    editor so the user can place a layer without overlapping the rest."""
    conn = db.get_db()
    try:
        sheet = conn.execute("SELECT * FROM sheets WHERE id = ?", (sheet_id,)).fetchone()
        if not sheet:
            raise HTTPException(404, "Sheet not found")
        job = db.db_get_job(conn, sheet["job_id"])
        prints = conn.execute(
            "SELECT * FROM prints WHERE sheet_id = ? AND enabled = 1 AND id != ? "
            "ORDER BY order_num, received_at",
            (sheet_id, exclude)
        ).fetchall()
        if not prints:
            raise HTTPException(404, "No other layers")
        tile_prints = [p for p in prints if p["tile_col"] is not None]
        fmt = (tile_prints[0]["format"] or job["format"]) if tile_prints else job["format"]
        paths = [str(db.PRINTS_DIR / p["filename"]) for p in prints]
        offsets = [{"x_mm": p["offset_x_mm"] or 0, "y_mm": p["offset_y_mm"] or 0} for p in prints]
        ghost_path = str(db.PREVIEWS_DIR / f"ghost_{sheet_id}.png")
        # auto_orient=False + rotation=0 → same base folio the editor shows.
        pdf_utils.generate_sheet_preview(paths, fmt, ghost_path, offsets=offsets,
                                         rotation=0, auto_orient=False)
        if not os.path.exists(ghost_path):
            raise HTTPException(500, "Error generating ghost")
        return FileResponse(ghost_path, media_type="image/png",
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
def print_preview(print_id: int, rotation: int = 0, placed: int = 0, hires: int = 0):
    conn = db.get_db()
    try:
        p = conn.execute("SELECT * FROM prints WHERE id = ?", (print_id,)).fetchone()
        if not p:
            raise HTTPException(404, "Print not found")

        # "hires" = high-resolution render for the editor, so zoom stays sharp.
        # Rendered once on open/rotate; zoom itself is pure CSS (no per-zoom lag).
        if hires:
            pdf_path = str(db.PRINTS_DIR / p["filename"])
            if os.path.exists(pdf_path):
                # White → transparent so background ghost layers show through.
                data = pdf_utils.generate_editor_preview(pdf_path, rotation or 0, width_px=2000)
                if data:
                    return Response(content=data, media_type="image/png",
                                    headers={"Cache-Control": "no-store"})

        if rotation and rotation % 360 != 0:
            pdf_path = str(db.PRINTS_DIR / p["filename"])
            if os.path.exists(pdf_path):
                data = pdf_utils.generate_rotated_preview(pdf_path, rotation)
                if data:
                    return Response(content=data, media_type="image/png",
                                    headers={"Cache-Control": "no-store"})

        # "placed" = render this single layer ON its folio (oriented canvas) at
        # its offset, so the thumbnail shows the layer rotated AND positioned
        # exactly as it sits on the sheet.
        if placed:
            pdf_path = str(db.PRINTS_DIR / p["filename"])
            if os.path.exists(pdf_path):
                job = db.db_get_job(conn, p["job_id"])
                fmt = (p["format"] if p["tile_col"] is not None else job["format"]) or "A3"
                offsets = [{"x_mm": p["offset_x_mm"] or 0, "y_mm": p["offset_y_mm"] or 0}]
                placed_path = str(db.PREVIEWS_DIR / f"placed_{print_id}.png")
                if pdf_utils.generate_sheet_preview([pdf_path], fmt, placed_path, offsets=offsets):
                    return FileResponse(placed_path, media_type="image/png",
                                        headers={"Cache-Control": "no-store"})

        preview = p["preview_path"]
        if not preview or not os.path.exists(preview):
            raise HTTPException(404, "Preview not available")
        # no-cache → browser revalidates via Last-Modified; rotated previews
        # (same URL, new mtime) refetch, unchanged ones return a cheap 304.
        return FileResponse(preview, media_type="image/png",
                            headers={"Cache-Control": "no-cache"})
    finally:
        conn.close()


class PrintUpdate(BaseModel):
    enabled: Optional[bool] = None
    sheet_id: Optional[int] = None
    order_num: Optional[int] = None
    offset_x_mm: Optional[float] = None
    offset_y_mm: Optional[float] = None


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
        if body.offset_x_mm is not None:
            conn.execute("UPDATE prints SET offset_x_mm = ? WHERE id = ?", (body.offset_x_mm, print_id))
        if body.offset_y_mm is not None:
            conn.execute("UPDATE prints SET offset_y_mm = ? WHERE id = ?", (body.offset_y_mm, print_id))
        conn.commit()
        await broadcast("print_updated", {"print_id": print_id, "job_id": p["job_id"]})
        return dict(conn.execute("SELECT * FROM prints WHERE id = ?", (print_id,)).fetchone())
    finally:
        conn.close()


class PrintEdit(BaseModel):
    rotation: int = 0
    offset_x_mm: float = 0
    offset_y_mm: float = 0


@app.post("/api/prints/{print_id}/edit")
async def edit_print(print_id: int, body: PrintEdit):
    """Bake rotation into the PDF (if any) and store position offsets.

    Used by the unified edit modal when the print is NOT being split (1×1).
    """
    conn = db.get_db()
    try:
        p = conn.execute("SELECT * FROM prints WHERE id = ?", (print_id,)).fetchone()
        if not p:
            raise HTTPException(404, "Print not found")
        p = dict(p)
        pdf_path = str(db.PRINTS_DIR / p["filename"])

        new_format = p["format"]
        if body.rotation and body.rotation % 360 != 0 and os.path.exists(pdf_path):
            if not pdf_utils.apply_rotation_to_pdf(pdf_path, body.rotation):
                raise HTTPException(500, "Error rotating PDF")
            # Regenerate the print thumbnail and re-detect format (dims may swap)
            if p["preview_path"]:
                pdf_utils.generate_preview(pdf_path, p["preview_path"])
            new_format = pdf_utils.detect_format(pdf_path)

        conn.execute(
            "UPDATE prints SET offset_x_mm = ?, offset_y_mm = ?, format = ? WHERE id = ?",
            (body.offset_x_mm, body.offset_y_mm, new_format, print_id)
        )
        conn.commit()
        await broadcast("job_updated", {"job_id": p["job_id"]})
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
        placed = db.PREVIEWS_DIR / f"placed_{print_id}.png"
        if placed.exists():
            placed.unlink(missing_ok=True)
        conn.execute("DELETE FROM prints WHERE id = ?", (print_id,))
        conn.commit()
        await broadcast("print_deleted", {"print_id": print_id, "job_id": job_id})
        return {"ok": True}
    finally:
        conn.close()


# ── Split print ───────────────────────────────────────────────────────────────

class SplitParams(BaseModel):
    cols: int = 2
    rows: int = 1
    tile_format: str = "A3"
    overlap_mm: float = 5.0
    col_positions: Optional[list] = None
    row_positions: Optional[list] = None
    rotation: int = 0


@app.post("/api/prints/{print_id}/split")
async def split_print(print_id: int, body: SplitParams):
    if body.tile_format not in VALID_FORMATS:
        raise HTTPException(400, "invalid tile_format")
    conn = db.get_db()
    try:
        p = conn.execute("SELECT * FROM prints WHERE id = ?", (print_id,)).fetchone()
        if not p:
            raise HTTPException(404, "Print not found")
        p = dict(p)
        pdf_path = str(db.PRINTS_DIR / p["filename"])
        if not os.path.exists(pdf_path):
            raise HTTPException(404, "PDF file not found on disk")

        try:
            tile_paths = pdf_utils.split_pdf_tiles(
                pdf_path=pdf_path,
                output_dir=str(db.PRINTS_DIR),
                cols=body.cols,
                rows=body.rows,
                tile_format=body.tile_format,
                overlap_mm=body.overlap_mm,
                col_positions=body.col_positions,
                row_positions=body.row_positions,
                rotation=body.rotation,
            )
        except Exception as e:
            raise HTTPException(500, f"Split failed: {e}")

        job_id = p["job_id"]
        original_sheet_id = p["sheet_id"]
        orig_name = p.get("original_name") or p["filename"]

        # Move original to a new "Iturriak" sheet (disabled, for reference only)
        src_order = db.db_next_sheet_order(conn, job_id)
        conn.execute("INSERT INTO sheets (job_id, name, order_num) VALUES (?, 'Iturriak', ?)",
                     (job_id, src_order))
        source_sheet_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        conn.execute("UPDATE prints SET sheet_id = ?, enabled = 0 WHERE id = ?",
                     (source_sheet_id, print_id))

        # Insert all tiles on the ORIGINAL sheet as normal enabled layers.
        # They start superimposed (offset 0); the user drags each piece in the
        # edit modal to compose the single sheet. The combined preview overlays
        # them at the tile format.
        tile_print_ids = []
        base_id = _new_id()

        for i, tile_path in enumerate(tile_paths):
            col = i % body.cols
            row_i = i // body.cols
            tile_filename = Path(tile_path).name
            tile_orig_name = f"zati_{row_i+1}.{col+1}_{orig_name}"
            tile_id = (base_id + i) % (2 ** 31)

            preview_path = str(db.PREVIEWS_DIR / f"{tile_id}.png")
            pdf_utils.generate_preview(tile_path, preview_path)
            if not os.path.exists(preview_path):
                preview_path = None

            conn.execute("""
                INSERT INTO prints
                  (id, job_id, sheet_id, filename, original_name, preview_path,
                   order_num, format, source_user, enabled, tile_col, tile_row,
                   offset_x_mm, offset_y_mm)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0, 0)
            """, (tile_id, job_id, original_sheet_id, tile_filename, tile_orig_name,
                  preview_path, i + 1, body.tile_format, p["source_user"], col, row_i))
            tile_print_ids.append(tile_id)

        conn.commit()
        await broadcast("job_updated", {"job_id": job_id})
        return {"tile_print_ids": tile_print_ids}
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
                    conn, f"{_job_counter(conn)}. lana", fmt,
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
                job_id = db.db_create_job(conn, f"{_job_counter(conn)}. lana", fmt)
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


# ── CUPS printer queue management ─────────────────────────────────────────────
# Each user gets their own CUPS queue: CADPrinter-<username>
# cups-pdf PostProcessing script routes PDFs to per-user spool subdirectories.
# Requires sudoers entry: ingprod ALL=(ALL) NOPASSWD: /usr/sbin/lpadmin,...

_CUPS_PPD_CANDIDATES = [
    "/usr/share/ppd/cups-pdf/CUPS-PDF_opt.ppd",
    "/usr/share/ppd/cups-pdf/CUPS-PDF.ppd",
    "/usr/share/cups/model/CUPS-PDF_opt.ppd",
]


def _find_cups_pdf_ppd() -> str:
    for p in _CUPS_PPD_CANDIDATES:
        if Path(p).exists():
            return p
    try:
        r = subprocess.run(
            ['find', '/usr/share', '-name', 'CUPS-PDF*.ppd'],
            capture_output=True, text=True, timeout=5
        )
        lines = [l for l in r.stdout.splitlines() if l.strip()]
        if lines:
            return lines[0]
    except Exception:
        pass
    return _CUPS_PPD_CANDIDATES[0]


def _cups_run(cmd: list) -> tuple:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        return r.returncode == 0, (r.stderr or r.stdout).strip()
    except FileNotFoundError as e:
        return False, f"Komandoa ez da aurkitu: {e}"
    except Exception as e:
        return False, str(e)


def _list_cups_printers() -> list:
    """Return list of usernames that have a CADPrinter-<user> CUPS queue."""
    try:
        r = subprocess.run(['lpstat', '-a'], capture_output=True, text=True, timeout=5)
        users = []
        for line in r.stdout.splitlines():
            name = line.split()[0] if line.split() else ''
            if name.startswith('CADPrinter-'):
                users.append(name[len('CADPrinter-'):])
        return sorted(users)
    except Exception:
        return []


def _create_cups_printer(username: str) -> tuple:
    queue = f"CADPrinter-{username}"
    ppd = _find_cups_pdf_ppd()
    for cmd in [
        ['sudo', 'lpadmin', '-p', queue, '-E', '-v', 'cups-pdf:/', '-P', ppd,
         '-D', f"CAD Printer — {username}"],
        ['sudo', 'cupsaccept', queue],
        ['sudo', 'cupsenable', queue],
    ]:
        ok, err = _cups_run(cmd)
        if not ok:
            return False, err
    return True, ""


def _delete_cups_printer(username: str) -> tuple:
    return _cups_run(['sudo', 'lpadmin', '-x', f"CADPrinter-{username}"])


@app.get("/api/cups-printers")
def list_cups_printers():
    return {"users": _list_cups_printers()}


class CupsPrinterCreate(BaseModel):
    username: str


@app.post("/api/cups-printers", status_code=201)
def create_cups_printer(body: CupsPrinterCreate):
    username = body.username.strip()
    if not username:
        raise HTTPException(400, "Erabiltzaile-izena beharrezkoa da")
    ok, err = _create_cups_printer(username)
    if not ok:
        raise HTTPException(500, err or "Ezin da inprimagailua sortu")
    return {"ok": True, "username": username}


@app.delete("/api/cups-printers/{username}")
async def delete_cups_printer(username: str):
    ok, err = _delete_cups_printer(username)
    if not ok:
        raise HTTPException(500, err or "Ezin da inprimagailua ezabatu")
    conn = db.get_db()
    try:
        conn.execute("DELETE FROM user_active_jobs WHERE source_user = ?", (username,))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


# ── Static frontend ───────────────────────────────────────────────────────────

class NoCacheStaticFiles(StaticFiles):
    """StaticFiles that forces revalidation so updated JS/CSS/HTML never serve
    stale from the browser cache. ETag/Last-Modified still yield cheap 304s when
    the file is unchanged."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


app.mount("/", NoCacheStaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
