"""
Fase 7: catalogo schema (introspezione) + semantic layer (metadati per colonna).
"""
import sqlite3

import pytest

from app.services.schema_catalog import semantic_type
from app.services.semantic import infer


# ---------- Unit: mappatura tipi ----------
def test_semantic_type():
    assert semantic_type("INTEGER") == "number"
    assert semantic_type("DECIMAL(10,2)") == "number"
    assert semantic_type("DOUBLE") == "number"
    assert semantic_type("VARCHAR(255)") == "string"
    assert semantic_type("TIMESTAMP") == "date"
    assert semantic_type("DATE") == "date"
    assert semantic_type("BOOLEAN") == "boolean"


def test_infer_roles():
    # numerico -> misura con somma
    assert infer("fatturato", "DOUBLE") == ("number", "measure", "sum")
    # data -> dimensione temporale
    assert infer("data_ordine", "DATE") == ("date", "time", "none")
    # nome temporale anche se intero -> time (non measure)
    assert infer("Anno", "INTEGER") == ("number", "time", "none")
    # stringa -> dimensione
    assert infer("regione", "VARCHAR") == ("string", "dimension", "none")


# ---------- E2E ----------
def _make_source(tmp_path):
    src = tmp_path / "cat.db"
    conn = sqlite3.connect(str(src))
    conn.execute("CREATE TABLE vendite (id INTEGER PRIMARY KEY, regione TEXT, anno INTEGER, fatturato REAL)")
    conn.executemany(
        "INSERT INTO vendite (regione, anno, fatturato) VALUES (?,?,?)",
        [("Nord", 2024, 100.0), ("Sud", 2024, 50.0)],
    )
    conn.commit()
    conn.close()
    return src


@pytest.fixture
def report_ctx(client, auth_headers, tmp_path):
    src = _make_source(tmp_path)
    conn_id = client.post("/api/connections", headers=auth_headers, json={
        "name": "src-catalog", "db_type": "sqlite",
        "host": "localhost", "port": 0, "database": str(src),
        "username": "x", "password": "x",
    }).json()["id"]
    report_id = client.post("/api/reports", headers=auth_headers, json={
        "name": "Vendite catalog", "connection_id": conn_id,
        "query": "SELECT regione, anno, fatturato FROM vendite",
    }).json()["id"]
    return {"conn_id": conn_id, "report_id": report_id}


def test_catalog_introspection(client, auth_headers, report_ctx):
    conn_id = report_ctx["conn_id"]

    tables = client.get(f"/api/catalog/connections/{conn_id}/tables", headers=auth_headers)
    assert tables.status_code == 200, tables.text
    assert "vendite" in tables.json()["tables"]

    desc = client.get(f"/api/catalog/connections/{conn_id}/tables/vendite", headers=auth_headers)
    assert desc.status_code == 200, desc.text
    cols = {c["name"]: c for c in desc.json()["columns"]}
    assert cols["fatturato"]["semantic_type"] == "number"
    assert cols["regione"]["semantic_type"] == "string"
    assert cols["id"]["primary_key"] is True


def test_semantic_autodetect_and_edit(client, auth_headers, report_ctx):
    report_id = report_ctx["report_id"]

    # autodetect
    auto = client.post(f"/api/semantic/reports/{report_id}/autodetect", headers=auth_headers)
    assert auto.status_code == 200, auto.text
    by_name = {m["column_name"]: m for m in auto.json()}
    assert by_name["fatturato"]["role"] == "measure"
    assert by_name["fatturato"]["default_aggregation"] == "sum"
    assert by_name["anno"]["role"] == "time"
    assert by_name["regione"]["role"] == "dimension"

    # edit di una colonna
    upd = client.put(
        f"/api/semantic/reports/{report_id}/columns/fatturato",
        headers=auth_headers,
        json={"business_name": "Fatturato netto", "unit": "€", "format": "#,##0.00"},
    )
    assert upd.status_code == 200, upd.text
    assert upd.json()["business_name"] == "Fatturato netto"
    assert upd.json()["unit"] == "€"

    # la modifica persiste e non viene sovrascritta da un nuovo autodetect
    client.post(f"/api/semantic/reports/{report_id}/autodetect", headers=auth_headers)
    lst = client.get(f"/api/semantic/reports/{report_id}", headers=auth_headers).json()
    fatt = next(m for m in lst if m["column_name"] == "fatturato")
    assert fatt["business_name"] == "Fatturato netto"
    assert fatt["unit"] == "€"


def test_semantic_validation_and_missing(client, auth_headers, report_ctx):
    report_id = report_ctx["report_id"]
    client.post(f"/api/semantic/reports/{report_id}/autodetect", headers=auth_headers)

    # ruolo non valido
    bad = client.put(
        f"/api/semantic/reports/{report_id}/columns/regione",
        headers=auth_headers, json={"role": "banana"},
    )
    assert bad.status_code == 400

    # colonna inesistente
    missing = client.put(
        f"/api/semantic/reports/{report_id}/columns/inesistente",
        headers=auth_headers, json={"unit": "€"},
    )
    assert missing.status_code == 404
