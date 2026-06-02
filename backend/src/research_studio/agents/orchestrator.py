"""Orchestrator: decomposes the user question, runs subagents in parallel,
and triggers synthesis."""

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from uuid import UUID

from research_studio.agents.subagent import Subagent
from research_studio.agents.synthesizer import synthesize_report
from research_studio.config import settings
from research_studio.events import EventType, RuntimeEvent
from research_studio.llm import chat

logger = logging.getLogger(__name__)

EmitFn = Callable[[RuntimeEvent], Awaitable[None]]


DECOMPOSITION_SYSTEM_PROMPT = """You are a research planner. Given a user's research \
question, break it into 2-4 distinct subquestions that together would let a thorough \
investigation answer the original question.

Each subquestion should:
- Be answerable with web search
- Cover a distinct angle (causes, effects, history, current state, key evidence, etc.)
- Be specific enough to search for

Return ONLY a JSON object of the form:
  {"subquestions": ["...", "...", "..."]}

Do not include any other text, no commentary, no code fences."""


class Orchestrator:
    def __init__(self, session_id: UUID, emit: EmitFn) -> None:
        self.session_id = session_id
        self.emit = emit

    async def run(self, question: str) -> None:
        """Full research run: decompose, dispatch subagents, synthesize."""
        await self.emit(
            RuntimeEvent(
                type=EventType.SESSION_STARTED,
                session_id=self.session_id,
                payload={"query": question},
            )
        )

        # 1. Decompose
        try:
            subquestions = await self._decompose(question)
        except Exception as exc:
            logger.exception("Decomposition failed")
            await self.emit(
                RuntimeEvent(
                    type=EventType.ERROR,
                    session_id=self.session_id,
                    payload={"stage": "decomposition", "error": str(exc)},
                )
            )
            return

        await self.emit(
            RuntimeEvent(
                type=EventType.PLAN_CREATED,
                session_id=self.session_id,
                payload={"subquestions": subquestions},
            )
        )

        # 2. Run subagents in parallel
        subagents = [
            Subagent(
                sub_id=f"sub-{i + 1}",
                question=sub_q,
                session_id=self.session_id,
                emit=self.emit,
            )
            for i, sub_q in enumerate(subquestions)
        ]

        results = await asyncio.gather(
            *(sa.run() for sa in subagents),
            return_exceptions=True,
        )

        # Collect findings; subagent failures are recorded but don't kill the run
        findings: list[dict] = []
        for sa, result in zip(subagents, results, strict=True):
            if isinstance(result, Exception):
                logger.exception("Subagent %s crashed", sa.sub_id, exc_info=result)
                findings.append(
                    {"subquestion": sa.question, "findings": f"(failed: {result})"}
                )
            else:
                findings.append({"subquestion": sa.question, "findings": result})

        # 3. Synthesize. Small pause first to let per-minute rate limits
        #    recover after the burst of subagent calls.
        await asyncio.sleep(2)

        # synthesize_report never raises; it falls back internally. The
        # try/except here is belt-and-suspenders.
        try:
            report_data = await synthesize_report(question, findings)
        except Exception as exc:
            logger.exception("Synthesis fell through to orchestrator catch")
            from research_studio.agents.synthesizer import build_fallback_report

            report_data = build_fallback_report(question, findings)

        await self.emit(
            RuntimeEvent(
                type=EventType.REPORT_READY,
                session_id=self.session_id,
                payload={
                    "summary": report_data["summary"],
                    "citations": report_data["citations"],
                    "findings": findings,
                },
            )
        )

    async def _decompose(self, question: str) -> list[str]:
        """Ask the LLM to break the question into subquestions. Returns 2-4 strings."""
        response = await chat(
            messages=[
                {"role": "system", "content": DECOMPOSITION_SYSTEM_PROMPT},
                {"role": "user", "content": question},
            ],
            temperature=0.3,
        )
        content = (response.choices[0].message.content or "").strip()

        # Robust JSON parsing — strip ```json``` fences if present
        if content.startswith("```"):
            content = content.split("```", 2)[1]
            if content.startswith("json"):
                content = content[4:]
            content = content.strip()

        data = json.loads(content)
        subquestions = data.get("subquestions", [])
        if not isinstance(subquestions, list) or not subquestions:
            raise ValueError(f"Bad decomposition response: {content[:200]}")
        return [str(q) for q in subquestions[: settings.max_subquestions]]
