# Research Studio — Fix: síntesis a prueba de fallos + empujar web_fetch

> **Para Codex**: la última corrida tuvo 2 subagentes OK pero la síntesis falló
> (`error: 1`, sin `report.ready`). No tenemos el texto exacto del error, así
> que este fix es defensivo: hace que el sistema SIEMPRE emita `report.ready`
> (con reporte degradado si la síntesis LLM falla), mejora el logging para
> capturar la causa real, y empuja al subagente a usar `web_fetch`.
> Cambios en `synthesizer.py`, `orchestrator.py` y `subagent.py`.

---

## 1. Diagnóstico

De la última corrida (`run_events.jsonl`):
- 2 subagentes corrieron y terminaron OK (`subagent.finished: 2`)
- 6 búsquedas, 0 errores de tool, 0 usos de `web_fetch`
- 1 evento `error` y NINGÚN `report.ready`

Como los subagentes terminaron bien, el fallo está en la etapa de síntesis.
Causas probables: (a) `gpt-4o-mini` devuelve JSON que no parsea, o (b) rate
limit de GitHub Models en la llamada de síntesis (se gastó el cupo por minuto
con las ~7 llamadas previas). Este fix cubre ambas.

---

## 2. Paso 1 — Synthesizer a prueba de fallos

Reemplazá el contenido completo de
`backend/src/research_studio/agents/synthesizer.py`:

```python
"""Synthesizer: combines subagent findings into a structured report.

Design rule: this NEVER raises. If the LLM call or JSON parsing fails for any
reason, it returns a fallback report assembled directly from the findings, so
the orchestrator can always emit report.ready.

Return shape: {"summary": "<markdown>", "citations": [ {...}, ... ]}
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

    # Strip code fences if present (tolerant of odd fence counts)
    if "```" in content:
        parts = content.split("```")
        # take the largest chunk that looks like JSON
        candidates = [p[4:] if p.startswith("json") else p for p in parts]
        content = max(candidates, key=len).strip()

    data = json.loads(content)  # may raise -> caught by synthesize_report
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
    """Assemble a report directly from findings — no LLM call. Always works."""
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

## 3. Paso 2 — Orchestrator: pausa antes de sintetizar + siempre emitir report

Editá `backend/src/research_studio/agents/orchestrator.py`. Necesitás:
`import asyncio` (probablemente ya está).

En `Orchestrator.run`, reemplazá la sección de síntesis (el bloque que llama
`synthesize_report` y emite `report.ready` / `error`) por:

```python
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
```

Resultado: el sistema SIEMPRE termina en `report.ready`. La etapa de síntesis
ya no puede producir un evento `error` que deje la corrida sin reporte.

---

## 4. Paso 3 — Empujar web_fetch en el subagente

Editá `backend/src/research_studio/agents/subagent.py`. Reemplazá
`SUBAGENT_SYSTEM_PROMPT` por:

```python
SUBAGENT_SYSTEM_PROMPT = """You are a research subagent investigating ONE specific \
subquestion. You have two tools:
- `web_search(query)`: returns search results (title, URL, snippet). For DISCOVERY.
- `web_fetch(url)`: returns the full text of a page. For READING a source in depth.

Required process — follow it:
1. Run a web_search for the subquestion.
2. From the results, pick the 1-2 most relevant URLs and call web_fetch on them. \
You MUST read at least one full source with web_fetch before concluding — search \
snippets alone are not enough for a good answer.
3. If the fetched content is thin or off-topic, search again with a refined query \
and fetch a better source.
4. Once you have real evidence from fetched pages, write a findings summary that:
   - Directly answers the subquestion
   - Cites sources by URL inline (e.g. "According to [example.com/x], ...")
   - Notes uncertainty where relevant
5. Keep the final answer under 350 words.

Do not call tools once you have enough evidence. End the turn with your findings text."""
```

Nota: con `gpt-4o-mini` el modelo puede igual saltearse `web_fetch` a veces.
Si después de este cambio el SUMMARY sigue mostrando `web_fetch: 0`, lo
forzamos por código (obligar al menos un fetch antes de permitir terminar),
pero probemos primero con el prompt.

---

## 5. Probar

Con el backend corriendo, corré de nuevo el harness:
```bash
cd backend
.\.venv\Scripts\Activate.ps1
python run_capture.py
```

Esperado ahora:
- El SUMMARY termina con `report.ready: 1` (ya no `error: 1` en síntesis)
- `web_fetch` con un número > 0
- Se genera `backend/run_report.json`
- En el log del backend, SI la síntesis LLM falló, vas a ver un warning
  `LLM synthesis failed (...)` con la causa exacta — pero la corrida igual
  completa con el reporte fallback.

---

## 6. Criterios de aceptación

- [ ] Toda corrida termina en `report.ready`, nunca en `error` por síntesis
- [ ] `run_report.json` se genera siempre
- [ ] Si la síntesis LLM falla, el log muestra la causa exacta (warning con tipo y mensaje) y se usa el reporte fallback
- [ ] El SUMMARY muestra `web_fetch` > 0 en una corrida típica
- [ ] `report.ready` siempre lleva `summary` (no vacío) y `citations` (array, puede estar vacío)

---

## 7. Qué reportar de vuelta

1. El bloque SUMMARY completo de la nueva corrida.
2. El contenido de `run_report.json`.
3. Si en el log del backend apareció el warning `LLM synthesis failed (...)`,
   pegá esa línea — me dice si la causa fue JSON o rate limit, para el ajuste
   fino. Si NO apareció, significa que la síntesis LLM funcionó bien esta vez.
