from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Dict

import anyio
from fastapi import APIRouter, File, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse

from roxanne_backend.models import SpeechSynthesisRequest

logger = logging.getLogger(__name__)

router = APIRouter()


def get_container():
    """Import container from main to avoid circular dependency."""
    from roxanne_backend.main import container
    return container


@router.post("/api/audio/transcribe-upload")
async def transcribe_audio_upload(file: UploadFile = File(...)) -> Dict[str, str]:
    services = get_container()
    config = services.load_config()
    services.paths.ensure()

    audio_bytes = await file.read()
    text = await anyio.to_thread.run_sync(
        lambda: services.speech.transcribe_bytes(audio_bytes, config)
    )
    return {"text": text}


@router.post("/api/audio/speak")
async def synthesize_audio(request: SpeechSynthesisRequest) -> Dict[str, str]:
    services = get_container()
    config = services.load_config()
    audio_path = await anyio.to_thread.run_sync(services.speech.synthesize, request.text, config)
    # Return both the path and a URL the renderer can use to play the audio
    filename = Path(audio_path).name
    return {"audio_path": audio_path, "audio_url": f"/api/audio/files/{filename}"}


@router.get("/api/audio/files/{filename}")
async def serve_audio_file(filename: str):
    """Serve a synthesized audio file so the renderer can play it via HTTP."""
    services = get_container()
    # Sanitize filename to prevent path traversal
    safe_name = Path(filename).name
    file_path = services.paths.audio_path / safe_name
    if not file_path.exists() or not file_path.is_file():
        return JSONResponse(status_code=404, content={"error": "Audio file not found"})
    return FileResponse(str(file_path), media_type="audio/wav")


@router.get("/api/voices")
async def list_voices() -> Dict[str, object]:
    return get_container().speech.list_voices()


@router.post("/api/voices/download/{voice_id}")
async def download_voice(voice_id: str) -> StreamingResponse:
    """Download a voice model with streaming progress."""
    import queue
    import threading

    services = get_container()
    event_queue: queue.Queue = queue.Queue()
    done_sentinel = object()

    def run():
        try:
            path = services.speech.download_voice(voice_id)
            event_queue.put({"status": "done", "voice_id": voice_id, "path": path})
        except Exception as exc:
            event_queue.put({"status": "error", "detail": str(exc)})
        finally:
            event_queue.put(done_sentinel)

    async def generate():
        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        # Yield a starting event immediately
        yield (json.dumps({"status": "downloading", "voice_id": voice_id}) + "\n").encode()
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
            await asyncio.sleep(0.5)

    return StreamingResponse(generate(), media_type="application/x-ndjson")


@router.get("/api/speech/status")
async def speech_status() -> Dict[str, object]:
    return get_container().speech.speech_status()


@router.post("/api/speech/setup")
async def speech_setup() -> StreamingResponse:
    """Stream speech setup progress as NDJSON events.

    Runs the blocking download in a thread, polls progress, and yields
    NDJSON events to the client every 300ms so the UI stays responsive.
    """
    import queue
    import threading

    services = get_container()
    event_queue: queue.Queue = queue.Queue()
    done_sentinel = object()

    def run_setup():
        """Run in background thread, push events to queue."""
        try:
            for event in services.speech.setup_speech_streaming():
                event_queue.put(event)
        except Exception as exc:
            event_queue.put({"step": "error", "status": "error", "progress": 0, "detail": str(exc)})
        finally:
            event_queue.put(done_sentinel)

    async def generate():
        thread = threading.Thread(target=run_setup, daemon=True)
        thread.start()
        print("[speech-setup] Endpoint called, streaming thread started.", flush=True)

        while True:
            # Drain all available events from the queue
            events = []
            try:
                while True:
                    item = event_queue.get_nowait()
                    if item is done_sentinel:
                        # Yield any remaining events then stop
                        for ev in events:
                            line = json.dumps(ev) + "\n"
                            print(f"[speech-setup] -> {ev['step']}/{ev['status']}: {ev.get('detail','')}", flush=True)
                            yield line.encode()
                        print("[speech-setup] Streaming complete.", flush=True)
                        return
                    events.append(item)
            except queue.Empty:
                pass

            # Yield collected events
            for ev in events:
                line = json.dumps(ev) + "\n"
                print(f"[speech-setup] -> {ev['step']}/{ev['status']}: {ev.get('detail','')}", flush=True)
                yield line.encode()

            # Wait a bit before polling again
            await asyncio.sleep(0.3)

    return StreamingResponse(generate(), media_type="application/x-ndjson")


