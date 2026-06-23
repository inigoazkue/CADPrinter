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


def generate_sheet_preview(
    pdf_paths: list[str],
    fmt: str,
    preview_path: str,
    width_px: int = 500,
    offsets: list = None,
) -> bool:
    """Overlay all PDFs on a blank page and render as PNG."""
    try:
        fw, fh = PAGE_SIZES_PT.get(fmt, PAGE_SIZES_PT["A3"])
        out = fitz.open()
        page = out.new_page(width=fw, height=fh)

        # White background
        page.draw_rect(page.rect, color=(1, 1, 1), fill=(1, 1, 1))

        for path_idx, path in enumerate(pdf_paths):
            if path and os.path.exists(path):
                try:
                    src = fitz.open(path)
                    off = (offsets[path_idx] if offsets and path_idx < len(offsets) else None) or {}
                    off_x = (off.get('x_mm') or 0) * PT_PER_MM
                    off_y = (off.get('y_mm') or 0) * PT_PER_MM
                    dest = fitz.Rect(off_x, off_y, fw + off_x, fh + off_y)
                    page.show_pdf_page(dest, src, 0)
                    src.close()
                except Exception as e:
                    print(f"[preview] Skipping {path}: {e}")

        scale = width_px / fw
        mat = fitz.Matrix(scale, scale)
        pix = page.get_pixmap(matrix=mat, alpha=False, colorspace=fitz.csRGB)
        pix.save(preview_path)
        out.close()
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

            out = fitz.open()
            page = out.new_page(width=tw, height=th)
            page.draw_rect(page.rect, color=(1, 1, 1), fill=(1, 1, 1))
            page.show_pdf_page(page.rect, src_doc, 0, clip=fitz.Rect(x0, y0, x1, y1))

            tile_name = f"tile_{r}_{c}_{os.urandom(4).hex()}.pdf"
            tile_path = str(Path(output_dir) / tile_name)
            out.save(tile_path)
            out.close()
            tile_paths.append(tile_path)

    src_doc.close()
    return tile_paths


def export_job_pdf(sheets_pdf_paths: list[list[str]], fmt: str, output_path: str,
                   sheets_offsets: list = None, sheet_formats: list = None) -> bool:
    """
    Build final multi-page PDF.
    sheets_pdf_paths: one list of pdf paths per sheet (overlaid → one output page).
    sheets_offsets: parallel list of offset lists per sheet, each offset is {"x_mm", "y_mm"}.
    sheet_formats: optional per-page format override (e.g. tile pages use tile format).
    """
    try:
        out = fitz.open()

        for sheet_idx, sheet_paths in enumerate(sheets_pdf_paths):
            page_fmt = (sheet_formats[sheet_idx]
                        if sheet_formats and sheet_idx < len(sheet_formats) else None) or fmt
            fw, fh = PAGE_SIZES_PT.get(page_fmt, PAGE_SIZES_PT["A3"])
            page = out.new_page(width=fw, height=fh)
            page.draw_rect(page.rect, color=(1, 1, 1), fill=(1, 1, 1))
            sheet_off_list = (sheets_offsets[sheet_idx]
                              if sheets_offsets and sheet_idx < len(sheets_offsets)
                              else None)
            for path_idx, path in enumerate(sheet_paths):
                if path and os.path.exists(path):
                    try:
                        src = fitz.open(path)
                        off = (sheet_off_list[path_idx]
                               if sheet_off_list and path_idx < len(sheet_off_list)
                               else None) or {}
                        off_x = (off.get('x_mm') or 0) * PT_PER_MM
                        off_y = (off.get('y_mm') or 0) * PT_PER_MM
                        dest = fitz.Rect(off_x, off_y, fw + off_x, fh + off_y)
                        page.show_pdf_page(dest, src, 0)
                        src.close()
                    except Exception as e:
                        print(f"[export] Skipping {path}: {e}")

        out.save(output_path)
        out.close()
        return True
    except Exception as e:
        print(f"[export] Error exporting PDF: {e}")
        return False
