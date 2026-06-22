"""
SmartPlay Caddie — Pipecat voice server.

Endpoints:
  GET  /health                    — health check for Railway
  POST /session                   — create a session token (called by React Native before connecting)
  POST /turn                      — Phase 2 text-in / text+tools-out (Claude brain, no audio pipeline)
  WS   /ws/{session_id}           — Phase 3 WebSocket audio stream; React Native connects here

/turn flow (Phase 2):
  React Native records audio → Whisper STT → transcript text → POST /turn
  Claude processes with tool_use → returns response_text + tool_actions
  React Native plays TTS via existing speak() and dispatches tool_actions

/ws flow (Phase 3):
  Real-time audio: Silero VAD → Deepgram STT → Claude → OpenAI TTS streamed back
"""

import asyncio
import json
import os
import secrets
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pipecat.pipeline.runner import PipelineRunner

from kevin_pipeline import build_pipeline
from session_context import SessionContext
from turn_handler import handle_turn

load_dotenv()

# ── In-memory session store (replace with Redis for multi-instance Railway) ──
_sessions: dict[str, SessionContext] = {}

SESSION_SECRET = os.environ.get("SESSION_SECRET", "dev-secret-change-me")


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[pipecat] Kevin voice server starting")
    yield
    print("[pipecat] Kevin voice server shutting down")


app = FastAPI(title="SmartPlay Kevin Voice Server", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten to Vercel domain in production
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "service": "kevin-pipecat"}


# ── Session create ────────────────────────────────────────────────────────────

@app.post("/session")
async def create_session(body: dict):
    """
    React Native calls this before opening the WebSocket.
    Body: { secret, player, round, bag, settings }
    Returns: { sessionId, wsUrl }
    """
    if body.get("secret") != SESSION_SECRET:
        raise HTTPException(status_code=403, detail="bad secret")

    session_id = secrets.token_urlsafe(16)
    ctx = SessionContext(session_id)

    # Pre-populate from the body so context is ready before WS connects
    ctx.apply({"type": "context", **{k: body[k] for k in ("player", "round", "bag", "settings", "gps") if k in body}})
    _sessions[session_id] = ctx

    ws_base = os.environ.get("PIPECAT_WS_BASE", "ws://localhost:8080")
    return {"sessionId": session_id, "wsUrl": f"{ws_base}/ws/{session_id}"}


# ── Turn handler (Phase 2 text path) ─────────────────────────────────────────

@app.post("/turn")
async def turn(body: dict):
    """
    Phase 2 voice brain endpoint.
    Body: { secret, text, history, context, sessionId? }
    Returns: { response_text, tool_actions, updated_history }
    """
    if body.get("secret") != SESSION_SECRET:
        raise HTTPException(status_code=403, detail="bad secret")

    text = body.get("text", "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    history = body.get("history", [])
    context = body.get("context", {})
    session_id = body.get("sessionId")

    # Merge session context if we have one open
    if session_id and session_id in _sessions:
        live_ctx = _sessions[session_id].snapshot()
        # Live session context wins over stale client snapshot for GPS/hole
        context = {**context, **live_ctx}

    result = await handle_turn(
        text=text,
        history=history,
        context=context,
        session_id=session_id,
    )
    return result


# ── WebSocket handler ─────────────────────────────────────────────────────────

@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()
    print(f"[pipecat] WS connected: {session_id}")

    ctx = _sessions.get(session_id)
    if not ctx:
        # Allow context-free connections during development (no /session pre-call)
        ctx = SessionContext(session_id)
        _sessions[session_id] = ctx

    async def push_ui_event(tool_name: str, data: dict):
        """Send a UI-tool event to React Native over the WebSocket data channel."""
        try:
            await websocket.send_text(json.dumps({"type": "ui_event", "tool": tool_name, "data": data}))
        except Exception as e:
            print(f"[pipecat] push_ui_event error: {e}")

    try:
        task, transport = await build_pipeline(websocket, ctx, push_ui_event)
        runner = PipelineRunner()

        # Spawn a task to handle incoming text frames (context updates from RN)
        async def handle_text_frames():
            try:
                while True:
                    msg = await websocket.receive_text()
                    try:
                        parsed = json.loads(msg)
                        msg_type = parsed.get("type")
                        if msg_type in ("context", "gps_update", "hole_transition", "round_end"):
                            ctx.apply(parsed)
                            print(f"[pipecat] ctx update: {msg_type}")
                        elif msg_type == "end_session":
                            await task.cancel()
                            break
                    except json.JSONDecodeError:
                        pass
            except WebSocketDisconnect:
                await task.cancel()

        asyncio.create_task(handle_text_frames())
        await runner.run(task)

    except WebSocketDisconnect:
        print(f"[pipecat] WS disconnected: {session_id}")
    except Exception as e:
        print(f"[pipecat] pipeline error ({session_id}): {e}")
        try:
            await websocket.close(code=1011)
        except Exception:
            pass
    finally:
        _sessions.pop(session_id, None)
        print(f"[pipecat] session cleaned up: {session_id}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.environ.get("PORT", 8080)), reload=False)
