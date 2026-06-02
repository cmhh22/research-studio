# Research Studio — Recuperación canónica del backend COMPLETO

> **PARA CODEX — LEÉ ESTO PRIMERO:**
> Este documento contiene el contenido COMPLETO y CORRECTO de cada archivo del
> backend. Tu tarea es simple y mecánica: **escribí cada archivo EXACTAMENTE
> como está acá**, sobreescribiendo lo que exista. NADA de improvisar.
>
> Reglas estrictas:
> - NO crees stubs, mocks, "deterministic LLM", ni placeholders de ningún tipo.
> - NO inventes contenido para archivos "que parecen faltar" — el contenido de
>   TODOS los archivos está acá abajo.
> - NO modifiques la lógica. Transcribí literal.
> - Si un archivo ya existe, sobreescribilo con la versión de acá.
> - Al final hay un test real. Si falla, reportá el error TAL CUAL, no lo
>   "arregles" reemplazando módulos.

El proyecto está en `research-studio/backend/`. El paquete Python está en
`research-studio/backend/src/research_studio/`.

---

## PASO 0 — Higiene de git (sacar el .env del tracking)

El `.env` quedó trackeado en git con un token adentro. Sacalo (el archivo se
queda en disco, solo deja de estar versionado):

```powershell
cd "D:\CIBER !!!!\Estudio\CURSOS\Udemy - AI Mastery 150+ Projects, AI Algorithms, DeepSeek AI Agents 2025-3\Portafolio\research-studio"
git rm --cached backend/.env
```

Asegurate de que exista `research-studio/.gitignore` con este contenido
(crealo o completalo):

```
# Python
.venv/
__pycache__/
*.pyc
*.egg-info/
.pytest_cache/
.ruff_cache/

# Env / secrets
.env
backend/.env

# Run artifacts
run_events.jsonl
run_report.json
```

---

## PASO 1 — `backend/pyproject.toml`

```toml
[project]
name = "research-studio"
version = "0.2.0"
description = "Multi-agent research studio backend"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.32",
    "pydantic>=2.9",
    "pydantic-settings>=2.6",
    "python-dotenv>=1.0",
    "openai>=1.54",
    "duckduckgo-search>=6.3",
    "trafilatura>=1.12",
    "httpx>=0.27",
    "tenacity>=9.0",
]

[project.optional-dependencies]
dev = [
    "ruff>=0.7",
    "pytest>=8.3",
    "pytest-asyncio>=0.24",
    "websockets>=13.0",
]

[tool.setuptools.packages.find]
where = ["src"]

[build-system]
requires = ["setuptools>=61"]
build-backend = "setuptools.build_meta"

[tool.ruff]
line-length = 100
target-version = "py311"

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP"]
```

---

## PASO 2 — `backend/src/research_studio/__init__.py`

```python
"""Research Studio - multi-agent research backend."""

__version__ = "0.2.0"
```

---

## PASO 3 — `backend/src/research_studio/config.py`

```python
"""Application configuration, populated from environment variables and .env."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # --- Primary LLM provider (does the work) ---
    primary_base_url: str = "https://models.github.ai/inference"
    primary_api_key: str = ""
    primary_model: str = "openai/gpt-4o-mini"

    # --- Fallback provider (only used if primary fails) ---
    # Leave fallback_api_key empty to disable fallback entirely.
    fallback_base_url: str = "https://api.deepseek.com"
    fallback_api_key: str = ""
    fallback_model: str = "deepseek-chat"

    request_timeout_seconds: float = 45.0

    max_subagent_iterations: int = 3
    max_subquestions: int = 2

    cors_origins: list[str] = ["http://localhost:4200"]

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
```

---

## PASO 4 — `backend/src/research_studio/events.py`

```python
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
```

---

## PASO 5 — `backend/src/research_studio/llm.py`