@router.get("/api/stt/models")
async def list_stt_models() -> Dict[str, object]:
    """List available STT models with install status."""
    return get_container().speech.list_stt_models()


@router.post("/api/stt/download/{model_id:path}")
async def download_stt_model(model_id: str) -> StreamingResponse:
    """Download an STT model with streaming progress."""
    import queue
    import threading

    services = get_container()
    event_queue: queue.Queue = queue.Queue()
    done_sentinel = object()

    def run():
        try:
            for event in services.speech.download_stt_model(model_id):
                event_queue.put(event)
        except Exception as exc:
            event_queue.put({"status": "error", "progress": 0, "detail": str(exc)})
        finally:
            event_queue.put(done_sentinel)

    async def generate():
        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        yield (json.dumps({"status": "downloading", "model_id": model_id}) + "\n").encode()
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


@router.websocket("/api/audio/stream")
async def ws_stream_transcription(ws: WebSocket):
    """
    Real-time streaming transcription via WebSocket using Vosk.

    Protocol:
    - Client sends binary audio chunks (PCM float32, 16kHz mono) continuously
    - Vosk processes each chunk instantly and returns partial/final results in real time
    - Client sends text message "END" to signal end of utterance (get final result + reset)
    - Client sends text message "RESET" to discard current recognizer and start fresh
    - Server sends JSON: {"type": "partial", "text": "..."} or {"type": "final", "text": "..."}
    """
    services = get_container()
    await ws.accept()
    logger.info("[STT] WebSocket connected — loading Vosk model…")

    sample_rate = 16000
    recognizer = None
    last_partial = ""

    try:
        # Pre-load the vosk model using configured STT model
        config = services.config_store.load()
        recognizer = services.speech.create_recognizer(sample_rate, config)
        logger.info(f"[STT] Recognizer ready (model={config.speech.stt_model}, rate={sample_rate})")

        while True:
            message = await ws.receive()

            if message.get("type") == "websocket.disconnect":
                break

            # Text message = control signal
            if "text" in message:
                text_msg = message["text"]

                if text_msg == "END":
                    # Get final result from recognizer
                    if recognizer is not None:
                        final = json.loads(recognizer.FinalResult())
                        final_text = final.get("text", "").strip()
                        await ws.send_json({"type": "final", "text": final_text})
                        # Reset recognizer for next utterance
                        recognizer = services.speech.create_recognizer(sample_rate)
                        last_partial = ""
                    continue

                if text_msg == "RESET":
                    recognizer = services.speech.create_recognizer(sample_rate)
                    last_partial = ""
                    continue

                # Config update (e.g., sample rate)
                try:
                    ctrl = json.loads(text_msg)
                    if "sample_rate" in ctrl:
                        sample_rate = int(ctrl["sample_rate"])
                        recognizer = services.speech.create_recognizer(sample_rate)
                        last_partial = ""
                    continue
                except (json.JSONDecodeError, ValueError):
                    continue

            # Binary message = audio data
            if "bytes" in message and recognizer is not None:
                raw = message["bytes"]

                # Convert float32 PCM to int16 PCM (Vosk expects 16-bit PCM)
                import numpy as np
                floats = np.frombuffer(raw, dtype=np.float32)
                int16_data = (floats * 32767).clip(-32768, 32767).astype(np.int16).tobytes()

                # Feed to Vosk — it processes immediately
                if recognizer.AcceptWaveform(int16_data):
                    # Vosk detected end of phrase — send final result
                    result = json.loads(recognizer.Result())
                    text = result.get("text", "").strip()
                    logger.info(f"[STT final] {text!r}")
                    if text:
                        await ws.send_json({"type": "final", "text": text})
                        last_partial = ""
                else:
                    # Partial result — send as interim transcript
                    partial = json.loads(recognizer.PartialResult())
                    partial_text = partial.get("partial", "").strip()
                    if partial_text and partial_text != last_partial:
                        last_partial = partial_text
                        logger.info(f"[STT interim] {partial_text!r}")
                        await ws.send_json({"type": "interim", "text": partial_text})

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.error(f"WebSocket transcription error: {exc}")
        try:
            await ws.send_json({"type": "error", "text": str(exc)})
        except Exception:
            pass
