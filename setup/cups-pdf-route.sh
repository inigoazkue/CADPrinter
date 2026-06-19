#!/bin/bash
# cups-pdf PostProcessing hook.
# Called by cups-pdf after generating the PDF.
# Moves the PDF to a per-user spool subdirectory based on the CUPS printer name.
#
# Arguments (from cups-pdf):
#   $1 = absolute path to the generated PDF
#   $2 = CUPS username (always "anonymous" without auth — ignored here)
#   $3 = job title
#
# Environment (set by CUPS backend):
#   $PRINTER = printer queue name (e.g. "CADPrinter-inigo.azkue")

PDF_PATH="$1"
PRINTER_NAME="${PRINTER:-}"

# Nothing to do if the PDF doesn't exist
[ -f "$PDF_PATH" ] || exit 0

# Only act on user-specific queues (CADPrinter-<username>)
if [[ "$PRINTER_NAME" == CADPrinter-* ]]; then
    USER_NAME="${PRINTER_NAME#CADPrinter-}"
    DEST_DIR="/var/spool/cups-pdf/${USER_NAME}"
    mkdir -p "$DEST_DIR"
    mv "$PDF_PATH" "$DEST_DIR/"
fi
# If it's the generic CADPrinter queue, leave the file in ANONYMOUS/ as-is.
exit 0