```python
"""Multi-provider LLM client (any OpenAI-compatible endpoint).

Tries the primary provider first, then the fallback (different endpoint + key
+ model). The OpenAI SDK's own retries are disabled; we control retry. Within
a provider we retry only transient connection/timeout errors. On rate limit
(429) or any hard error we move to the next provider. If all fail, we raise a
clear error (no long hang).
"""

import logging
from dataclasses import dataclass
from typing import Any

import openai
from openai import AsyncOpenAI
from openai.types.chat import ChatCompletion, ChatCompletionMessageParam
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from research_studio.config import settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Provider:
    base_url: str
    api_key: str
    model: str


_clients: dict[str, AsyncOpenAI] = {}


def _client_for(provider: Provider) -> AsyncOpenAI:
    if provider.base_url not in _clients:
        _clients[provider.base_url] = AsyncOpenAI(
            base_url=provider.base_url,
            api_key=provider.api_key,
            timeout=settings.request_timeout_seconds,
            max_retries=0,
        )
    return _clients[provider.base_url]


def _providers() -> list[Provider]:
    if not settings.primary_api_key:
        raise RuntimeError("PRIMARY_API_KEY is not set. Add it to backend/.env.")
    providers = [
        Provider(
            settings.primary_base_url,
            settings.primary_api_key,
            settings.primary_model,
        )
    ]
    if settings.fallback_api_key:
        providers.append(
            Provider(
                settings.fallback_base_url,
                settings.fallback_api_key,
                settings.fallback_model,
            )
        )
    return providers


@retry(
    stop=stop_after_attempt(2),
    wait=wait_exponential(multiplier=1, min=1, max=4),
    retry=retry_if_exception_type(
        (openai.APIConnectionError, openai.APITimeoutError)
    ),
    reraise=True,
)
async def _chat_attempt(
    provider: Provider,
    messages: list[ChatCompletionMessageParam],
    tools: list[dict] | None,
    temperature: float,
) -> ChatCompletion:
    client = _client_for(provider)
    kwargs: dict[str, Any] = {
        "model": provider.model,
        "messages": messages,
        "temperature": temperature,
    }
    if tools:
        kwargs["tools"] = tools
        kwargs["tool_choice"] = "auto"
    return await client.chat.completions.create(**kwargs)


async def chat(
    messages: list[ChatCompletionMessageParam],
    tools: list[dict] | None = None,
    temperature: float = 0.4,
) -> ChatCompletion:
    """Try each configured provider in order; return the first success."""
    last_exc: Exception | None = None
    for provider in _providers():
        try:
            return await _chat_attempt(provider, messages, tools, temperature)
        except openai.RateLimitError as exc:
            last_exc = exc
            logger.warning(
                "Provider %s rate-limited (429); trying next provider",
                provider.base_url,
            )
        except Exception as exc:
            last_exc = exc
            logger.warning(
                "Provider %s failed (%s: %s); trying next provider",
                provider.base_url,
                type(exc).__name__,
                exc,
            )
    raise RuntimeError(
        f"All configured LLM providers failed or are rate-limited. Last error: {last_exc}"
    ) from last_exc
```

---

## PASO 6 — `backend/src/research_studio/tools/web_fetch.py`

```python
"""Web fetch tool — given a URL, returns the page's main content as text."""

import asyncio
import json as _json
from typing import Any

import httpx
import trafilatura

MAX_CONTENT_CHARS = 5000

WEB_FETCH_SCHEMA: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "web_fetch",
        "description": (
            "Fetch the full content of a web page given its URL. Use this AFTER "
            "web_search to read the full text of a promising result. Returns the "
            "page title and extracted main content (up to ~5000 characters)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "Full URL to fetch. Must start with http:// or https://.",
                }
            },
            "required": ["url"],
        },
    },
}


async def run_web_fetch(url: str) -> dict[str, Any]:
    if not url.startswith(("http://", "https://")):
        return {"error": f"Invalid URL (must start with http/https): {url}"}

    try:
        async with httpx.AsyncClient(
            timeout=15.0,
            headers={"User-Agent": "ResearchStudio/0.2"},
            follow_redirects=True,
        ) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            html = resp.text
    except httpx.HTTPError as exc:
        return {"error": f"Failed to fetch {url}: {exc}"}

    def _extract() -> dict | None:
        raw = trafilatura.extract(
            html,
            output_format="json",
            with_metadata=True,
            include_comments=False,
            include_tables=True,
        )
        if not raw:
            return None
        try:
            return _json.loads(raw)
        except _json.JSONDecodeError:
            return None

    extracted = await asyncio.to_thread(_extract)
    if not extracted:
        return {"error": f"Could not extract readable content from {url}"}

    text = (extracted.get("text") or "").strip()
    if not text:
        return {"error": f"Page returned empty content: {url}"}

    truncated = len(text) > MAX_CONTENT_CHARS
    if truncated:
        text = text[:MAX_CONTENT_CHARS] + "\n\n[...content truncated]"

    return {
        "url": url,
        "title": (extracted.get("title") or "").strip(),
        "content": text,
        "length": len(text),
        "truncated": truncated,
    }
```

