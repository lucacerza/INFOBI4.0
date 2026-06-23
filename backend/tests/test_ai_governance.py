"""Fase 8.4 — Governance & logging delle traduzioni AI."""
import sqlite3

import pytest

from app.services.llm.base import ResilientLLM, LLMResponse, ToolCall
from app.services.llm.mock_provider import MockLLM


def _make_source(tmp_path):
    src = tmp_path / "gov.db"
    conn = sqlite3.connect(str(src))
    conn.execute("CREATE TABLE vendite (regione TEXT, anno INTEGER, fatturato REAL)")
    conn.executemany("INSERT INTO vendite VALUES (?,?,?)",
                     [("Nord", 2024, 100.0), ("Sud", 2024, 50.0)])
    conn.commit()
    conn.close()
    return src


@pytest.fixture
def report_id(client, auth_headers, tmp_path):
    src = _make_source(tmp_path)
    cid = client.post("/api/connections", headers=auth_headers, json={
        "name": "src-gov", "db_type": "sqlite", "host": "localhost", "port": 0,
        "database": str(src), "username": "x", "password": "x",
    }).json()["id"]
    rid = client.post("/api/reports", headers=auth_headers, json={
        "name": "Vendite gov", "connection_id": cid,
        "query": "SELECT regione, anno, fatturato FROM vendite",
    }).json()["id"]
    client.post(f"/api/semantic/reports/{rid}/autodetect", headers=auth_headers)
    return rid


def _patch_pivot(monkeypatch, tool_args):
    resp = LLMResponse(text="ok", tool_calls=[ToolCall("build_pivot", tool_args)])
    monkeypatch.setattr("app.services.llm.get_llm", lambda *a, **k: ResilientLLM(MockLLM(responses=[resp])))


def test_ask_is_logged_and_feedback(client, auth_headers, report_id, monkeypatch):
    _patch_pivot(monkeypatch, {
        "group_by": ["regione"],
        "metrics": [{"field": "fatturato", "aggregation": "sum"}],
    })
    ask = client.post(f"/api/ai/reports/{report_id}/ask", headers=auth_headers,
                      json={"question": "fatturato per regione"})
    assert ask.status_code == 200, ask.text
    log_id = ask.json()["log_id"]
    assert log_id

    # il log esiste con esito ok
    logs = client.get("/api/ai/logs", headers=auth_headers).json()
    entry = next(l for l in logs if l["id"] == log_id)
    assert entry["status"] == "ok"
    assert entry["kind"] == "pivot"
    assert entry["question"] == "fatturato per regione"
    assert entry["result"]["group_by"] == ["regione"]

    # feedback
    fb = client.post(f"/api/ai/logs/{log_id}/feedback", headers=auth_headers,
                     json={"helpful": True, "note": "perfetto"})
    assert fb.status_code == 200
    logs2 = client.get("/api/ai/logs", headers=auth_headers).json()
    entry2 = next(l for l in logs2 if l["id"] == log_id)
    assert entry2["helpful"] is True
    assert entry2["feedback_note"] == "perfetto"


def test_rejected_translation_is_logged(client, auth_headers, report_id, monkeypatch):
    _patch_pivot(monkeypatch, {
        "group_by": ["colonna_inventata"],
        "metrics": [{"field": "fatturato", "aggregation": "sum"}],
    })
    res = client.post(f"/api/ai/reports/{report_id}/ask", headers=auth_headers,
                      json={"question": "x"})
    assert res.status_code == 422
    logs = client.get("/api/ai/logs", headers=auth_headers).json()
    rejected = [l for l in logs if l["report_id"] == report_id and l["status"] == "rejected"]
    assert rejected
    assert "non riconosciute" in (rejected[0]["error"] or "")


def test_certified_only_governance(client, auth_headers, report_id, monkeypatch):
    """Con AI_CERTIFIED_ONLY, l'AI può usare solo le colonne certificate."""
    from app.core.config import settings
    monkeypatch.setattr(settings, "AI_CERTIFIED_ONLY", True)

    _patch_pivot(monkeypatch, {
        "group_by": ["regione"],
        "metrics": [{"field": "fatturato", "aggregation": "sum"}],
    })

    # nessuna colonna certificata -> grounding vuoto -> richiesta respinta
    blocked = client.post(f"/api/ai/reports/{report_id}/ask", headers=auth_headers,
                          json={"question": "fatturato per regione"})
    assert blocked.status_code == 422

    # certifico le colonne necessarie
    for col in ("regione", "fatturato"):
        r = client.put(f"/api/semantic/reports/{report_id}/columns/{col}",
                       headers=auth_headers, json={"is_certified": True})
        assert r.status_code == 200

    ok = client.post(f"/api/ai/reports/{report_id}/ask", headers=auth_headers,
                     json={"question": "fatturato per regione"})
    assert ok.status_code == 200, ok.text
    assert ok.json()["config"]["group_by"] == ["regione"]
