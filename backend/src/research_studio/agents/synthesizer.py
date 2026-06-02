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

_URL_RE = re.compile(r'https?://[^\s\)\]\>\"\'}]+')


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

    data = json.loads(content)  # may raise -> caught by synthesize_report
    summary = str(data.get("summary", "")).strip()
    if not summary:
        raise ValueError("Parsed JSON had empty summary")

    citations = data.get("citations", [])
    if not isinstance(citations, list):
        citations = []
    clean = [c for c in citations if isinstance(c, dict) and c.get("url") and c.get("title")]
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
