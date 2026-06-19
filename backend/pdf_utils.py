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
) -> bool:
    """Overlay all PDFs on a blank page and render as PNG."""
    try:
        fw, fh = PAGE_SIZES_PT.get(fmt, PAGE_SIZES_PT["A3"])
        out = fitz.open()
        page = out.new_page(width=fw, height=fh)

        # White background
        page.draw_rect(page.rect, color=(1, 1, 1), fill=(1, 1, 1))

        for path in pdf_paths:
            if path and os.path.exists(path):
                try:
                    src = fitz.open(path)
                    page.show_pdf_page(page.rect, src, 0)
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


def export_job_pdf(sheets_pdf_paths: list[list[str]], fmt: str, output_path: str) -> bool:
    """
    Build final multi-page PDF.
    sheets_pdf_paths: one list of pdf paths per sheet (overlaid → one output page).
    """
    try:
        fw, fh = PAGE_SIZES_PT.get(fmt, PAGE_SIZES_PT["A3"])
        out = fitz.open()

        for sheet_paths in sheets_pdf_paths:
            page = out.new_page(width=fw, height=fh)
            page.draw_rect(page.rect, color=(1, 1, 1), fill=(1, 1, 1))
            for path in sheet_paths:
                if path and os.path.exists(path):
                    try:
                        src = fitz.open(path)
                        page.show_pdf_page(page.rect, src, 0)
                        src.close()
                    except Exception as e:
                        print(f"[export] Skipping {path}: {e}")

        out.save(output_path)
        out.close()
        return True
    except Exception as e:
        print(f"[export] Error exporting PDF: {e}")
        return False
