#!/bin/bash
# cups-pdf PostProcessing hook.
# Called by cups-pdf after generating the PDF.
# Reads the Windows domain username from the cups-pdf log (where the backslash
# is preserved) to route the PDF to a per-user spool subdirectory.
#
# Arguments (from cups-pdf):
#   $1 = absolute path to the generated PDF
#   $2 = system user (always "nobody")
#   $3 = CUPS username — NOTE: shell parsing strips the backslash from
#        "DOMAIN\user", so we read the log instead.

PDF_PATH="$1"
[ -f "$PDF_PATH" ] || exit 0

# The cups-pdf log for this printer queue contains the original DOMAIN\username
# with the backslash preserved. PRINTER is set by CUPS for all backends.
CUPS_PRINTER="${PRINTER:-CADPrinter}"
LOG_FILE="/var/log/cups/cups-pdf-${CUPS_PRINTER}_log"

USER_NAME=""
if [[ -r "$LOG_FILE" ]]; then
    # Log line: "[DEBUG] trying lower case user name: eitb\azkue_inigo"
    ORIG=$(grep "lower case user name:" "$LOG_FILE" | tail -1 | awk '{print $NF}')
    if [[ "$ORIG" == *\\* ]]; then
        # Strip domain prefix: "eitb\azkue_inigo" → "azkue_inigo"
        USER_NAME="${ORIG##*\\}"
    elif [[ -n "$ORIG" && "$ORIG" != "anonymous" && "$ORIG" != "nobody" ]]; then
        USER_NAME="$ORIG"
    fi
fi

[[ -z "$USER_NAME" || "$USER_NAME" == "nobody" || "$USER_NAME" == "anonymous" ]] && exit 0

DEST_DIR="/var/spool/cups-pdf/${USER_NAME}"
mkdir -p "$DEST_DIR"
chmod 755 "$DEST_DIR"
mv "$PDF_PATH" "$DEST_DIR/"
exit 0