---

## PASO 7 — `backend/src/research_studio/tools/web_search.py`

```python
"""Web search tool using DuckDuckGo (no API key required)."""

import asyncio
from typing import Any

from duckduckgo_search import DDGS

WEB_SEARCH_SCHEMA: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "web_search",
        "description": (
            "Search the web for relevant information about a query. Returns up "
            "to 5 results with title, URL, and snippet. Use to DISCOVER sources."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query. Be specific and keyword-driven.",
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum number of results (1-5).",
                    "minimum": 1,
                    "maximum": 5,
                    "default": 5,
                },
            },
            "required": ["query"],
        },
    },
}


async def run_web_search(query: str, max_results: int = 5) -> list[dict[str, str]]:
    def _search_sync() -> list[dict[str, str]]:
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=max_results))
        return [
            {
                "title": r.get("title", ""),
                "url": r.get("href", ""),
                "snippet": r.get("body", ""),
            }
            for r in results
        ]

    return await asyncio.to_thread(_search_sync)
```

---

## PASO 8 — `backend/src/research_studio/tools/__init__.py`

```python
"""Tool registry: maps tool names to coroutines and exposes their schemas."""

from research_studio.tools.web_fetch import WEB_FETCH_SCHEMA, run_web_fetch
from research_studio.tools.web_search import WEB_SEARCH_SCHEMA, run_web_search

TOOL_REGISTRY = {
    "web_search": run_web_search,
    "web_fetch": run_web_fetch,
}

TOOL_SCHEMAS = [WEB_SEARCH_SCHEMA, WEB_FETCH_SCHEMA]
```

---

## PASO 9 — `backend/src/research_studio/agents/__init__.py`

```python
"""Agent runtime package."""
```

---

## PASO 10 — `backend/src/research_studio/agents/subagent.py`

```python
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
- `web_search(query)`: returns search results (title, URL, snippet). For DISCOVERY.
- `web_fetch(url)`: returns the full text of a page. For READING a source in depth.

Required process — follow it:
1. Run a web_search for the subquestion.
2. From the results, pick the 1-2 most relevant URLs and call web_fetch on them. \
You MUST read at least one full source with web_fetch before concluding — search \
snippets alone are not enough.
3. If fetched content is thin or off-topic, search again with a refined query and \
fetch a better source.
4. Once you have real evidence, write a findings summary that:
   - Directly answers the subquestion
   - Cites sources by URL inline (e.g. "According to [example.com/x], ...")
   - Notes uncertainty where relevant
5. Keep the final answer under 350 words.

Do not call tools once you have enough evidence. End the turn with your findings text."""


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

            if msg.content:
                await self.emit(
                    RuntimeEvent(
                        type=EventType.SUBAGENT_THOUGHT,
                        session_id=self.session_id,
                        payload={"subagent": self.sub_id, "text": msg.content},
                    )
                )

            self.messages.append(msg.model_dump(exclude_none=True))

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

                self.messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": json.dumps(result),
                    }
                )

        findings = "(max iterations reached — investigation truncated)"
        await self.emit(
            RuntimeEvent(
                type=EventType.SUBAGENT_FINISHED,
                session_id=self.session_id,
                payload={"subagent": self.sub_id, "findings": findings, "truncated": True},
            )
        )
        return findings
```

---

## PASO 11 — `backend/src/research_studio/agents/synthesizer.py`

