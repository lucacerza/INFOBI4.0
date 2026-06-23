"""Fase 8.1 — astrazione LLM: resilienza (retry/backoff/fallback) e factory."""
import asyncio
from types import SimpleNamespace

import pytest

from app.services.llm import build_provider, provider_info, get_llm
from app.services.llm.base import (
    ResilientLLM, LLMResponse, LLMError, LLMTransientError,
)
from app.services.llm.mock_provider import MockLLM
from app.services.llm.anthropic_provider import AnthropicLLM


def _ns(**kw):
    base = dict(
        LLM_PROVIDER="auto", LLM_MODEL="claude-opus-4-8", LLM_API_KEY="",
        LLM_BASE_URL="", LLM_FALLBACK_MODEL="", LLM_MAX_RETRIES=3,
        LLM_RETRY_BASE_DELAY=0.0, LLM_TIMEOUT=60,
    )
    base.update(kw)
    return SimpleNamespace(**base)


# ---------- Resilienza ----------
def test_retry_then_success():
    """Due 529 transitori, poi risposta: deve ritentare e riuscire."""
    primary = MockLLM(responses=[LLMResponse(text="ok")], fail_times=2)
    llm = ResilientLLM(primary, max_retries=3, base_delay=0.0)
    res = asyncio.run(llm.generate(messages=[{"role": "user", "content": "ciao"}]))
    assert res.text == "ok"
    assert primary.calls == 3  # 2 falliti + 1 ok


def test_retry_exhausted_raises():
    primary = MockLLM(fail_times=10)
    llm = ResilientLLM(primary, max_retries=2, base_delay=0.0)
    with pytest.raises(LLMTransientError):
        asyncio.run(llm.generate(messages=[{"role": "user", "content": "x"}]))
    assert primary.calls == 3  # 1 + 2 retry


def test_permanent_error_uses_fallback():
    """Errore permanente sul primario -> passa subito al fallback."""
    primary = MockLLM(fail_times=1, error=LLMError("HTTP 400"))
    fallback = MockLLM(responses=[LLMResponse(text="dal-fallback")])
    llm = ResilientLLM(primary, fallback=fallback, max_retries=3, base_delay=0.0)
    res = asyncio.run(llm.generate(messages=[{"role": "user", "content": "x"}]))
    assert res.text == "dal-fallback"
    assert primary.calls == 1       # nessun retry su errore permanente
    assert fallback.calls == 1


def test_transient_then_fallback():
    """Primario esaurisce i retry -> fallback risponde."""
    primary = MockLLM(fail_times=10)
    fallback = MockLLM(responses=[LLMResponse(text="fb")])
    llm = ResilientLLM(primary, fallback=fallback, max_retries=1, base_delay=0.0)
    res = asyncio.run(llm.generate(messages=[{"role": "user", "content": "x"}]))
    assert res.text == "fb"
    assert primary.calls == 2  # 1 + 1 retry


# ---------- Factory ----------
def test_factory_auto_without_key_is_mock():
    assert build_provider(_ns(LLM_PROVIDER="auto", LLM_API_KEY="")).name == "mock"


def test_factory_auto_with_key_is_anthropic():
    p = build_provider(_ns(LLM_PROVIDER="auto", LLM_API_KEY="sk-test"))
    assert isinstance(p, AnthropicLLM)
    assert p.name == "anthropic"


def test_factory_explicit_mock():
    assert build_provider(_ns(LLM_PROVIDER="mock", LLM_API_KEY="sk-test")).name == "mock"


def test_anthropic_base_url_override():
    p = build_provider(_ns(LLM_PROVIDER="anthropic", LLM_API_KEY="k", LLM_BASE_URL="http://localhost:4000"))
    assert p.url == "http://localhost:4000/v1/messages"


def test_get_llm_with_fallback():
    llm = get_llm(_ns(LLM_PROVIDER="anthropic", LLM_API_KEY="k", LLM_FALLBACK_MODEL="claude-haiku-4-5-20251001"))
    assert llm.fallback is not None


def test_provider_info_mock_not_configured():
    info = provider_info(_ns(LLM_PROVIDER="auto", LLM_API_KEY=""))
    assert info["provider"] == "mock"
    assert info["configured"] is False


def test_provider_info_anthropic_configured():
    info = provider_info(_ns(LLM_PROVIDER="auto", LLM_API_KEY="sk-test"))
    assert info["provider"] == "anthropic"
    assert info["configured"] is True


# ---------- Endpoint ----------
def test_ai_status_endpoint(client, auth_headers):
    res = client.get("/api/ai/status", headers=auth_headers)
    assert res.status_code == 200, res.text
    # ambiente di test: nessuna API key -> mock
    assert res.json()["provider"] == "mock"
    assert res.json()["configured"] is False
