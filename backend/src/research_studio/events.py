"""Runtime event types streamed from the agent runtime to the frontend."""

from datetime import UTC, datetime
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class EventType(str, Enum):
    SESSION_STARTED = "session.started"
    PLAN_CREATED = "plan.created"
    SUBAGENT_STARTED = "subagent.started"
    SUBAGENT_THOUGHT = "subagent.thought"
    SUBAGENT_TOOL_CALL = "subagent.tool_call"
    SUBAGENT_TOOL_RESULT = "subagent.tool_result"
    SUBAGENT_FINISHED = "subagent.finished"
    REPORT_READY = "report.ready"
    ERROR = "error"


class RuntimeEvent(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    type: EventType
    session_id: UUID
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
    payload: dict[str, Any] = Field(default_factory=dict)