```python
"""Synthesizer: combines subagent findings into a structured report.

Design rule: NEVER raises. If the LLM call or JSON parsing fails, returns a
fallback report assembled directly from the findings.
"""

import json
import logging
import re
from typing import Any

from research_studio.llm import chat

logger = logging.getLogger(__name__)

_URL_RE = re.compile(r'https?://[^\s\)\]\>"\'}]+')

SYNTHESIS_SYSTEM_PROMPT = """You are a research synthesizer. You receive the user's \
original question and a list of subquestions with the findings each subagent produced.

Produce a JSON object with this EXACT shape (no extra keys):

{
  "summary": "<markdown string>",
  "citations": [
    {"id": "c1", "title": "...", "url": "...", "authors": "...", "year": "...", "venue": "..."}
  ]
}

Rules for summary (markdown):
- Open with a direct answer to the original question
- One section per subquestion (## headings)
- Reference citations inline as <sup><a href="#c1">[1]</a></sup>
- Close with a short "Caveats" section
- Under 600 words

Rules for citations:
- Extract every distinct URL from the findings; assign ids c1, c2, ...
- title and url required; authors/year/venue optional
- Empty array if no URLs

Return ONLY the JSON object. No code fences, no commentary."""


async def synthesize_report(question: str, findings: list[dict]) -> dict[str, Any]:
    """Produce a structured report. NEVER raises — falls back on any failure."""
    try:
        return await _synthesize_with_llm(question, findings)
    except Exception as exc:
        logger.warning(
            "LLM synthesis failed (%s: %s); using fallback report",
            type(exc).__name__,
            exc,
        )
        return build_fallback_report(question, findings)


async def _synthesize_with_llm(question: str, findings: list[dict]) -> dict[str, Any]:
    findings_block = "\n\n".join(
        f"### Subquestion: {f.get('subquestion', '?')}\n\n{f.get('findings', '')}"
        for f in findings
    )
    user_msg = f"Original question: {question}\n\nSubagent findings:\n\n{findings_block}"

    response = await chat(
        messages=[
            {"role": "system", "content": SYNTHESIS_SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        temperature=0.4,
    )
    content = (response.choices[0].message.content or "").strip()

    if "```" in content:
        parts = content.split("```")
        candidates = [p[4:] if p.startswith("json") else p for p in parts]
        content = max(candidates, key=len).strip()

    data = json.loads(content)
    summary = str(data.get("summary", "")).strip()
    if not summary:
        raise ValueError("Parsed JSON had empty summary")

    citations = data.get("citations", [])
    if not isinstance(citations, list):
        citations = []
    clean = [
        c for c in citations
        if isinstance(c, dict) and c.get("url") and c.get("title")
    ]
    return {"summary": summary, "citations": clean}


def build_fallback_report(question: str, findings: list[dict]) -> dict[str, Any]:
    lines = [f"# Research summary\n\n**Question:** {question}\n"]
    citations: list[dict] = []
    seen: set[str] = set()
    cid = 0

    for f in findings:
        subq = f.get("subquestion", "Subquestion")
        text = f.get("findings", "") or ""
        lines.append(f"\n## {subq}\n")
        lines.append(text)
        for url in _URL_RE.findall(text):
            if url not in seen:
                seen.add(url)
                cid += 1
                citations.append({"id": f"c{cid}", "title": url, "url": url})

    lines.append(
        "\n\n_Note: this report was assembled directly from subagent findings "
        "because LLM synthesis was unavailable for this run._"
    )
    return {"summary": "\n".join(lines), "citations": citations}
```

---

## PASO 12 — `backend/src/research_studio/agents/orchestrator.py`

```python
"""Orchestrator: decomposes the question, runs subagents in parallel, synthesizes."""

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from uuid import UUID

from research_studio.agents.subagent import Subagent
from research_studio.agents.synthesizer import build_fallback_report, synthesize_report
from research_studio.config import settings
from research_studio.events import EventType, RuntimeEvent
from research_studio.llm import chat

logger = logging.getLogger(__name__)

EmitFn = Callable[[RuntimeEvent], Awaitable[None]]

