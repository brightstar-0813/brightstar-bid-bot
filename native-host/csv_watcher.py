#!/usr/bin/env python3
"""
Brightstar Bid bot — native CSV watcher host.

Chrome Native Messaging host that watches a jobs CSV and pushes contents when
the file changes (or on demand).

Install: see install-windows.ps1 / install-macos.sh
"""

from __future__ import annotations

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

    if watch_path:
        start_watch(watch_path)
    else:
        send_message(
            {
                "type": "status",
                "ok": True,
                "watching": None,
                "hint": "Send {\"type\":\"watch\",\"path\":\"C:/path/jobs_latest.csv\"}",
            }
        )

    while True:
        msg = read_message()
        if msg is None:
            break
        mtype = str(msg.get("type") or "")
        if mtype in ("ping", "hello"):
            send_message({"type": "pong", "watching": watch_path or None})
        elif mtype == "watch":
            path = str(msg.get("path") || "").strip()
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
