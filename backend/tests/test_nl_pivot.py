"""Fase 8.2 — NL -> Pivot: mapping, guardrail anti-allucinazione, endpoint."""
import sqlite3

import pytest

from app.services.nl_pivot import validate_and_build
from app.services.llm.base import ResilientLLM, LLMResponse, ToolCall
from app.services.llm.mock_provider import MockLLM


COLS = [
    {"name": "regione", "business_name": "Regione", "role": "dimension",
     "data_type": "string", "default_aggregation": "none", "unit": None},
    {"name": "anno", "business_name": "Anno", "role": "time",
     "data_type": "number", "default_aggregation": "none", "unit": None},
    {"name": "fatturato", "business_name": "Fatturato", "role": "measure",
     "data_type": "number", "default_aggregation": "sum", "unit": "€"},
]


# ---------- Unit: validate_and_build ----------
def test_valid_mapping():
    cfg = validate_and_build(COLS, {
        "group_by": ["regione"],
        "metrics": [{"field": "fatturato", "aggregation": "sum"}],
    })
    assert cfg["group_by"] == ["regione"]
    assert cfg["metrics"][0]["field"] == "fatturato"
    assert cfg["metrics"][0]["aggregation"] == "SUM"
    assert cfg["metrics"][0]["name"] == "Fatturato"


def test_resolves_business_names():
    cfg = validate_and_build(COLS, {
        "group_by": ["Regione"],                       # nome business
        "metrics": [{"field": "Fatturato", "aggregation": "sum"}],
    })
    assert cfg["group_by"] == ["regione"]
    assert cfg["metrics"][0]["field"] == "fatturato"


def test_hallucinated_column_rejected():
    with pytest.raises(ValueError, match="non riconosciute"):
        validate_and_build(COLS, {
            "group_by": ["cliente"],                    # non esiste
            "metrics": [{"field": "fatturato", "aggregation": "sum"}],
        })


def test_no_metric_rejected():
    with pytest.raises(ValueError, match="misura"):
        validate_and_build(COLS, {"group_by": ["regione"], "metrics": []})


def test_bad_aggregation_falls_back_to_sum():
    cfg = validate_and_build(COLS, {
        "group_by": ["regione"],
        "metrics": [{"field": "fatturato", "aggregation": "banana"}],
    })
    assert cfg["metrics"][0]["aggregation"] == "SUM"


def test_filters_mapping():
    cfg = validate_and_build(COLS, {
        "group_by": ["regione"],
        "metrics": [{"field": "fatturato", "aggregation": "sum"}],
        "filters": [
            {"field": "anno", "op": "equals", "value": 2024},
            {"field": "regione", "op": "in", "values": ["Nord", "Sud"]},
        ],
    })
    assert cfg["filters"]["anno"] == {"type": "equals", "value": 2024}
    assert cfg["filters"]["regione"] == {"type": "in", "values": ["Nord", "Sud"]}


# ---------- E2E ----------
def _make_source(tmp_path):
    src = tmp_path / "nl.db"
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
        "name": "src-nl", "db_type": "sqlite", "host": "localhost", "port": 0,
        "database": str(src), "username": "x", "password": "x",
    }).json()["id"]
    rid = client.post("/api/reports", headers=auth_headers, json={
        "name": "Vendite NL", "connection_id": cid,
        "query": "SELECT regione, anno, fatturato FROM vendite",
    }).json()["id"]
    client.post(f"/api/semantic/reports/{rid}/autodetect", headers=auth_headers)
    return rid


def _patch_llm(monkeypatch, tool_args):
    resp = LLMResponse(text="Ecco la pivot.", tool_calls=[ToolCall("build_pivot", tool_args)])
    monkeypatch.setattr("app.services.llm.get_llm", lambda *a, **k: ResilientLLM(MockLLM(responses=[resp])))


def test_ask_endpoint_returns_config(client, auth_headers, report_id, monkeypatch):
    _patch_llm(monkeypatch, {
        "group_by": ["Regione"],
        "metrics": [{"field": "Fatturato", "aggregation": "sum"}],
    })
    res = client.post(f"/api/ai/reports/{report_id}/ask", headers=auth_headers,
                      json={"question": "fatturato per regione"})
    assert res.status_code == 200, res.text
    cfg = res.json()["config"]
    assert cfg["group_by"] == ["regione"]
    assert cfg["metrics"][0]["field"] == "fatturato"
    assert res.json()["explanation"] == "Ecco la pivot."


def test_ask_endpoint_guardrail(client, auth_headers, report_id, monkeypatch):
    _patch_llm(monkeypatch, {
        "group_by": ["cliente_inventato"],
        "metrics": [{"field": "fatturato", "aggregation": "sum"}],
    })
    res = client.post(f"/api/ai/reports/{report_id}/ask", headers=auth_headers,
                      json={"question": "qualcosa"})
    assert res.status_code == 422
    assert "non riconosciute" in res.json()["detail"]


def test_ask_empty_question(client, auth_headers, report_id):
    res = client.post(f"/api/ai/reports/{report_id}/ask", headers=auth_headers,
                      json={"question": "  "})
    assert res.status_code == 400