DECOMPOSITION_SYSTEM_PROMPT = """You are a research planner. Given a user's research \
question, break it into 2-4 distinct subquestions that together would let a thorough \
investigation answer the original question.

Each subquestion should be answerable with web search, cover a distinct angle, and be \
specific enough to search for.

Return ONLY a JSON object of the form:
  {"subquestions": ["...", "...", "..."]}

No other text, no code fences."""


class Orchestrator:
    def __init__(self, session_id: UUID, emit: EmitFn) -> None:
        self.session_id = session_id
        self.emit = emit

    async def run(self, question: str) -> None:
        await self.emit(
            RuntimeEvent(
                type=EventType.SESSION_STARTED,
                session_id=self.session_id,
                payload={"query": question},
            )
        )

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

        subagents = [
            Subagent(
                sub_id=f"sub-{i + 1:02d}",
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

        findings: list[dict] = []
        for sa, result in zip(subagents, results, strict=True):
            if isinstance(result, Exception):
                logger.exception("Subagent %s crashed", sa.sub_id, exc_info=result)
                findings.append({"subquestion": sa.question, "findings": f"(failed: {result})"})
            else:
                findings.append({"subquestion": sa.question, "findings": result})

        # Small pause to let per-minute rate limits recover after the burst.
        await asyncio.sleep(2)

        # synthesize_report never raises; the try/except is belt-and-suspenders.
        try:
            report_data = await synthesize_report(question, findings)
        except Exception:
            logger.exception("Synthesis fell through to orchestrator catch")
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
        response = await chat(
            messages=[
                {"role": "system", "content": DECOMPOSITION_SYSTEM_PROMPT},
                {"role": "user", "content": question},
            ],
            temperature=0.3,
        )
        content = (response.choices[0].message.content or "").strip()

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
```

---

## PASO 13 — `backend/src/research_studio/main.py`

```python
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
```

---

## PASO 14 — `backend/.env.example`

```
# === Proveedor PRIMARIO ===
# GitHub Models — gratis, accesible desde Cuba.
PRIMARY_BASE_URL=https://models.github.ai/inference
PRIMARY_API_KEY=github_pat_tu_token_aca
PRIMARY_MODEL=openai/gpt-4o-mini

# === Proveedor FALLBACK (opcional — dejar vacio para deshabilitar) ===
FALLBACK_BASE_URL=
FALLBACK_API_KEY=
FALLBACK_MODEL=
```

> NOTA: NO toques el `backend/.env` real del usuario (tiene su token). Solo
> actualizá `.env.example`. Si el `.env` no tiene las variables `PRIMARY_*`,
> avisá al usuario que las complete; no las inventes.

---

## PASO 15 — `backend/run_capture.py`

```python
"""CLI test harness: connects to the running backend, sends a question,
prints the full event stream, and saves it to disk.

Usage (backend must be running on port 8000):
    python run_capture.py
    python run_capture.py "Your custom question"
"""

import asyncio
import json
import sys
from collections import Counter
from uuid import uuid4

import websockets

BACKEND_WS = "ws://127.0.0.1:8000/ws/research"
DEFAULT_QUESTION = (
    "What are the main effects of microplastic pollution on marine ecosystems?"
)
EVENTS_FILE = "run_events.jsonl"
REPORT_FILE = "run_report.json"


async def capture(question: str) -> None:
    session_id = str(uuid4())
    url = f"{BACKEND_WS}/{session_id}"
    print(f"Connecting to {url}\nQuestion: {question}\n")

    events: list[dict] = []
    report_payload: dict | None = None

    async with websockets.connect(url, max_size=None) as ws:
        await ws.send(json.dumps({"question": question}))
        while True:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=120)
            except asyncio.TimeoutError:
                print("\n[timeout] no event for 120s — stopping.")
                break
            try:
                event = json.loads(raw)
            except json.JSONDecodeError:
                print(f"[non-JSON frame] {raw!r}")
                continue

            events.append(event)
            _print_event(event)

            if event.get("type") == "report.ready":
                report_payload = event.get("payload", {})
                break
            if event.get("type") == "error":
                print("\n[error event — stopping]")
                break

    _save(events, report_payload)
    _summary(events)


def _print_event(event: dict) -> None:
    etype = event.get("type", "?")
    ts = event.get("timestamp", "")
    short_ts = ts[11:19] if len(ts) >= 19 else ts
    print(f"[{short_ts}] {etype}")
    for line in json.dumps(event.get("payload", {}), indent=2, ensure_ascii=False).splitlines():
        print(f"    {line}")
    print()


def _save(events: list[dict], report_payload: dict | None) -> None:
    with open(EVENTS_FILE, "w", encoding="utf-8") as f:
        for ev in events:
            f.write(json.dumps(ev, ensure_ascii=False) + "\n")
    print(f"\nSaved {len(events)} events to {EVENTS_FILE}")
    if report_payload is not None:
        with open(REPORT_FILE, "w", encoding="utf-8") as f:
            json.dump(report_payload, f, indent=2, ensure_ascii=False)
        print(f"Saved report payload to {REPORT_FILE}")
    else:
        print("No report.ready captured (run did not complete).")


def _summary(events: list[dict]) -> None:
    print("\n" + "=" * 50 + "\nSUMMARY\n" + "=" * 50)
    for etype, n in Counter(e.get("type") for e in events).items():
        print(f"  {etype}: {n}")
    subagents = {
        e["payload"].get("subagent")
        for e in events
        if isinstance(e.get("payload"), dict) and e["payload"].get("subagent")
    }
    print(f"\n  Subagents that ran: {len(subagents)} -> {sorted(subagents)}")
    tool_calls = Counter(
        e["payload"].get("tool")
        for e in events
        if e.get("type") == "subagent.tool_call" and isinstance(e.get("payload"), dict)
    )
    print(f"  Tool calls: {dict(tool_calls) if tool_calls else 'none'}")
    report = next((e["payload"] for e in events if e.get("type") == "report.ready"), None)
    if report:
        print(f"  Citations in report: {len(report.get('citations', []))}")
    print("=" * 50)


if __name__ == "__main__":
    q = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_QUESTION
    asyncio.run(capture(q))
```

---

## PASO 16 — Validar e instalar

```powershell
cd "D:\CIBER !!!!\Estudio\CURSOS\Udemy - AI Mastery 150+ Projects, AI Algorithms, DeepSeek AI Agents 2025-3\Portafolio\research-studio\backend"
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
```

Verificá que el `.env` real tenga `PRIMARY_API_KEY` con el token de GitHub del
usuario. Si NO está, NO inventes uno — avisá al usuario que lo complete.

---

## PASO 17 — Test real (NO uses stubs)

Terminal 1 — backend:
```powershell
cd backend
.\.venv\Scripts\Activate.ps1
$env:PYTHONPATH='src'
python -m uvicorn research_studio.main:app --host 127.0.0.1 --port 8000
```

Terminal 2 — harness:
```powershell
cd backend
.\.venv\Scripts\Activate.ps1
python run_capture.py
```

**El test usa la API REAL (GitHub Models). Si falla con un error de red, rate
limit, o de la API, reportá ese error EXACTAMENTE como aparece. NO reemplaces
`llm.py` ni ningún módulo por una versión "determinista" o mock. El objetivo es
ver el comportamiento real, no hacer que el test pase a la fuerza.**

---

## PASO 18 — Commit del estado recuperado

```powershell
cd "D:\CIBER !!!!\Estudio\CURSOS\Udemy - AI Mastery 150+ Projects, AI Algorithms, DeepSeek AI Agents 2025-3\Portafolio\research-studio"
git add -A
git commit -m "recover canonical backend (real LLM, multi-provider, web_fetch, safe synthesis)"
```

---

## Qué reportar de vuelta al usuario

1. La salida del `pip install` (que haya instalado sin errores).
2. El bloque SUMMARY completo del `run_capture.py`.
3. El contenido de `run_report.json`.
4. Si en el log de uvicorn apareció algún `WARNING` (rate limit, fallback,
   o `LLM synthesis failed`), la línea exacta.
5. Confirmación de que `git log --oneline` muestra los commits nuevos.

NO declares éxito si tuviste que reemplazar algún módulo por un stub. Si algo
no anda con la API real, reportá el error y dejá que el usuario decida.
