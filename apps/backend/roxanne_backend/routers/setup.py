from __future__ import annotations

import asyncio
import json
import platform as _platform
from pathlib import Path
from typing import Dict

import anyio
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

router = APIRouter()


def get_container():
    """Import container from main to avoid circular dependency."""
    from roxanne_backend.main import container
    return container


@router.get("/api/zotero/detect")
async def detect_zotero() -> Dict[str, object]:
    """Auto-detect Zotero data directory on this machine."""
    home = Path.home()
    system = _platform.system().lower()

    # Zotero default data directories per platform
    candidates = []
    if system == "darwin":
        candidates = [
            home / "Zotero",
            home / "Library" / "Application Support" / "Zotero" / "Profiles",
        ]
    elif system == "linux":
        candidates = [
            home / "Zotero",
            home / ".zotero" / "zotero",
        ]
    elif system == "windows":
        candidates = [
            home / "Zotero",
            home / "AppData" / "Roaming" / "Zotero" / "Zotero" / "Profiles",
        ]

    # Also check the Zotero prefs for a custom data directory
    # But the most reliable approach: look for ~/Zotero/storage
    storage_path = None
    database_path = None

    for candidate in candidates:
        s = candidate / "storage"
        d = candidate / "zotero.sqlite"
        if s.is_dir():
            storage_path = str(s)
            if d.is_file():
                database_path = str(d)
            break
        # Also check if the candidate itself has zotero.sqlite (profile-based)
        if d.is_file() and not storage_path:
            database_path = str(d)

    return {
        "found": storage_path is not None,
        "storage_path": storage_path,
        "database_path": database_path,
    }


@router.get("/api/ollama/status")
async def get_ollama_status() -> Dict[str, object]:
    from roxanne_backend.ollama_manager import ollama_status
    return await anyio.to_thread.run_sync(ollama_status)


@router.post("/api/ollama/start")
async def start_ollama() -> Dict[str, object]:
    from roxanne_backend.ollama_manager import start_ollama_server
    return await anyio.to_thread.run_sync(start_ollama_server)


@router.get("/api/ollama/install-info")
async def ollama_install_info() -> Dict[str, object]:
    from roxanne_backend.ollama_manager import install_instructions
    return install_instructions()


@router.post("/api/ollama/pull/{model_name:path}")
async def pull_ollama_model(model_name: str) -> StreamingResponse:
    """Pull an Ollama model with streaming progress."""
    import queue
    import threading
    from roxanne_backend.ollama_manager import pull_model_streaming

    event_queue: queue.Queue = queue.Queue()
    done_sentinel = object()

    def run():
        try:
            for event in pull_model_streaming(model_name):
                event_queue.put(event)
        except Exception as exc:
            event_queue.put({"status": "error", "progress": 0, "detail": str(exc)})
        finally:
            event_queue.put(done_sentinel)

    async def generate():
        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        while True:
            events = []
            try:
                while True:
                    item = event_queue.get_nowait()
                    if item is done_sentinel:
                        for ev in events:
                            yield (json.dumps(ev) + "\n").encode()
                        return
                    events.append(item)
            except queue.Empty:
                pass
            for ev in events:
                yield (json.dumps(ev) + "\n").encode()
            await asyncio.sleep(0.3)

    return StreamingResponse(generate(), media_type="application/x-ndjson")
