#!/usr/bin/env python3
"""
Brightstar Bid bot — native CSV watcher host.

Chrome Native Messaging host that watches a jobs CSV and pushes contents when
the file changes (or on demand). Also reads per-row resume/cover PDFs for Apply.
"""

from __future__ import annotations

import base64
import json
import os
import struct
import sys
import threading
import time
from pathlib import Path

try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler
except ImportError:
    Observer = None
    FileSystemEventHandler = object  # type: ignore


def read_message():
    raw_len = sys.stdin.buffer.read(4)
    if not raw_len or len(raw_len) < 4:
        return None
    (length,) = struct.unpack("<I", raw_len)
    data = sys.stdin.buffer.read(length)
    if not data:
        return None
    return json.loads(data.decode("utf-8"))


def send_message(payload: dict) -> None:
    encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


class CsvHandler(FileSystemEventHandler):
    def __init__(self, path: Path, lock: threading.Lock):
        super().__init__()
        self.path = path.resolve()
        self.lock = lock
        self._last_emit = 0.0

    def on_any_event(self, event):  # noqa: N802
        try:
            if getattr(event, "is_directory", False):
                return
            src = Path(getattr(event, "src_path", "") or "").resolve()
            dest = Path(getattr(event, "dest_path", "") or "").resolve() if getattr(event, "dest_path", None) else None
            if src != self.path and dest != self.path:
                return
            now = time.time()
            if now - self._last_emit < 1.5:
                return
            self._last_emit = now
            # Small delay so writers finish flushing
            time.sleep(0.4)
            emit_file(self.path, reason="watch")
        except Exception as exc:  # noqa: BLE001
            send_message({"type": "error", "error": str(exc)})


def emit_file(path: Path, reason: str = "read") -> None:
    if not path.exists():
        send_message({"type": "error", "error": f"File not found: {path}", "reason": reason})
        return
    text = path.read_text(encoding="utf-8", errors="replace")
    send_message(
        {
            "type": "csv_update",
            "reason": reason,
            "path": str(path),
            "fileName": path.name,
            "text": text,
            "mtimeMs": int(path.stat().st_mtime * 1000),
        }
    )


def downloads_root() -> Path:
    home = Path.home()
    for candidate in (home / "Downloads", home / "Download"):
        if candidate.is_dir():
            return candidate
    return home / "Downloads"


def is_allowed_pdf(path: Path) -> bool:
    try:
        resolved = path.expanduser().resolve()
    except OSError:
        return False
    if not resolved.is_file() or resolved.suffix.lower() != ".pdf":
        return False
    name = resolved.name.lower()
    if "resume" not in name and "cover" not in name:
        return False
    parts = [p.lower() for p in resolved.parts]
    blob = " ".join(parts)
    return "downloads" in parts or "download" in parts or "resume applications" in blob


