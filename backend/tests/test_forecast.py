"""Fase 8.7 — Forecasting (regressione lineare + endpoint)."""
import sqlite3

import pytest

from app.services.forecast import linear_forecast


# ---------- Unit ----------
def test_linear_forecast_perfect_trend():
    fc = linear_forecast([1.0, 2.0, 3.0, 4.0, 5.0], periods=2)
    assert fc["slope"] == 1.0
    assert fc["points"][0]["value"] == 6.0
    assert fc["points"][1]["value"] == 7.0
    # residui nulli -> banda degenerata
    assert fc["points"][0]["lower"] == fc["points"][0]["value"]


def test_linear_forecast_needs_two_points():
    with pytest.raises(ValueError):
        linear_forecast([42.0], periods=3)


# ---------- E2E ----------
def _make_source(tmp_path, rows):
    src = tmp_path / "fc.db"
    conn = sqlite3.connect(str(src))
    conn.execute("CREATE TABLE vendite (anno INTEGER, fatturato REAL)")
    conn.executemany("INSERT INTO vendite VALUES (?,?)", rows)
    conn.commit()
    conn.close()
    return src


def _setup_report(client, auth_headers, src):
    cid = client.post("/api/connections", headers=auth_headers, json={
        "name": f"src-fc-{src.name}", "db_type": "sqlite", "host": "localhost", "port": 0,
        "database": str(src), "username": "x", "password": "x",
    }).json()["id"]
    rid = client.post("/api/reports", headers=auth_headers, json={
        "name": f"Vendite fc {src.name}", "connection_id": cid,
        "query": "SELECT anno, fatturato FROM vendite",
    }).json()["id"]
    client.post(f"/api/semantic/reports/{rid}/autodetect", headers=auth_headers)
    return rid


def test_forecast_endpoint(client, auth_headers, tmp_path):
    src = _make_source(tmp_path, [(2020, 100.0), (2021, 120.0), (2022, 140.0),
                                  (2023, 160.0), (2024, 180.0)])
    rid = _setup_report(client, auth_headers, src)

    res = client.post(f"/api/ai/reports/{rid}/forecast", headers=auth_headers, json={
        "time_field": "anno",
        "metric": {"field": "fatturato", "aggregation": "SUM", "name": "fatturato"},
        "periods": 2,
    })
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["trend"] == "up"
    assert body["slope"] == 20.0
    assert body["forecast"][0]["label"] == 2025
    assert body["forecast"][0]["value"] == 200.0
    assert body["forecast"][1]["label"] == 2026
    assert len(body["history"]) == 5


def test_forecast_insufficient_history(client, auth_headers, tmp_path):
    src = _make_source(tmp_path, [(2024, 100.0)])
    rid = _setup_report(client, auth_headers, src)
    res = client.post(f"/api/ai/reports/{rid}/forecast", headers=auth_headers, json={
        "time_field": "anno",
        "metric": {"field": "fatturato", "aggregation": "SUM", "name": "fatturato"},
        "periods": 2,
    })
    assert res.status_code == 422


def test_forecast_guardrail_bad_metric(client, auth_headers, tmp_path):
    src = _make_source(tmp_path, [(2020, 1.0), (2021, 2.0), (2022, 3.0)])
    rid = _setup_report(client, auth_headers, src)
    res = client.post(f"/api/ai/reports/{rid}/forecast", headers=auth_headers, json={
        "time_field": "anno",
        "metric": {"field": "inventata", "aggregation": "SUM"},
        "periods": 2,
    })
    assert res.status_code == 422
