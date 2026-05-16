from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from typing import Dict

import anyio
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from roxanne_backend.models import IndexRequest

router = APIRouter()


def get_container():
    """Import container from main to avoid circular dependency."""
    from roxanne_backend.main import container
    return container


@router.post("/api/index")
async def run_index(request: IndexRequest) -> Dict[str, object]:
    services = get_container()
    config = services.load_config()
    indexer = services.indexer(config)

    if request.scope == "papers":
        report = await anyio.to_thread.run_sync(indexer.index_papers, config)
    elif request.scope == "notes":
        report = await anyio.to_thread.run_sync(indexer.index_notes, config)
    else:
        report = await anyio.to_thread.run_sync(indexer.index_all, config)

    return {"scope": request.scope, "report": report}


@router.post("/api/index/stream")
async def run_index_streaming(force: bool = False) -> StreamingResponse:
    """Stream indexing progress as NDJSON — yields per-file events.

    Pass ?force=true to re-index everything regardless of change detection.
    """
    import queue
    import threading

    services = get_container()
    config = services.load_config()
    indexer = services.indexer(config)

    event_queue: queue.Queue = queue.Queue()
    done_sentinel = object()

    def run():
        try:
            for event in indexer.index_all_streaming(config, force=force):
                event_queue.put(event)
        except Exception as exc:
            event_queue.put({"phase": "error", "progress": 0, "detail": str(exc)})
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
            await asyncio.sleep(0.2)

    return StreamingResponse(generate(), media_type="application/x-ndjson")


@router.get("/api/index/browse/{collection}")
async def browse_index(
    collection: str, limit: int = 500, offset: int = 0, full_text: bool = False
) -> Dict[str, object]:
    """Browse indexed documents in a collection (papers, notes, memories)."""
    allowed = {"papers", "notes", "memories", "zotero_notes"}
    if collection not in allowed:
        return {"error": f"Unknown collection. Use one of: {allowed}"}
    services = get_container()
    config = services.load_config()
    try:
        store = services.retrieval(config)
        return store.list_collection(
            collection, limit=min(limit, 2000), offset=offset, full_text=full_text
        )
    except Exception as exc:
        return {"error": str(exc), "total": 0, "items": []}


@router.get("/api/index/tree/{collection}")
async def index_tree(collection: str) -> Dict[str, object]:
    """Return items grouped by their hierarchy (collections for papers, folders for notes)."""
    allowed = {"papers", "notes", "zotero_notes"}
    if collection not in allowed:
        return {"error": f"Unknown collection. Use one of: {allowed}"}
    services = get_container()
    config = services.load_config()
    try:
        store = services.retrieval(config)
        data = store.list_collection(collection, limit=2000, offset=0, full_text=False)
        items = data.get("items", [])

        if collection == "papers":
            return _build_paper_tree(items)
        elif collection == "notes":
            return _build_note_tree(items)
        else:
            return _build_zotero_note_tree(items)
    except Exception as exc:
        return {"error": str(exc), "groups": []}


@router.get("/api/index/stats")
async def index_stats() -> Dict[str, object]:
    """Return document counts for each vector collection."""
    services = get_container()
    config = services.load_config()
    try:
        store = services.retrieval(config)
        papers = store._collection(store.PAPER_COLLECTION).count()
        notes = store._collection(store.NOTE_COLLECTION).count()
        memories = store._collection(store.MEMORY_COLLECTION).count()
        zotero_notes = store._collection("zotero_notes").count()
    except Exception:
        papers = notes = memories = zotero_notes = 0
    return {
        "papers": papers,
        "notes": notes,
        "memories": memories,
        "zotero_notes": zotero_notes,
    }


@router.get("/api/index/activity")
async def index_activity() -> Dict[str, object]:
    """Return current auto-index status (running, progress, last event)."""
    from roxanne_backend.main import _index_state
    return {
        "running": _index_state["running"],
        "last_event": _index_state["last_event"],
        "last_completed": _index_state["last_completed"],
    }


