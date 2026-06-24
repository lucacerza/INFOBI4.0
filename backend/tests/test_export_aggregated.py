"""Fase 5 — export dei dati aggregati (pivot) in CSV/XLSX."""
import sqlite3

import pytest


@pytest.fixture
def report_id(client, auth_headers, tmp_path):
    src = tmp_path / "exp.db"
    conn = sqlite3.connect(str(src))
    conn.execute("CREATE TABLE vendite (regione TEXT, fatturato REAL)")
    conn.executemany("INSERT INTO vendite VALUES (?,?)",
                     [("Nord", 100.0), ("Sud", 50.0), ("Nord", 30.0)])
    conn.commit()
    conn.close()
    cid = client.post("/api/connections", headers=auth_headers, json={
        "name": "src-exp", "db_type": "sqlite", "host": "localhost", "port": 0,
        "database": str(src), "username": "x", "password": "x",
    }).json()["id"]
    return client.post("/api/reports", headers=auth_headers, json={
        "name": "Vendite Export", "connection_id": cid,
        "query": "SELECT regione, fatturato FROM vendite",
    }).json()["id"]


def _agg_body():
    return {
        "group_by": ["regione"],
        "metrics": [{"field": "fatturato", "aggregation": "SUM", "name": "fatturato"}],
    }


def test_export_aggregated_csv(client, auth_headers, report_id):
    res = client.post(f"/api/export/{report_id}/aggregated?format=csv",
                      headers=auth_headers, json=_agg_body())
    assert res.status_code == 200, res.text
    assert "text/csv" in res.headers["content-type"]
    text = res.content.decode("utf-8")
    assert "regione" in text and "fatturato" in text
    # Nord aggregato = 100 + 30 = 130
    nord = next(line for line in text.splitlines() if line.startswith("Nord"))
    assert "130" in nord


def test_export_aggregated_xlsx(client, auth_headers, report_id):
    res = client.post(f"/api/export/{report_id}/aggregated?format=xlsx",
                      headers=auth_headers, json=_agg_body())
    assert res.status_code == 200, res.text
    assert "spreadsheetml" in res.headers["content-type"]
    assert res.content[:2] == b"PK"          # file XLSX = archivio ZIP
    assert "filename=" in res.headers.get("content-disposition", "")


def test_export_aggregated_requires_metrics(client, auth_headers, report_id):
    res = client.post(f"/api/export/{report_id}/aggregated?format=csv",
                      headers=auth_headers, json={"group_by": ["regione"], "metrics": []})
    assert res.status_code == 400
