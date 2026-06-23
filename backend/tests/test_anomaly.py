"""Fase 8.6 — Anomaly detection (statistica pura + endpoint)."""
import sqlite3

import pytest

from app.services.anomaly import detect


# ---------- Unit: detect ----------
def test_zscore_flags_outlier():
    values = [10.0] * 10 + [100.0]
    found = detect(values, method="zscore", threshold=3.0)
    assert len(found) == 1
    assert found[0]["index"] == 10
    assert found[0]["direction"] == "high"


def test_iqr_flags_outlier():
    values = [1.0, 2.0, 3.0, 4.0, 5.0, 100.0]
    found = detect(values, method="iqr")
    assert any(f["value"] == 100.0 and f["direction"] == "high" for f in found)


def test_too_few_points():
    assert detect([1.0, 2.0], method="zscore") == []


def test_constant_series_no_outliers():
    assert detect([5.0, 5.0, 5.0, 5.0], method="zscore") == []
    assert detect([5.0, 5.0, 5.0, 5.0], method="iqr") == []


# ---------- E2E ----------
def _make_source(tmp_path):
    src = tmp_path / "anom.db"
    conn = sqlite3.connect(str(src))
    conn.execute("CREATE TABLE vendite (regione TEXT, fatturato REAL)")
    rows = [(f"R{i}", float(10 + (i % 4))) for i in range(8)] + [("Boom", 500.0)]
    conn.executemany("INSERT INTO vendite VALUES (?,?)", rows)
    conn.commit()
    conn.close()
    return src


@pytest.fixture
def report_id(client, auth_headers, tmp_path):
    src = _make_source(tmp_path)
    cid = client.post("/api/connections", headers=auth_headers, json={
        "name": "src-anom", "db_type": "sqlite", "host": "localhost", "port": 0,
        "database": str(src), "username": "x", "password": "x",
    }).json()["id"]
    rid = client.post("/api/reports", headers=auth_headers, json={
        "name": "Vendite anom", "connection_id": cid,
        "query": "SELECT regione, fatturato FROM vendite",
    }).json()["id"]
    client.post(f"/api/semantic/reports/{rid}/autodetect", headers=auth_headers)
    return rid


def test_anomalies_endpoint(client, auth_headers, report_id):
    res = client.post(f"/api/ai/reports/{report_id}/anomalies", headers=auth_headers, json={
        "group_by": ["regione"],
        "metric": {"field": "fatturato", "aggregation": "SUM", "name": "fatturato"},
        "method": "zscore", "threshold": 2.0,
    })
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["count"] >= 1
    labels = [a["label"] for a in body["anomalies"]]
    assert "Boom" in labels
    assert body["anomalies"][0]["direction"] == "high"


def test_anomalies_requires_group_by(client, auth_headers, report_id):
    res = client.post(f"/api/ai/reports/{report_id}/anomalies", headers=auth_headers, json={
        "group_by": [],
        "metric": {"field": "fatturato", "aggregation": "SUM"},
    })
    assert res.status_code == 422


def test_anomalies_guardrail_bad_metric(client, auth_headers, report_id):
    res = client.post(f"/api/ai/reports/{report_id}/anomalies", headers=auth_headers, json={
        "group_by": ["regione"],
        "metric": {"field": "inventata", "aggregation": "SUM"},
    })
    assert res.status_code == 422
