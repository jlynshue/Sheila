from __future__ import annotations

import asyncio
import json
import logging
import os
import struct
import tempfile
from pathlib import Path
from typing import Dict, Optional, Tuple
from uuid import uuid4

import anyio
from fastapi import FastAPI, File, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse

logger = logging.getLogger(__name__)

from roxanne_backend.config import ConfigStore
from roxanne_backend.ingestion.indexer import ContentIndexer
from roxanne_backend.models import (
    AppConfig,
    ChatRequest,
    ConversationTurn,
    IndexRequest,
    SpeechSynthesisRequest,
)
from roxanne_backend.orchestrator import ChatOrchestrator
from roxanne_backend.retrieval import RetrievalStore, SessionMemoryStore
from roxanne_backend.speech import SpeechService
from roxanne_backend.storage import AppPaths
from roxanne_backend.tools.obsidian import ReadNotesTool, WriteNoteTool
from roxanne_backend.tools.registry import ToolRegistry
from roxanne_backend.tools.search import SearchSourcesTool
from roxanne_backend.tools.zotero import (
    GetCollectionPapersTool,
    GetPaperAnnotationsTool,
    GetPaperMetadataTool,
    GetPaperNotesTool,
    ListZoteroCollectionsTool,
    OpenPdfTool,
    RetrievePaperChunksTool,
    SearchZoteroMetadataTool,
    SearchZoteroNotesTool,
    SearchZoteroTool,
)


def allowed_origins() -> list[str]:
    configured = os.getenv("ROXANNE_ALLOWED_ORIGINS")
    if configured:
        return [origin.strip() for origin in configured.split(",") if origin.strip()]
    return [
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        "null",
        "file://",
    ]


class ServiceContainer:
    def __init__(self) -> None:
        self.paths = AppPaths()
        self.paths.ensure()
        self.paths.prune_audio_files()
        self.config_store = ConfigStore(self.paths)
        self.speech = SpeechService(self.paths)
        from roxanne_backend.conversations import ConversationStore
        self.conversations = ConversationStore(self.paths.root)
        self._retrieval_cache: Optional[Tuple[str, RetrievalStore]] = None

    def load_config(self) -> AppConfig:
        return self.config_store.load()

    def save_config(self, config: AppConfig) -> AppConfig:
        saved = self.config_store.save(config)
        self._retrieval_cache = None
        return saved

    def retrieval(self, config: AppConfig) -> RetrievalStore:
        signature = (
            f"{config.embeddings.provider}:"
            f"{config.embeddings.model}:"
            f"{bool(config.embeddings.openai_api_key)}"
        )
        if self._retrieval_cache and self._retrieval_cache[0] == signature:
            return self._retrieval_cache[1]
        store = RetrievalStore(self.paths, config.embeddings)
        self._retrieval_cache = (signature, store)
        return store

    def indexer(self, config: AppConfig) -> ContentIndexer:
        return ContentIndexer(self.retrieval(config))

    def tool_registry(self, config: AppConfig) -> ToolRegistry:
        retrieval = self.retrieval(config)
        return ToolRegistry(
            [
                SearchSourcesTool(retrieval),
                # Zotero vector search
                SearchZoteroTool(retrieval),
                RetrievePaperChunksTool(retrieval),
                OpenPdfTool(retrieval),
                # Zotero database tools
                GetPaperMetadataTool(self.config_store, retrieval),
                ListZoteroCollectionsTool(self.config_store),
                SearchZoteroMetadataTool(self.config_store),
                GetPaperNotesTool(self.config_store, retrieval),
                GetPaperAnnotationsTool(self.config_store, retrieval),
                SearchZoteroNotesTool(retrieval),
                GetCollectionPapersTool(self.config_store),
                # Obsidian
                ReadNotesTool(retrieval),
                WriteNoteTool(self.config_store, self.indexer(config)),
            ]
        )

    def orchestrator(self) -> ChatOrchestrator:
        return ChatOrchestrator(
            config_loader=self.load_config,
            registry_factory=self.tool_registry,
            memory_factory=lambda config: SessionMemoryStore(self.retrieval(config)),
        )


# Global container instance accessible to routers
container: ServiceContainer = ServiceContainer()

# ── Auto-index state (shared between background task and status endpoint) ──
_index_state: Dict[str, object] = {
    "running": False,
    "last_event": None,  # most recent IndexEvent dict
    "last_completed": None,  # ISO timestamp of last completed index
}

app = FastAPI(title="Roxanne Assistant Backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins(),
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
)

# Include routers
from roxanne_backend.routers import chat, index, setup, speech

app.include_router(chat.router)
app.include_router(speech.router)
app.include_router(index.router)
app.include_router(setup.router)


async def _auto_index_loop():
    """Background task: auto-index on startup, then every 15 minutes."""
    import threading
    from datetime import datetime, timezone

    await asyncio.sleep(3)  # let server finish starting

    while True:
        config = container.load_config()
        if not config.is_complete():
            await asyncio.sleep(60)
            continue

        _index_state["running"] = True
        indexer = container.indexer(config)

        def run():
            for event in indexer.index_all_streaming(config):
                _index_state["last_event"] = event

        thread = threading.Thread(target=run, daemon=True)
        thread.start()

        # Wait for thread to finish without blocking the event loop
        while thread.is_alive():
            await asyncio.sleep(0.5)

        _index_state["running"] = False
        _index_state["last_completed"] = datetime.now(timezone.utc).isoformat()
        logger.info("Auto-index complete: %s", _index_state.get("last_event", {}).get("detail", ""))

        await asyncio.sleep(900)  # 15 minutes


@app.on_event("startup")
async def _start_auto_indexer():
    asyncio.create_task(_auto_index_loop())


@app.get("/health")
async def health() -> Dict[str, object]:
    return {
        "status": "ok",
        "app_home": str(container.paths.root),
    }


@app.exception_handler(Exception)
async def handle_error(_, exc: Exception):
    return JSONResponse(status_code=500, content={"error": str(exc)})
