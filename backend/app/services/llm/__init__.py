"""
Factory LLM: seleziona il provider dalla configurazione e lo avvolge con
la logica di resilienza (retry/backoff + fallback).

LLM_PROVIDER:
- "auto"      -> anthropic se è presente LLM_API_KEY, altrimenti mock (offline)
- "anthropic" -> Claude (richiede LLM_API_KEY)
- "mock"      -> provider finto (sviluppo/test)
"""
import logging

from app.core.config import settings

from .base import (
    LLMProvider, ResilientLLM, LLMResponse, ToolSpec, ToolCall,
    LLMError, LLMTransientError, LLMConfigError,
)
from .mock_provider import MockLLM
from .anthropic_provider import AnthropicLLM

logger = logging.getLogger(__name__)

__all__ = [
    "get_llm", "build_provider", "provider_info",
    "LLMProvider", "ResilientLLM", "LLMResponse", "ToolSpec", "ToolCall",
    "LLMError", "LLMTransientError", "LLMConfigError",
    "MockLLM", "AnthropicLLM",
]


def build_provider(s=settings) -> LLMProvider:
    """Costruisce il provider primario in base alla configurazione."""
    provider = (s.LLM_PROVIDER or "auto").lower()

    if provider == "mock":
        return MockLLM()
    if provider == "anthropic" or (provider == "auto" and s.LLM_API_KEY):
        return AnthropicLLM(s.LLM_API_KEY, s.LLM_MODEL, s.LLM_BASE_URL, s.LLM_TIMEOUT)
    if provider == "auto":
        # nessuna API key: degrada a mock così lo sviluppo funziona offline
        logger.info("LLM: nessuna API key -> provider mock (offline)")
        return MockLLM()

    raise LLMConfigError(f"LLM_PROVIDER non supportato: {provider}")


def get_llm(s=settings) -> ResilientLLM:
    """Provider pronto all'uso, con retry/backoff e fallback opzionale."""
    primary = build_provider(s)
    fallback = None
    if s.LLM_FALLBACK_MODEL and isinstance(primary, AnthropicLLM):
        fallback = AnthropicLLM(s.LLM_API_KEY, s.LLM_FALLBACK_MODEL, s.LLM_BASE_URL, s.LLM_TIMEOUT)
    return ResilientLLM(primary, fallback, s.LLM_MAX_RETRIES, s.LLM_RETRY_BASE_DELAY)


def provider_info(s=settings) -> dict:
    """Stato della configurazione AI (senza chiamare l'LLM)."""
    primary = build_provider(s)
    return {
        "provider": primary.name,
        "model": s.LLM_MODEL,
        "configured": primary.name != "mock",   # mock = nessun LLM reale
        "fallback_model": s.LLM_FALLBACK_MODEL or None,
        "max_retries": s.LLM_MAX_RETRIES,
    }
