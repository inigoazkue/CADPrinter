import pymupdf as fitz  # PyMuPDF ≥1.24 renamed fitz → pymupdf
import os
from pathlib import Path

# Points per mm
PT_PER_MM = 2.83465

PAGE_SIZES_PT = {
    "A0": (2383.94, 3370.39),
    "A1": (1683.78, 2383.94),
    "A2": (1190.55, 1683.78),
    "A3": (841.89, 1190.55),
    "A4": (595.28, 841.89),
    "A5": (419.53, 595.28),
    "A6": (297.64, 419.53),
}

TOLERANCE_PT = 15  # tolerance for format detection


def detect_format(pdf_path: str) -> str:
    """Detect paper format from first page dimensions."""
    try:
        doc = fitz.open(pdf_path)
        page = doc[0]
        w, h = page.rect.width, page.rect.height
        doc.close()
        for fmt, (fw, fh) in PAGE_SIZES_PT.items():
            if (abs(w - fw) < TOLERANCE_PT and abs(h - fh) < TOLERANCE_PT) or \
               (abs(w - fh) < TOLERANCE_PT and abs(h - fw) < TOLERANCE_PT):
                return fmt
    except Exception:
        pass
    return "A3"


def generate_preview(pdf_path: str, preview_path: str, width_px: int = 300) -> bool:
    """Render first page of PDF to a PNG thumbnail."""
    try:
        doc = fitz.open(pdf_path)
        page = doc[0]
        scale = width_px / page.rect.width
        mat = fitz.Matrix(scale, scale)
        pix = page.get_pixmap(matrix=mat, alpha=False, colorspace=fitz.csRGB)
        pix.save(preview_path)
        doc.close()
        return True
    except Exception as e:
        print(f"[preview] Error generating preview for {pdf_path}: {e}")
        return False


def _oriented_canvas(fmt: str, pdf_paths: list) -> tuple:
    """Return (width, height) in pt for `fmt`, flipped to landscape if the
    LARGEST-area layer is landscape. Using the largest layer (not the first)
    keeps the canvas orientation stable when small layers are rotated."""
    fw, fh = PAGE_SIZES_PT.get(fmt, PAGE_SIZES_PT["A3"])
    best_area = -1.0
    landscape = fw > fh
    for path in pdf_paths or []:
        if path and os.path.exists(path):
            try:
                d = fitz.open(path)
                r = d[0].rect
                d.close()
                area = r.width * r.height
                if area > best_area:
                    best_area = area
                    landscape = r.width > r.height
            except Exception:
                pass
    if landscape != (fw > fh):
        return fh, fw
    return fw, fh


def _compose_sheet(pdf_paths, offsets, fmt, rotation=0, auto_orient=True):
    """Build a single-page fitz doc: every layer placed at its NATIVE size and
    offset on a `fmt` canvas, then the whole page rotated by `rotation`
    (0/90/180/270) as a unit. Returns (doc, width_pt, height_pt)."""
    if auto_orient:
        cw, ch = _oriented_canvas(fmt, pdf_paths)
    else:
        cw, ch = PAGE_SIZES_PT.get(fmt, PAGE_SIZES_PT["A3"])

    comp = fitz.open()
    cp = comp.new_page(width=cw, height=ch)
    cp.draw_rect(cp.rect, color=(1, 1, 1), fill=(1, 1, 1))
    for i, path in enumerate(pdf_paths):
        if path and os.path.exists(path):
            try:
                src = fitz.open(path)
                sw, sh = src[0].rect.width, src[0].rect.height
                off = (offsets[i] if offsets and i < len(offsets) else None) or {}
                ox = (off.get('x_mm') or 0) * PT_PER_MM
                oy = (off.get('y_mm') or 0) * PT_PER_MM
                cp.show_pdf_page(fitz.Rect(ox, oy, ox + sw, oy + sh), src, 0)
                src.close()
            except Exception as e:
                print(f"[compose] Skipping {path}: {e}")

    rot = rotation % 360
    if rot == 0:
        return comp, cw, ch

    ow, oh = (ch, cw) if rot in (90, 270) else (cw, ch)
    out = fitz.open()
    op = out.new_page(width=ow, height=oh)
    op.draw_rect(op.rect, color=(1, 1, 1), fill=(1, 1, 1))
    op.show_pdf_page(op.rect, comp, 0, rotate=rot)
    comp.close()
    return out, ow, oh


