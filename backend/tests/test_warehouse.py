"""Test del servizio warehouse DuckDB (Step A)."""
import sqlite3

import polars as pl
import pytest

from app.services import warehouse
from app.core.config import settings


@pytest.fixture(autouse=True)
def _warehouse_dir(tmp_path, monkeypatch):
    """Isola il warehouse in una cartella temporanea per ogni test."""
    monkeypatch.setattr(settings, "WAREHOUSE_DIR", str(tmp_path / "wh"))


def test_sanitize_table():
    assert warehouse.sanitize_table("mart_report_1") == "mart_report_1"
    assert warehouse.sanitize_table("Vendite 2024 (€)") == "vendite_2024"
    assert warehouse.sanitize_table("123tab") == "t_123tab"
    assert warehouse.sanitize_table("!!!") == "dataset"


def test_materialize_df_and_query():
    df = pl.DataFrame({
        "regione": ["Nord", "Sud", "Nord"],
        "fatturato": [100.0, 50.0, 30.0],
    })
    n, cols = warehouse.materialize_df("mart_test", df)
    assert n == 3
    names = [c["name"] for c in cols]
    assert names == ["regione", "fatturato"]

    # Aggregazione analitica sul warehouse
    t = warehouse.query_arrow(
        'SELECT regione, SUM(fatturato) AS tot FROM "mart_test" GROUP BY regione ORDER BY regione'
    )
    out = pl.from_arrow(t).sort("regione")
    assert out["regione"].to_list() == ["Nord", "Sud"]
    assert out["tot"].to_list() == [130.0, 50.0]


def test_materialize_replaces_existing():
    warehouse.materialize_df("mart_repl", pl.DataFrame({"a": [1, 2, 3]}))
    n, _ = warehouse.materialize_df("mart_repl", pl.DataFrame({"a": [9]}))
    assert n == 1  # CREATE OR REPLACE -> non accumula


def test_materialize_from_sqlite_source(tmp_path):
    """Estrae da una sorgente SQLite reale e materializza nel warehouse."""
    src = tmp_path / "source.db"
    conn = sqlite3.connect(str(src))
    conn.execute("CREATE TABLE vendite (regione TEXT, importo REAL)")
    conn.executemany(
        "INSERT INTO vendite VALUES (?, ?)",
        [("Nord", 100.0), ("Sud", 50.0), ("Nord", 25.0)],
    )
    conn.commit()
    conn.close()

    config = {"database": str(src)}
    n, cols = warehouse.materialize_from_source(
        "mart_vendite", "sqlite", config, "SELECT regione, importo FROM vendite"
    )
    assert n == 3
    assert {c["name"] for c in cols} == {"regione", "importo"}

    t = warehouse.query_arrow('SELECT COUNT(*) AS c FROM "mart_vendite"')
    assert pl.from_arrow(t)["c"].to_list() == [3]


def test_drop_table():
    warehouse.materialize_df("mart_drop", pl.DataFrame({"a": [1]}))
    warehouse.drop_table("mart_drop")
    with pytest.raises(Exception):
        warehouse.query_arrow('SELECT * FROM "mart_drop"')
