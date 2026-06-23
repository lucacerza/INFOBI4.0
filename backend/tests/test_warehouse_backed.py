"""
Step B: report "warehouse-backed".
Verifica end-to-end che pivot/grid girino sul mart DuckDB quando il report è
warehouse-backed (routing via resolve_report_source), e che il mart sia uno
SNAPSHOT: mutare la sorgente dopo la materializzazione non cambia i risultati.
"""
import sqlite3

import pytest

from app.core.config import settings


@pytest.fixture
def wh_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "WAREHOUSE_DIR", str(tmp_path / "wh"))
    return tmp_path


def _make_source(tmp_path):
    src = tmp_path / "sales.db"
    conn = sqlite3.connect(str(src))
    conn.execute("CREATE TABLE vendite (regione TEXT, anno INTEGER, fatturato REAL)")
    conn.executemany(
        "INSERT INTO vendite VALUES (?,?,?)",
        [("Nord", 2024, 100.0), ("Sud", 2024, 50.0),
         ("Nord", 2023, 30.0), ("Sud", 2023, 20.0)],
    )
    conn.commit()
    conn.close()
    return src


def _nord_total(rows):
    """Estrae il totale fatturato della riga 'Nord' dalla risposta pivot-drill."""
    for r in rows:
        if "Nord" in r.values():
            # il valore aggregato è l'unico numerico nella riga di gruppo
            nums = [v for v in r.values() if isinstance(v, (int, float))]
            if nums:
                return nums[0]
    return None


def test_warehouse_backed_pivot_uses_mart_snapshot(client, auth_headers, wh_dir):
    src = _make_source(wh_dir)

    # 1. Connessione SQLite sorgente
    conn_res = client.post("/api/connections", headers=auth_headers, json={
        "name": "src-wh-test", "db_type": "sqlite",
        "host": "localhost", "port": 0, "database": str(src),
        "username": "x", "password": "x",
    })
    assert conn_res.status_code == 201, conn_res.text
    conn_id = conn_res.json()["id"]

    # 2. Report
    rep_res = client.post("/api/reports", headers=auth_headers, json={
        "name": "Vendite WH", "connection_id": conn_id,
        "query": "SELECT regione, anno, fatturato FROM vendite",
    })
    assert rep_res.status_code == 201, rep_res.text
    report_id = rep_res.json()["id"]

    # 3. Materializza nel warehouse
    mat = client.post("/api/warehouse/from-report", headers=auth_headers,
                      json={"report_id": report_id})
    assert mat.status_code == 201, mat.text
    assert mat.json()["row_count"] == 4
    assert mat.json()["status"] == "ready"

    # 4. Abilita warehouse-backed
    upd = client.put(f"/api/reports/{report_id}", headers=auth_headers,
                     json={"warehouse_backed": True})
    assert upd.status_code == 200, upd.text
    assert upd.json()["warehouse_backed"] is True

    # 5. MUTA la sorgente DOPO la materializzazione (riga enorme)
    conn = sqlite3.connect(str(src))
    conn.execute("INSERT INTO vendite VALUES ('Nord', 2024, 999999.0)")
    conn.commit()
    conn.close()

    # 6. Pivot-drill: deve leggere il MART (snapshot), non la sorgente mutata
    drill = client.post(f"/api/reports/{report_id}/pivot-drill", headers=auth_headers, json={
        "rowGroupCols": ["regione"],
        "groupKeys": [],
        "valueCols": [{"colId": "fatturato", "aggFunc": "sum"}],
    })
    assert drill.status_code == 200, drill.text
    rows = drill.json()["rows"]
    total_nord = _nord_total(rows)
    # snapshot: 100 + 30 = 130 (NON 1000129 della sorgente mutata)
    assert total_nord == 130.0, f"atteso 130 dal mart, ottenuto {total_nord} ({rows})"


def test_warehouse_backed_falls_back_to_live_when_not_materialized(client, auth_headers, wh_dir):
    """warehouse_backed=True ma nessun mart pronto -> fallback alla sorgente live."""
    src = _make_source(wh_dir)
    conn_id = client.post("/api/connections", headers=auth_headers, json={
        "name": "src-fallback", "db_type": "sqlite",
        "host": "localhost", "port": 0, "database": str(src),
        "username": "x", "password": "x",
    }).json()["id"]
    report_id = client.post("/api/reports", headers=auth_headers, json={
        "name": "Vendite fallback", "connection_id": conn_id,
        "query": "SELECT regione, anno, fatturato FROM vendite",
    }).json()["id"]

    # flag attivo MA non materializzato
    client.put(f"/api/reports/{report_id}", headers=auth_headers, json={"warehouse_backed": True})

    drill = client.post(f"/api/reports/{report_id}/pivot-drill", headers=auth_headers, json={
        "rowGroupCols": ["regione"],
        "groupKeys": [],
        "valueCols": [{"colId": "fatturato", "aggFunc": "sum"}],
    })
    assert drill.status_code == 200, drill.text
    # legge la sorgente live: Nord = 100 + 30 = 130
    assert _nord_total(drill.json()["rows"]) == 130.0
