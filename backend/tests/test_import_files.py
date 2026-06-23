"""Fase 5 — import Excel/CSV come sorgente SQLite."""
import io
import sqlite3

import openpyxl
import polars as pl
import pytest

from app.core.config import settings
from app.services import file_import


def _xlsx_bytes(header, rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(header)
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ---------- Unit ----------
def test_parse_csv_and_xlsx():
    df_csv = file_import.parse_dataframe("v.csv", b"regione,fatturato\nNord,100\nSud,50\n")
    assert df_csv.shape == (2, 2)
    assert df_csv.columns == ["regione", "fatturato"]

    df_xlsx = file_import.parse_dataframe("p.xlsx", _xlsx_bytes(["prodotto", "qta"], [["A", 3], ["B", 7]]))
    assert df_xlsx.shape == (2, 2)
    assert df_xlsx.columns == ["prodotto", "qta"]


def test_parse_rejects_unknown_and_empty():
    with pytest.raises(ValueError):
        file_import.parse_dataframe("x.pdf", b"...")
    with pytest.raises(ValueError):
        file_import.parse_dataframe("e.csv", b"solo_header\n")


def test_write_sqlite_roundtrip(tmp_path):
    df = pl.DataFrame({"regione": ["Nord", "Sud", "Nord"], "fatturato": [100.0, 50.0, 30.0]})
    dbp = tmp_path / "out.db"
    rows, cols = file_import.write_sqlite(df, dbp)
    assert rows == 3 and cols == ["regione", "fatturato"]
    con = sqlite3.connect(str(dbp))
    assert con.execute("SELECT COUNT(*), SUM(fatturato) FROM data").fetchone() == (3, 180.0)
    con.close()


# ---------- E2E ----------
def test_import_csv_endpoint_creates_usable_report(client, auth_headers, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "IMPORTS_DIR", str(tmp_path / "imports"))

    res = client.post(
        "/api/connections/import",
        headers=auth_headers,
        data={"name": "Vendite CSV"},
        files={"file": ("vendite.csv", b"regione,fatturato\nNord,100\nSud,50\nNord,30\n", "text/csv")},
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["rows"] == 3
    assert body["columns"] == ["regione", "fatturato"]
    report_id = body["report_id"]

    # il report importato è subito interrogabile dal motore pivot
    drill = client.post(f"/api/reports/{report_id}/pivot-drill", headers=auth_headers, json={
        "rowGroupCols": ["regione"],
        "groupKeys": [],
        "valueCols": [{"colId": "fatturato", "aggFunc": "sum"}],
    })
    assert drill.status_code == 200, drill.text
    rows = drill.json()["rows"]
    nord = next(r for r in rows if "Nord" in r.values())
    assert any(v == 130.0 for v in nord.values())   # 100 + 30


def test_import_xlsx_endpoint(client, auth_headers, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "IMPORTS_DIR", str(tmp_path / "imports"))
    content = _xlsx_bytes(["prodotto", "qta"], [["A", 3], ["B", 7]])
    res = client.post(
        "/api/connections/import",
        headers=auth_headers,
        data={"name": "Magazzino XLSX"},
        files={"file": ("mag.xlsx", content,
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert res.status_code == 201, res.text
    assert res.json()["rows"] == 2
    assert res.json()["columns"] == ["prodotto", "qta"]


def test_import_requires_superuser(client, tmp_path):
    # senza token -> non autorizzato
    res = client.post(
        "/api/connections/import",
        data={"name": "X"},
        files={"file": ("x.csv", b"a,b\n1,2\n", "text/csv")},
    )
    assert res.status_code in (401, 403)
