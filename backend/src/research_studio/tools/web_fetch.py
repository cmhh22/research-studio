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
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/124.0.0.0 Safari/537.36"
                ),
                "Accept": (
                    "text/html,application/xhtml+xml,application/xml;q=0.9,"
                    "image/avif,image/webp,*/*;q=0.8"
                ),
                "Accept-Language": "en-US,en;q=0.9",
            },
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