def generate_sheet_preview(
    pdf_paths: list[str],
    fmt: str,
    preview_path: str,
    width_px: int = 500,
    offsets: list = None,
    rotation: int = 0,
    auto_orient: bool = True,
) -> bool:
    """Overlay all PDFs on a blank sheet (each at native size + offset) and render
    as PNG. `rotation` rotates the whole composed page (manual sheet rotation).
    `auto_orient` fits the canvas to the largest layer's orientation."""
    try:
        doc, ow, _oh = _compose_sheet(pdf_paths, offsets, fmt, rotation, auto_orient)
        scale = width_px / ow
        mat = fitz.Matrix(scale, scale)
        pix = doc[0].get_pixmap(matrix=mat, alpha=False, colorspace=fitz.csRGB)
        pix.save(preview_path)
        doc.close()
        return True
    except Exception as e:
        print(f"[preview] Error generating sheet preview: {e}")
        return False


def apply_rotation_to_pdf(pdf_path: str, rotation: int) -> bool:
    """Rewrite a PDF in place with its first page rotated by rotation degrees.

    Bakes the rotation into the file so subsequent renders/exports use it
    directly (no per-render rotation needed). Writes to a temp file then
    atomically replaces the original.
    """
    rot = rotation % 360
    if rot == 0:
        return True
    try:
        src = fitz.open(pdf_path)
        src_page = src[0]
        if rot in (90, 270):
            rw, rh = src_page.rect.height, src_page.rect.width
        else:
            rw, rh = src_page.rect.width, src_page.rect.height
        out = fitz.open()
        page = out.new_page(width=rw, height=rh)
        page.show_pdf_page(page.rect, src, 0, rotate=rot)
        tmp_path = pdf_path + ".rot.tmp"
        out.save(tmp_path)
        src.close()
        out.close()
        os.replace(tmp_path, pdf_path)
        return True
    except Exception as e:
        print(f"[apply_rotation] Error rotating {pdf_path}: {e}")
        return False


def generate_rotated_preview(pdf_path: str, rotation: int, width_px: int = 300):
    """Return PNG bytes of the first page rotated by rotation degrees (90/180/270)."""
    try:
        src = fitz.open(pdf_path)
        src_page = src[0]
        rot = rotation % 360
        if rot in (90, 270):
            rw, rh = src_page.rect.height, src_page.rect.width
        else:
            rw, rh = src_page.rect.width, src_page.rect.height
        out = fitz.open()
        page = out.new_page(width=rw, height=rh)
        page.show_pdf_page(page.rect, src, 0, rotate=rot)
        scale = width_px / rw
        mat = fitz.Matrix(scale, scale)
        pix = page.get_pixmap(matrix=mat, alpha=False, colorspace=fitz.csRGB)
        data = pix.tobytes("png")
        src.close()
        out.close()
        return data
    except Exception as e:
        print(f"[rotated_preview] Error: {e}")
        return None


def generate_editor_preview(pdf_path: str, rotation: int = 0, width_px: int = 2000):
    """High-res render for the editor with WHITE treated as TRANSPARENT, so the
    background ghost layers show through. Rendered once per open/rotate; zoom is
    pure CSS. Needs numpy for the white→transparent keying; without it, falls
    back to a transparent-background render (works for vector PDFs with no white
    fill)."""
    try:
        src = fitz.open(pdf_path)
        sp = src[0]
        rot = rotation % 360
        if rot in (90, 270):
            rw, rh = sp.rect.height, sp.rect.width
        else:
            rw, rh = sp.rect.width, sp.rect.height
        out = fitz.open()
        page = out.new_page(width=rw, height=rh)
        page.show_pdf_page(page.rect, src, 0, rotate=rot)
        scale = width_px / rw
        mat = fitz.Matrix(scale, scale)
        pix = page.get_pixmap(matrix=mat, alpha=True, colorspace=fitz.csRGB)
        src.close()
        out.close()

        # Key out near-white pixels → transparent (so the ghost shows through).
        try:
            import numpy as np
            arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n).copy()
            if pix.n == 4:
                near_white = (arr[:, :, 0] >= 245) & (arr[:, :, 1] >= 245) & (arr[:, :, 2] >= 245)
                arr[near_white, 3] = 0
                keyed = fitz.Pixmap(fitz.csRGB, pix.width, pix.height, arr.tobytes(), True)
                return keyed.tobytes("png")
        except Exception as e:
            print(f"[editor_preview] white-key skipped (no numpy?): {e}")

        return pix.tobytes("png")
    except Exception as e:
        print(f"[editor_preview] Error: {e}")
        return None


