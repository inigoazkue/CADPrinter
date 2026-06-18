"""
watcher.py — Monitors the cups-pdf output directory and notifies the CAD Printer
server when a new PDF is dropped. Run as a separate systemd service.

Usage:
    python watcher.py [--watch-dir /var/spool/cups-pdf/ANONYMOUS] [--api http://localhost:8080]
"""

import argparse
import shutil
import sys
import time
import os
import urllib.request
import urllib.error
import json
from pathlib import Path

from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileCreatedEvent

# ── Defaults ──────────────────────────────────────────────────────────────────
# Watch the parent cups-pdf directory so per-user subdirs are detected automatically.
# With CUPS auth + Out /var/spool/cups-pdf/${User}, each user's PDFs land in
# /var/spool/cups-pdf/<username>/ and we read the username from the dir name.
DEFAULT_WATCH_DIR = "/var/spool/cups-pdf"
DEFAULT_API_URL = "http://localhost:8080"
PRINTS_DIR_RELATIVE = "data/prints"   # relative to project root

# Directories inside the spool root that are not user dirs
_NON_USER_DIRS = {"SPOOL", "ANONYMOUS"}

# Project root = parent of this file's directory
PROJECT_ROOT = Path(__file__).parent.parent
PRINTS_DIR = PROJECT_ROOT / PRINTS_DIR_RELATIVE


def notify_server(api_url: str, filepath: str, filename: str, original_name: str,
                  source_user: str = None) -> bool:
    payload = json.dumps({
        "filepath": filepath,
        "filename": filename,
        "original_name": original_name,
        "source_user": source_user,
    }).encode()
    req = urllib.request.Request(
        f"{api_url}/api/internal/new-print",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read().decode()
            print(f"[watcher] Server accepted: {body}")
            return True
    except urllib.error.URLError as e:
        print(f"[watcher] Failed to notify server: {e}", file=sys.stderr)
        return False


def wait_for_stable(path: str, stable_secs: float = 1.0, timeout: float = 30.0):
    """Wait until file size stops changing (write is complete)."""
    deadline = time.time() + timeout
    last_size = -1
    while time.time() < deadline:
        try:
            size = os.path.getsize(path)
        except OSError:
            time.sleep(0.2)
            continue
        if size == last_size and size > 0:
            return True
        last_size = size
        time.sleep(stable_secs)
    return False


class PDFHandler(FileSystemEventHandler):
    def __init__(self, api_url: str):
        self.api_url = api_url

    def on_created(self, event: FileCreatedEvent):
        if event.is_directory:
            return
        src = event.src_path
        if not src.lower().endswith(".pdf"):
            return

        # Determine source_user from the subdirectory name
        parent_dir = Path(src).parent.name
        if parent_dir in _NON_USER_DIRS:
            source_user = None   # anonymous / no auth
        else:
            source_user = parent_dir

        print(f"[watcher] Detected: {src} (user={source_user})")
        if not wait_for_stable(src):
            print(f"[watcher] Timeout waiting for stable file: {src}", file=sys.stderr)
            return

        # Copy to data/prints/
        original_name = Path(src).name
        dest_name = f"{int(time.time() * 1000)}_{original_name}"
        PRINTS_DIR.mkdir(parents=True, exist_ok=True)
        dest_path = str(PRINTS_DIR / dest_name)

        try:
            shutil.copy2(src, dest_path)
            print(f"[watcher] Copied to {dest_path}")
        except OSError as e:
            print(f"[watcher] Copy failed: {e}", file=sys.stderr)
            return

        if notify_server(self.api_url, dest_path, dest_name, original_name, source_user):
            try:
                os.unlink(src)
                print(f"[watcher] Spool deleted: {src}")
            except OSError as e:
                print(f"[watcher] Could not delete spool file: {e}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description="CAD Printer cups-pdf watcher")
    parser.add_argument("--watch-dir", default=DEFAULT_WATCH_DIR,
                        help="Directory to watch (cups-pdf output)")
    parser.add_argument("--api", default=DEFAULT_API_URL,
                        help="CAD Printer API base URL")
    args = parser.parse_args()

    watch_dir = args.watch_dir
    if not os.path.isdir(watch_dir):
        print(f"[watcher] Watch dir does not exist: {watch_dir}", file=sys.stderr)
        print("[watcher] Waiting for it to appear...", file=sys.stderr)
        while not os.path.isdir(watch_dir):
            time.sleep(5)

    print(f"[watcher] Watching {watch_dir}  →  API at {args.api}")
    handler = PDFHandler(api_url=args.api)
    observer = Observer()
    observer.schedule(handler, watch_dir, recursive=True)
    observer.start()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()


if __name__ == "__main__":
    main()
