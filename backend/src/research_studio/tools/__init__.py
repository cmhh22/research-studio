"""Tool registry: maps tool names to coroutines and exposes their schemas."""

from research_studio.tools.web_fetch import WEB_FETCH_SCHEMA, run_web_fetch
from research_studio.tools.web_search import WEB_SEARCH_SCHEMA, run_web_search

TOOL_REGISTRY = {
    "web_search": run_web_search,
    "web_fetch": run_web_fetch,
}

TOOL_SCHEMAS = [WEB_SEARCH_SCHEMA, WEB_FETCH_SCHEMA]
"""Tool registry exports."""
