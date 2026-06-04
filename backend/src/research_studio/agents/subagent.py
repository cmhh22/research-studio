"""Subagent: runs an agent loop to investigate a single subquestion."""

import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any
from uuid import UUID

from research_studio.config import settings
from research_studio.events import EventType, RuntimeEvent
from research_studio.llm import chat
from research_studio.tools import TOOL_REGISTRY, TOOL_SCHEMAS

logger = logging.getLogger(__name__)

EmitFn = Callable[[RuntimeEvent], Awaitable[None]]


SUBAGENT_SYSTEM_PROMPT = """You are a research subagent investigating ONE specific \
subquestion. You have two tools:
- `web_search(query)`: returns search results (title, URL, snippet).
- `web_fetch(url)`: returns the full text of a page.

Follow this exact procedure:
1. Call web_search once for the subquestion.
2. Look at the returned URLs. Immediately call web_fetch on the single most \
relevant URL to read it in full. This step is REQUIRED — do not skip it.
3. If that fetch returns an error (403, empty, etc.), call web_fetch on the NEXT \
most relevant URL. Try up to 2-3 different URLs before giving up on fetching.
4. Write your findings using BOTH the fetched content (preferred) and the search \
snippets (as backup). Your findings must:
    - Directly answer the subquestion
    - Cite the specific source URLs you actually used, inline
    - Be honest if you could only rely on snippets because fetches failed
5. Keep the final answer under 350 words.

Important: you have a limited number of tool calls. Do not search repeatedly \
without fetching — search once, then fetch. End the turn with your findings text."""


class Subagent:
    def __init__(
        self,
        sub_id: str,
        question: str,
        session_id: UUID,
        emit: EmitFn,
    ) -> None:
        self.sub_id = sub_id
        self.question = question
        self.session_id = session_id
        self.emit = emit
        self.messages: list[dict[str, Any]] = [
            {"role": "system", "content": SUBAGENT_SYSTEM_PROMPT},
            {"role": "user", "content": f"Subquestion: {question}"},
        ]

    async def run(self) -> str:
        """Run the agent loop. Returns the final findings text."""
        await self.emit(
            RuntimeEvent(
                type=EventType.SUBAGENT_STARTED,
                session_id=self.session_id,
                payload={"subagent": self.sub_id, "question": self.question},
            )
        )

        for _ in range(settings.max_subagent_iterations):
            response = await chat(messages=self.messages, tools=TOOL_SCHEMAS)
            msg = response.choices[0].message

            # If the model emitted reasoning text alongside (or instead of) tool calls,
            # surface it as a thought event.
            if msg.content:
                await self.emit(
                    RuntimeEvent(
                        type=EventType.SUBAGENT_THOUGHT,
                        session_id=self.session_id,
                        payload={"subagent": self.sub_id, "text": msg.content},
                    )
                )

            # Append assistant message (preserving tool_calls if present)
            self.messages.append(msg.model_dump(exclude_none=True))

            # No tool calls -> we have the final answer
            if not msg.tool_calls:
                findings = msg.content or "(no findings returned)"
                await self.emit(
                    RuntimeEvent(
                        type=EventType.SUBAGENT_FINISHED,
                        session_id=self.session_id,
                        payload={"subagent": self.sub_id, "findings": findings},
                    )
                )
                return findings

            # Execute each tool call
            for tool_call in msg.tool_calls:
                tool_name = tool_call.function.name
                try:
                    tool_args = json.loads(tool_call.function.arguments)
                except json.JSONDecodeError:
                    tool_args = {}

                await self.emit(
                    RuntimeEvent(
                        type=EventType.SUBAGENT_TOOL_CALL,
                        session_id=self.session_id,
                        payload={
                            "subagent": self.sub_id,
                            "tool": tool_name,
                            "input": tool_args,
                        },
                    )
                )

                fn = TOOL_REGISTRY.get(tool_name)
                if fn is None:
                    result: object = {"error": f"Unknown tool: {tool_name}"}
                else:
                    try:
                        result = await fn(**tool_args)
                    except Exception as exc:
                        logger.exception("Tool %s failed", tool_name)
                        result = {"error": str(exc)}

                await self.emit(
                    RuntimeEvent(
                        type=EventType.SUBAGENT_TOOL_RESULT,
                        session_id=self.session_id,
                        payload={
                            "subagent": self.sub_id,
                            "tool": tool_name,
                            "result_preview": str(result)[:300],
                        },
                    )
                )

                # Append the tool result so the next LLM iteration sees it
                self.messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": json.dumps(result),
                    }
                )

        # Iteration limit hit without a final answer
        findings = "(max iterations reached — investigation truncated)"
        await self.emit(
            RuntimeEvent(
                type=EventType.SUBAGENT_FINISHED,
                session_id=self.session_id,
                payload={
                    "subagent": self.sub_id,
                    "findings": findings,
                    "truncated": True,
                },
            )
        )
        return findings
