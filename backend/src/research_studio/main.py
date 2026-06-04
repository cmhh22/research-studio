"""FastAPI app + WebSocket endpoint driving the agent runtime."""

import asyncio
import logging
from uuid import UUID, uuid4

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from research_studio.agents.orchestrator import Orchestrator
from research_studio.config import settings
from research_studio.events import EventType, RuntimeEvent

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

app = FastAPI(title="Research Studio", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.websocket("/ws/research/{session_id}")
async def research_ws(websocket: WebSocket, session_id: str) -> None:
    await websocket.accept()
    try:
        sid = UUID(session_id)
    except ValueError:
        sid = uuid4()

    async def emit(event: RuntimeEvent) -> None:
        # model_dump_json() serializes UUID and datetime to valid JSON strings.
        await websocket.send_text(event.model_dump_json())

    try:
        first = await websocket.receive_json()
        question = (first.get("question") or "").strip()
        if not question:
            await emit(
                RuntimeEvent(
                    type=EventType.ERROR,
                    session_id=sid,
                    payload={"error": "Missing 'question' in initial message."},
                )
            )
            return

        orchestrator = Orchestrator(session_id=sid, emit=emit)
        await orchestrator.run(question)

        while True:
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        return
