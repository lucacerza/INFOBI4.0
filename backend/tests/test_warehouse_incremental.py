"""Fase 7 — ETL incrementale (step 1): carico append basato su watermark."""
import sqlite3

import pytest

from app.core.config import settings
from app.services import warehouse


def _add_rows(db_path, rows):
    conn = sqlite3.connect(str(db_path))
    conn.executemany("INSERT INTO vendite VALUES (?,?)", rows)
    conn.commit()
    conn.close()


def _make_source(tmp_path):
    src = tmp_path / "inc.db"
    conn = sqlite3.connect(str(src))
    conn.execute("CREATE TABLE vendite (id INTEGER, importo REAL)")
    conn.executemany("INSERT INTO vendite VALUES (?,?)", [(1, 10.0), (2, 20.0), (3, 30.0)])
    conn.commit()
    conn.close()
    return src


# ---------- Service ----------
def test_incremental_initial_then_append(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "WAREHOUSE_DIR", str(tmp_path / "wh"))
    src = _make_source(tmp_path)
    cfg = {"database": str(src)}
    q = "SELECT id, importo FROM vendite"

    r1 = warehouse.materialize_incremental("mart_inc", "sqlite", cfg, q, "id", None)
    assert r1["mode"] == "initial"
    assert r1["rows_added"] == 3 and r1["total_rows"] == 3
    assert r1["watermark"] == "3"

    _add_rows(src, [(4, 40.0), (5, 50.0)])
    r2 = warehouse.materialize_incremental("mart_inc", "sqlite", cfg, q, "id", r1["watermark"])
    assert r2["mode"] == "append"
    assert r2["rows_added"] == 2 and r2["total_rows"] == 5
    assert r2["watermark"] == "5"

    # nessuna riga nuova: niente da aggiungere, watermark invariato
    r3 = warehouse.materialize_incremental("mart_inc", "sqlite", cfg, q, "id", r2["watermark"])
    assert r3["rows_added"] == 0 and r3["total_rows"] == 5
    assert r3["watermark"] == "5"

    # il warehouse contiene davvero 5 righe (no doppioni)
    import polars as pl
    n = pl.from_arrow(warehouse.query_arrow('SELECT COUNT(*) AS c FROM "mart_inc"'))["c"].to_list()[0]
    assert n == 5


# ---------- E2E ----------
def test_incremental_dataset_refresh(client, auth_headers, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "WAREHOUSE_DIR", str(tmp_path / "wh"))
    src = tmp_path / "sales.db"
    conn = sqlite3.connect(str(src))
    conn.execute("CREATE TABLE vendite (id INTEGER, regione TEXT, fatturato REAL)")
    conn.executemany("INSERT INTO vendite VALUES (?,?,?)",
                     [(1, "Nord", 100.0), (2, "Sud", 50.0), (3, "Nord", 30.0)])
    conn.commit()
    conn.close()

    cid = client.post("/api/connections", headers=auth_headers, json={
        "name": "src-inc", "db_type": "sqlite", "host": "localhost", "port": 0,
        "database": str(src), "username": "x", "password": "x",
    }).json()["id"]
    rid = client.post("/api/reports", headers=auth_headers, json={
        "name": "Vendite inc", "connection_id": cid,
        "query": "SELECT id, regione, fatturato FROM vendite",
    }).json()["id"]

    # crea dataset incrementale (carico iniziale)
    created = client.post("/api/warehouse/from-report", headers=auth_headers, json={
        "report_id": rid, "sync_mode": "incremental", "watermark_column": "id",
    })
    assert created.status_code == 201, created.text
    ds = created.json()
    assert ds["sync_mode"] == "incremental"
    assert ds["row_count"] == 3
    assert ds["last_watermark"] == "3"

    # arrivano nuove righe nella sorgente
    conn = sqlite3.connect(str(src))
    conn.executemany("INSERT INTO vendite VALUES (?,?,?)", [(4, "Est", 70.0), (5, "Ovest", 90.0)])
    conn.commit()
    conn.close()

    refreshed = client.post(f"/api/warehouse/{ds['id']}/refresh", headers=auth_headers)
    assert refreshed.status_code == 200, refreshed.text
    body = refreshed.json()
    assert body["row_count"] == 5            # 3 + 2 incrementali
    assert body["last_watermark"] == "5"


def test_incremental_requires_watermark(client, auth_headers, tmp_path):
    # creo al volo un report qualsiasi
    src = tmp_path / "w.db"
    conn = sqlite3.connect(str(src))
    conn.execute("CREATE TABLE t (id INTEGER)")
    conn.commit()
    conn.close()
    cid = client.post("/api/connections", headers=auth_headers, json={
        "name": "src-nowm", "db_type": "sqlite", "host": "localhost", "port": 0,
        "database": str(src), "username": "x", "password": "x",
    }).json()["id"]
    rid = client.post("/api/reports", headers=auth_headers, json={
        "name": "NoWM", "connection_id": cid, "query": "SELECT id FROM t",
    }).json()["id"]

    res = client.post("/api/warehouse/from-report", headers=auth_headers, json={
        "report_id": rid, "sync_mode": "incremental",   # manca watermark_column
    })
    assert res.status_code == 400