# ── Helper functions ────────────────────────────────────────────────


def _build_paper_tree(items: list) -> Dict[str, object]:
    """Group papers by Zotero collection, then by paper."""
    collection_papers: dict = defaultdict(dict)
    uncategorized: dict = {}

    for item in items:
        meta = item.get("metadata", {})
        paper_id = meta.get("paper_id", item["id"])
        title = meta.get("title", "Untitled")
        collections_str = meta.get("collections", "")
        collections = [c.strip() for c in collections_str.split(";") if c.strip()] if collections_str else []

        paper_info = {
            "paper_id": paper_id,
            "title": title,
            "authors": meta.get("authors", ""),
            "year": meta.get("year", ""),
            "tags": meta.get("tags", ""),
            "total_chunks": meta.get("total_chunks", 0),
            "total_pages": meta.get("total_pages", 0),
        }

        if not collections:
            uncategorized[paper_id] = paper_info
        else:
            for coll in collections:
                collection_papers[coll][paper_id] = paper_info

    groups = []
    for coll_name in sorted(collection_papers.keys()):
        papers = list(collection_papers[coll_name].values())
        groups.append({
            "name": coll_name,
            "type": "collection",
            "paper_count": len(papers),
            "papers": papers,
        })
    if uncategorized:
        groups.append({
            "name": "Uncategorized",
            "type": "collection",
            "paper_count": len(uncategorized),
            "papers": list(uncategorized.values()),
        })

    return {"groups": groups, "total_papers": len({item.get("metadata", {}).get("paper_id") for item in items})}


def _build_note_tree(items: list) -> Dict[str, object]:
    """Build a folder tree for Obsidian notes."""
    vault_folders: dict = defaultdict(lambda: defaultdict(list))

    seen_notes: dict = {}
    for item in items:
        meta = item.get("metadata", {})
        note_id = meta.get("note_id", item["id"])
        if note_id in seen_notes:
            continue
        seen_notes[note_id] = True
        vault_name = meta.get("vault_name", "Unknown")
        folder = meta.get("folder_path", "") or ""
        vault_folders[vault_name][folder].append({
            "note_id": note_id,
            "title": meta.get("title", "Untitled"),
            "relative_path": meta.get("relative_path", ""),
            "total_chunks": meta.get("total_chunks", 0),
        })

    groups = []
    for vault_name in sorted(vault_folders.keys()):
        folders = []
        for folder_path in sorted(vault_folders[vault_name].keys()):
            notes = vault_folders[vault_name][folder_path]
            folders.append({
                "path": folder_path or "(root)",
                "note_count": len(notes),
                "notes": notes,
            })
        groups.append({
            "name": vault_name,
            "type": "vault",
            "folder_count": len(folders),
            "total_notes": sum(len(f["notes"]) for f in folders),
            "folders": folders,
        })

    return {"groups": groups, "total_notes": len(seen_notes)}


def _build_zotero_note_tree(items: list) -> Dict[str, object]:
    """Group Zotero notes by parent paper."""
    seen: dict = {}
    for item in items:
        meta = item.get("metadata", {})
        note_id = meta.get("note_id", item["id"])
        if note_id in seen:
            continue
        parent_title = meta.get("parent_title", "Unknown paper")
        seen[note_id] = {
            "note_id": note_id,
            "note_type": meta.get("note_type", "note"),
            "parent_title": parent_title,
            "collections": meta.get("collections", ""),
            "total_chunks": meta.get("total_chunks", 0),
        }

    by_parent: dict = defaultdict(list)
    for info in seen.values():
        by_parent[info["parent_title"]].append(info)

    groups = [
        {"parent_title": title, "notes": notes, "note_count": len(notes)}
        for title, notes in sorted(by_parent.items())
    ]
    return {"groups": groups, "total_notes": len(seen)}
