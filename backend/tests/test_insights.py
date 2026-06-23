"""Fase 8.3 — Auto-insight / narrazione."""
import sqlite3

import pytest

from app.services.insights import build_digest
from app.services.llm.base import ResilientLLM, LLMResponse
from app.services.llm.mock_provider import MockLLM


COLS = [
    {"name": "regione", "business_name": "Regione", "role": "dimension",
     "data_type": "string", "default_aggregation": "none", "unit": None},
    {"name": "fatturato", "business_name": "Fatturato", "role": "measure",
     "data_type": "number", "default_aggregation": "sum", "unit": "€"},
]


# ---------- Unit: digest ----------
def test_build_digest_contains_labels_units_values():
    rows = [{"regione": "Nord", "fatturato": 130.0}, {"regione": "Sud", "fatturato": 50.0}]
    digest = build_digest(COLS, ["regione"], [{"name": "fatturato", "field": "fatturato"}], rows)
    assert "Regione" in digest          # nome business della dimensione
    assert "(€)" in digest              # unità della misura
    assert "Regione=Nord" in digest
    assert "fatturato=130" in digest
    assert "Righe aggregate totali: 2" in digest


def test_build_digest_rounds_and_caps():
    rows = [{"regione": f"R{i}", "fatturato": i + 0.123456} for i in range(100)]
    digest = build_digest(COLS, ["regione"], [{"name": "fatturato", "field": "fatturato"}], rows, max_rows=10)
    # cap: 10 righe mostrate (11 righe "- " contando l'eventuale, qui esattamente 10 dati)
    assert digest.count("\n- ") == 10
    assert "0.12" in digest             # arrotondamento a 2 decimali


# ---------- E2E ----------
def _make_source(tmp_path):
    src = tmp_path / "ins.db"
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
        "name": "src-ins", "db_type": "sqlite", "host": "localhost", "port": 0,
        "database": str(src), "username": "x", "password": "x",
    }).json()["id"]
    rid = client.post("/api/reports", headers=auth_headers, json={
        "name": "Vendite insight", "connection_id": cid,
        "query": "SELECT regione, anno, fatturato FROM vendite",
    }).json()["id"]
    client.post(f"/api/semantic/reports/{rid}/autodetect", headers=auth_headers)
    return rid


def _patch_llm(monkeypatch, text):
    resp = LLMResponse(text=text)
    monkeypatch.setattr("app.services.llm.get_llm", lambda *a, **k: ResilientLLM(MockLLM(responses=[resp])))


def test_insights_endpoint(client, auth_headers, report_id, monkeypatch):
    _patch_llm(monkeypatch, "Il Nord concentra la quota maggiore di fatturato.")
    res = client.post(f"/api/ai/reports/{report_id}/insights", headers=auth_headers, json={
        "group_by": ["regione"],
        "metrics": [{"name": "fatturato", "field": "fatturato", "aggregation": "SUM"}],
    })
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["narrative"] == "Il Nord concentra la quota maggiore di fatturato."
    assert body["row_count"] == 2   # Nord, Sud


def test_insights_requires_metrics(client, auth_headers, report_id):
    res = client.post(f"/api/ai/reports/{report_id}/insights", headers=auth_headers, json={
        "group_by": ["regione"], "metrics": [],
    })
    assert res.status_code == 400
