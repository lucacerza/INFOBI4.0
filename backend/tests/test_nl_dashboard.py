"""Fase 8.5 — NL -> Dashboard."""
import sqlite3

import pytest

from app.services.llm.base import ResilientLLM, LLMResponse, ToolCall
from app.services.llm.mock_provider import MockLLM


def _make_source(tmp_path):
    src = tmp_path / "dash.db"
    conn = sqlite3.connect(str(src))
    conn.execute("CREATE TABLE vendite (regione TEXT, anno INTEGER, fatturato REAL)")
    conn.executemany("INSERT INTO vendite VALUES (?,?,?)",
                     [("Nord", 2024, 100.0), ("Sud", 2024, 50.0), ("Nord", 2023, 30.0)])
    conn.commit()
    conn.close()
    return src


@pytest.fixture
def report_id(client, auth_headers, tmp_path):
    src = _make_source(tmp_path)
    cid = client.post("/api/connections", headers=auth_headers, json={
        "name": "src-dash", "db_type": "sqlite", "host": "localhost", "port": 0,
        "database": str(src), "username": "x", "password": "x",
    }).json()["id"]
    rid = client.post("/api/reports", headers=auth_headers, json={
        "name": "Vendite dash", "connection_id": cid,
        "query": "SELECT regione, anno, fatturato FROM vendite",
    }).json()["id"]
    client.post(f"/api/semantic/reports/{rid}/autodetect", headers=auth_headers)
    return rid


def _patch_dashboard(monkeypatch, args):
    resp = LLMResponse(text="ok", tool_calls=[ToolCall("build_dashboard", args)])
    monkeypatch.setattr("app.services.llm.get_llm", lambda *a, **k: ResilientLLM(MockLLM(responses=[resp])))


def test_nl_dashboard_creates_widgets(client, auth_headers, report_id, monkeypatch):
    _patch_dashboard(monkeypatch, {
        "title": "Vendite",
        "widgets": [
            {"title": "Fatturato per regione", "widget_type": "chart", "chart_type": "bar",
             "group_by": ["regione"], "metrics": [{"field": "fatturato", "aggregation": "sum"}]},
            {"title": "Dettaglio", "widget_type": "grid",
             "group_by": ["regione", "anno"], "metrics": [{"field": "fatturato", "aggregation": "sum"}]},
        ],
    })
    res = client.post(f"/api/ai/reports/{report_id}/dashboard", headers=auth_headers,
                      json={"description": "vendite per regione e dettaglio per anno"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["widget_count"] == 2
    dash_id = body["dashboard_id"]

    # la dashboard è stata creata con i widget e la config corretta
    dash = client.get(f"/api/dashboards/{dash_id}", headers=auth_headers).json()
    widgets = dash["widgets"]
    assert len(widgets) == 2
    chart = next(w for w in widgets if w["widget_type"] == "chart")
    assert chart["config"]["chartType"] == "bar"
    assert chart["config"]["groupBy"] == ["regione"]
    assert chart["config"]["metrics"][0]["field"] == "fatturato"
    grid = next(w for w in widgets if w["widget_type"] == "grid")
    assert grid["config"]["groupBy"] == ["regione", "anno"]


def test_nl_dashboard_guardrail(client, auth_headers, report_id, monkeypatch):
    _patch_dashboard(monkeypatch, {
        "title": "X",
        "widgets": [
            {"title": "Bad", "widget_type": "chart", "chart_type": "bar",
             "group_by": ["colonna_fantasma"], "metrics": [{"field": "fatturato", "aggregation": "sum"}]},
        ],
    })
    res = client.post(f"/api/ai/reports/{report_id}/dashboard", headers=auth_headers,
                      json={"description": "x"})
    assert res.status_code == 422
    assert "non riconosciute" in res.json()["detail"]


def test_nl_dashboard_empty_description(client, auth_headers, report_id):
    res = client.post(f"/api/ai/reports/{report_id}/dashboard", headers=auth_headers,
                      json={"description": "  "})
    assert res.status_code == 400
