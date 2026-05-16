from __future__ import annotations

import json
from typing import Dict

from fastapi import APIRouter
from fastapi.responses import JSONResponse, StreamingResponse

from roxanne_backend.models import ChatRequest, ConversationTurn

router = APIRouter()


def get_container():
    """Import container from main to avoid circular dependency."""
    from roxanne_backend.main import container
    return container


@router.get("/api/config")
async def get_config() -> Dict[str, object]:
    return get_container().load_config().public_dump()


@router.post("/api/config")
async def save_config(config) -> Dict[str, object]:
    from roxanne_backend.models import AppConfig
    return get_container().save_config(config).public_dump()


@router.get("/api/tools")
async def list_tools() -> Dict[str, object]:
    services = get_container()
    config = services.load_config()
    return {"tools": services.tool_registry(config).schemas()}


@router.get("/api/conversations")
async def list_conversations():
    return get_container().conversations.list_all()


@router.post("/api/conversations")
async def create_conversation(body: Dict = None):
    title = (body or {}).get("title", "New conversation")
    return get_container().conversations.create(title)


@router.get("/api/conversations/{conv_id}")
async def get_conversation(conv_id: str):
    data = get_container().conversations.get(conv_id)
    if not data:
        return JSONResponse({"error": "Not found"}, status_code=404)
    return data


@router.post("/api/conversations/{conv_id}/messages")
async def append_conversation_message(conv_id: str, body: Dict):
    get_container().conversations.append_message(conv_id, body["role"], body["content"])
    return {"ok": True}


@router.patch("/api/conversations/{conv_id}")
async def update_conversation(conv_id: str, body: Dict):
    if "title" in body:
        get_container().conversations.update_title(conv_id, body["title"])
    return {"ok": True}


@router.delete("/api/conversations/{conv_id}")
async def delete_conversation(conv_id: str):
    ok = get_container().conversations.delete(conv_id)
    return {"ok": ok}


@router.post("/api/chat/stream")
async def stream_chat(request: ChatRequest) -> StreamingResponse:
    services = get_container()
    orchestrator = services.orchestrator()
    stream_request = request
    conversation_id = request.conversation_id

    if conversation_id:
        history = [
            ConversationTurn(role=turn["role"], content=turn["content"])
            for turn in services.conversations.prompt_history(conversation_id)
        ]
        if services.conversations.get(conversation_id):
            services.conversations.append_message(conversation_id, "user", request.message)
            stream_request = request.model_copy(deep=True)
            stream_request.history = history

    async def generate():
        assistant_deltas: list[str] = []
        assistant_done_message = ""
        assistant_completed = False

        try:
            async for chunk in orchestrator.stream(stream_request):
                if conversation_id:
                    try:
                        event = json.loads(chunk.decode("utf-8").strip())
                    except Exception:
                        event = None

                    if isinstance(event, dict):
                        if event.get("type") == "assistant_delta" and event.get("delta"):
                            assistant_deltas.append(str(event["delta"]))
                        elif event.get("type") == "assistant_done":
                            assistant_completed = True
                            payload = event.get("payload") or {}
                            assistant_done_message = str(payload.get("message") or "")

                yield chunk
        finally:
            if conversation_id:
                assistant_message = (assistant_done_message or "".join(assistant_deltas)).strip()
                if assistant_completed and assistant_message:
                    services.conversations.append_message(conversation_id, "assistant", assistant_message)

    return StreamingResponse(generate(), media_type="application/x-ndjson")
