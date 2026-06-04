"""Web search tool using the ddgs library (no API key required)."""

import asyncio
from typing import Any

from ddgs import DDGS

WEB_SEARCH_SCHEMA: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "web_search",
        "description": (
            "Search the web for relevant information about a query. Returns up "
            "to 6 results with title, URL, and snippet. Use to DISCOVER sources."
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
                    "description": "Maximum number of results (1-6).",
                    "minimum": 1,
                    "maximum": 6,
                    "default": 6,
                },
            },
            "required": ["query"],
        },
    },
}


async def run_web_search(query: str, max_results: int = 6) -> list[dict[str, str]]:
    def _search_sync() -> list[dict[str, str]]:
        with DDGS() as ddgs:
            # ddgs.text may accept positional or keyword args depending on version
            try:
                results = list(ddgs.text(query, max_results=max_results))
            except TypeError:
                results = list(ddgs.text(query=query, max_results=max_results))
        out: list[dict[str, str]] = []
        for r in results:
            out.append(
                {
                    "title": r.get("title", ""),
                    "url": r.get("href") or r.get("url", ""),
                    "snippet": r.get("body") or r.get("snippet", ""),
                }
            )
        return out

    return await asyncio.to_thread(_search_sync)