def split_pdf_tiles(
    pdf_path: str,
    output_dir: str,
    cols: int = 2,
    rows: int = 1,
    tile_format: str = "A3",
    overlap_mm: float = 5.0,
    col_positions: list = None,
    row_positions: list = None,
    offsets: list = None,
    rotation: int = 0,
) -> list:
    """
    Split the first page of a PDF into cols×rows tiles of tile_format size.
    col_positions: normalized (0..1) vertical divider positions (len = cols-1).
    row_positions: normalized (0..1) horizontal divider positions (len = rows-1).
    offsets: per-tile dicts {"x_mm": float, "y_mm": float} to pan clip window.
    rotation: degrees to rotate source page (0, 90, 180, 270).
    Returns list of output file paths in row-major order (left→right, top→bottom).
    """
    src_doc = fitz.open(pdf_path)
    src_page = src_doc[0]

    if rotation and rotation % 360 != 0:
        rotated = fitz.open()
        if rotation in (90, 270):
            rw, rh = src_page.rect.height, src_page.rect.width
        else:
            rw, rh = src_page.rect.width, src_page.rect.height
        rpage = rotated.new_page(width=rw, height=rh)
        rpage.show_pdf_page(rpage.rect, src_doc, 0, rotate=rotation)
        src_doc = rotated
        src_page = src_doc[0]

    src_w = src_page.rect.width
    src_h = src_page.rect.height

    tw, th = PAGE_SIZES_PT.get(tile_format, PAGE_SIZES_PT["A3"])
    overlap_pt = overlap_mm * PT_PER_MM

    if col_positions is None:
        col_positions = [(i + 1) / cols for i in range(cols - 1)]
    if row_positions is None:
        row_positions = [(i + 1) / rows for i in range(rows - 1)]

    col_edges = [0.0] + [p * src_w for p in col_positions] + [src_w]
    row_edges = [0.0] + [p * src_h for p in row_positions] + [src_h]

    tile_paths = []
    for r in range(rows):
        for c in range(cols):
            x0 = col_edges[c] - (overlap_pt / 2 if c > 0 else 0)
            x1 = col_edges[c + 1] + (overlap_pt / 2 if c < cols - 1 else 0)
            y0 = row_edges[r] - (overlap_pt / 2 if r > 0 else 0)
            y1 = row_edges[r + 1] + (overlap_pt / 2 if r < rows - 1 else 0)

            tile_idx = r * cols + c
            if offsets and tile_idx < len(offsets):
                off = offsets[tile_idx]
                dx = (off.get("x_mm") or 0) * PT_PER_MM
                dy = (off.get("y_mm") or 0) * PT_PER_MM
                x0 += dx; x1 += dx
                y0 += dy; y1 += dy

            clip = fitz.Rect(x0, y0, x1, y1)
            cw, ch = clip.width, clip.height

            # Orient the tile page to match the cut piece so it fits 1:1.
            if (cw > ch) != (tw > th):
                pw, ph = th, tw
            else:
                pw, ph = tw, th

            out = fitz.open()
            page = out.new_page(width=pw, height=ph)
            # No white background fill: tiles must be TRANSPARENT so that when
            # they are overlaid on a sheet every piece is visible.
            # Place the piece at its TRUE size (1:1), centered — NOT stretched to
            # fill the page — so the print matches the original scale exactly.
            ox = (pw - cw) / 2
            oy = (ph - ch) / 2
            dest = fitz.Rect(ox, oy, ox + cw, oy + ch)
            page.show_pdf_page(dest, src_doc, 0, clip=clip)

            tile_name = f"tile_{r}_{c}_{os.urandom(4).hex()}.pdf"
            tile_path = str(Path(output_dir) / tile_name)
            out.save(tile_path)
            out.close()
            tile_paths.append(tile_path)

    src_doc.close()
    return tile_paths


def export_job_pdf(sheets_pdf_paths: list[list[str]], fmt: str, output_path: str,
                   sheets_offsets: list = None, sheet_formats: list = None,
                   sheet_rotations: list = None) -> bool:
    """
    Build final multi-page PDF (one page per sheet).
    sheets_pdf_paths: one list of pdf paths per sheet (overlaid → one output page).
    sheets_offsets: parallel list of offset lists per sheet, each offset {"x_mm","y_mm"}.
    sheet_formats: optional per-page format override (tile pages use tile format).
    sheet_rotations: optional per-page manual rotation (0/90/180/270).
    """
    try:
        out = fitz.open()
        for i, sheet_paths in enumerate(sheets_pdf_paths):
            page_fmt = (sheet_formats[i] if sheet_formats and i < len(sheet_formats) else None) or fmt
            offs = sheets_offsets[i] if sheets_offsets and i < len(sheets_offsets) else None
            rot = sheet_rotations[i] if sheet_rotations and i < len(sheet_rotations) else 0
            # auto_orient=False: output orientation comes ONLY from the manual
            # per-sheet rotation, never from the layers.
            doc, _ow, _oh = _compose_sheet(sheet_paths, offs, page_fmt, rot, auto_orient=False)
            out.insert_pdf(doc)
            doc.close()
        out.save(output_path)
        out.close()
        return True
    except Exception as e:
        print(f"[export] Error exporting PDF: {e}")
        return False