def pick_pdfs(folder: Path) -> tuple:
    resume = None
    cover = None
    files = sorted(
        (p for p in folder.iterdir() if p.is_file()),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    for item in files:
        name = item.name.lower()
        if item.suffix.lower() != ".pdf":
            continue
        if "cover" in name and "letter" in name:
            if cover is None:
                cover = item
        elif name.endswith("resume.pdf") and "cover" not in name:
            if resume is None:
                resume = item
    return resume, cover


def find_job_folder(csv_row, job_dir: str):
    downloads = downloads_root()
    apps = downloads / "Resume Applications"
    prefix = ""
    try:
        if csv_row is not None and str(csv_row).strip() != "":
            prefix = f"{int(csv_row)} - "
    except (TypeError, ValueError):
        prefix = ""

    def matches_row(path: Path) -> bool:
        if not prefix:
            return True
        return path.name.startswith(prefix)

    raw = str(job_dir or "").strip().replace("/", os.sep)
    if raw:
        candidate = Path(raw)
        if not candidate.is_absolute():
            candidate = downloads / raw
        try:
            candidate = candidate.expanduser().resolve()
        except OSError:
            candidate = None
        if candidate and candidate.is_dir() and matches_row(candidate):
            return candidate

    search_roots = []
    if apps.is_dir():
        search_roots.append(apps)
    if downloads.is_dir():
        search_roots.append(downloads)

    matches = []
    if prefix:
        for root in search_roots:
            try:
                for child in root.iterdir():
                    if child.is_dir() and child.name.startswith(prefix):
                        matches.append(child)
            except OSError:
                continue
        if len(matches) == 1:
            return matches[0]
        if matches:
            return sorted(matches, key=lambda p: p.stat().st_mtime, reverse=True)[0]

    segment = Path(raw).name if raw else ""
    if segment:
        for root in search_roots:
            try:
                hit = root / segment
                if hit.is_dir() and matches_row(hit):
                    return hit
            except OSError:
                continue
    return None


def handle_read_file(path_str: str) -> None:
    path = Path(str(path_str or "").strip())
    if not str(path):
        send_message({"type": "file", "ok": False, "error": "read_file requires path"})
        return
    if not is_allowed_pdf(path):
        send_message({"type": "file", "ok": False, "error": "Refused to read that file."})
        return
    resolved = path.expanduser().resolve()
    data = resolved.read_bytes()
    if len(data) > 700_000:
        send_message({"type": "file", "ok": False, "error": f"PDF too large to transfer ({resolved.name})."})
        return
    send_message(
        {
            "type": "file",
            "ok": True,
            "path": str(resolved),
            "fileName": resolved.name,
            "mimeType": "application/pdf",
            "base64": base64.b64encode(data).decode("ascii"),
        }
    )


def handle_read_job_docs(csv_row, job_dir: str) -> None:
    folder = find_job_folder(csv_row, job_dir)
    if not folder:
        send_message(
            {
                "type": "job_docs",
                "ok": False,
                "error": f"No folder for row {csv_row or '?'} under Downloads / Resume Applications.",
            }
        )
        return
    resume, cover = pick_pdfs(folder)
    payload = {
        "type": "job_docs",
        "ok": True,
        "csvRow": csv_row,
        "folder": str(folder),
        "resumePath": str(resume) if resume else "",
        "resumeName": resume.name if resume else "",
        "coverPath": str(cover) if cover else "",
        "coverName": cover.name if cover else "",
    }
    if not resume and not cover:
        payload["ok"] = False
        payload["error"] = f"No resume/cover PDFs in {folder.name}"
    send_message(payload)


def main() -> int:
    watch_path = os.environ.get("BRIGHTSTAR_CSV_PATH", "").strip()
    if len(sys.argv) > 1 and not watch_path:
        watch_path = sys.argv[1].strip()

    observer = None
    lock = threading.Lock()

    def start_watch(path_str: str) -> None:
        nonlocal observer, watch_path
        watch_path = path_str
        path = Path(path_str)
        if observer:
            observer.stop()
            observer.join(timeout=2)
            observer = None
        if Observer is None:
            send_message(
                {
                    "type": "status",
                    "ok": False,
                    "error": "Install watchdog: pip install watchdog",
                    "path": path_str,
                }
            )
            return
        if not path.parent.exists():
            send_message({"type": "error", "error": f"Folder missing: {path.parent}"})
            return
        handler = CsvHandler(path, lock)
        observer = Observer()
        observer.schedule(handler, str(path.parent), recursive=False)
        observer.start()
        send_message({"type": "status", "ok": True, "watching": str(path.resolve())})
        if path.exists():
            emit_file(path, reason="watch_start")

    # Wait for Chrome's first message. sendNativeMessage requires the first
    # reply to match read_file / read_job_docs, not a startup status ping.

    while True:
        msg = read_message()
        if msg is None:
            break
        mtype = str(msg.get("type") or "")
        if mtype in ("ping", "hello"):
            env_path = os.environ.get("BRIGHTSTAR_CSV_PATH", "").strip()
            if not observer and (watch_path or env_path):
                start_watch(watch_path or env_path)
            else:
                send_message({"type": "pong", "watching": watch_path or None})
        elif mtype == "watch":
            path = str(msg.get("path") or "").strip()
            if not path:
                send_message({"type": "error", "error": "watch requires path"})
            else:
                start_watch(path)
        elif mtype == "read":
            path = str(msg.get("path") or watch_path or "").strip()
            if not path:
                send_message({"type": "error", "error": "read requires path"})
            else:
                emit_file(Path(path), reason="read")
        elif mtype == "read_file":
            handle_read_file(str(msg.get("path") or ""))
        elif mtype == "read_job_docs":
            handle_read_job_docs(msg.get("csvRow"), str(msg.get("jobDir") or ""))
        elif mtype == "stop":
            break
        else:
            send_message({"type": "error", "error": f"Unknown type: {mtype}"})

    if observer:
        observer.stop()
        observer.join(timeout=2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
