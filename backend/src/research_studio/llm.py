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
