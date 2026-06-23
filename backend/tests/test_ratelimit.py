"""Test rate limiting + cost guard (Fase 2.5)."""
from app.core.ratelimit import RateLimiter
from app.core.config import settings
from app.core.limits import clamp_rows
from app import main


def test_ratelimiter_allows_then_blocks():
    rl = RateLimiter(max_per_window=2, window_seconds=60)
    assert rl.allow("k", now=1000.0) is True
    assert rl.allow("k", now=1000.1) is True
    assert rl.allow("k", now=1000.2) is False        # oltre il limite
    assert rl.allow("altra-chiave", now=1000.2) is True  # chiavi indipendenti


def test_ratelimiter_window_resets():
    rl = RateLimiter(max_per_window=1, window_seconds=10)
    assert rl.allow("k", now=0) is True
    assert rl.allow("k", now=5) is False
    assert rl.allow("k", now=11) is True             # finestra scaduta


def test_clamp_rows_cost_guard():
    cap = settings.MAX_ROWS_PREVIEW
    assert clamp_rows(None) == cap
    assert clamp_rows(0) == cap
    assert clamp_rows(50) == 50
    assert clamp_rows(cap + 1000) == cap             # mai oltre il cap


def test_rate_limit_middleware_returns_429(client, auth_headers, monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMIT_ENABLED", True)
    monkeypatch.setattr(main, "_rate_limiter", RateLimiter(max_per_window=2, window_seconds=60))

    r1 = client.get("/api/audit?limit=1", headers=auth_headers)
    r2 = client.get("/api/audit?limit=1", headers=auth_headers)
    r3 = client.get("/api/audit?limit=1", headers=auth_headers)

    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r3.status_code == 429
