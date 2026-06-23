"""Test del backup automatico del DB (Fase 2.4)."""
from pathlib import Path

from app.services import backup as backup_mod
from app.core.config import settings


def test_sqlite_path_parsing():
    assert backup_mod.sqlite_path_from_url("sqlite+aiosqlite:///./data/infobi.db").name == "infobi.db"
    assert backup_mod.sqlite_path_from_url("sqlite:///:memory:") is None
    assert backup_mod.sqlite_path_from_url("postgresql://user@host/db") is None


def test_backup_creates_file_and_rotates(tmp_path, monkeypatch):
    import sqlite3
    # DB sorgente auto-contenuto (indipendente dall'ordine dei test)
    src_db = tmp_path / "source.db"
    conn = sqlite3.connect(str(src_db))
    conn.execute("CREATE TABLE t (id INTEGER)")
    conn.execute("INSERT INTO t (id) VALUES (1)")
    conn.commit()
    conn.close()

    backups_dir = tmp_path / "backups"
    monkeypatch.setattr(settings, "DATABASE_URL", f"sqlite:///{src_db.as_posix()}")
    monkeypatch.setattr(settings, "BACKUP_DIR", str(backups_dir))
    monkeypatch.setattr(settings, "BACKUP_KEEP", 3)

    # Crea 5 backup con timestamp crescenti
    for i in range(5):
        dest = backup_mod.backup_database(timestamp=f"2026010100000{i}")
        assert dest is not None and Path(dest).exists()

    tmp_path = backups_dir  # le asserzioni successive guardano la cartella backup

    remaining = sorted(tmp_path.glob("infobi_*.db"))
    # Rotazione: conservati solo gli ultimi 3
    assert len(remaining) == 3
    names = [r.name for r in remaining]
    assert f"infobi_2026010100000{4}.db" in names      # il più recente resta
    assert f"infobi_2026010100000{0}.db" not in names  # i più vecchi rimossi


def test_backup_skips_when_not_sqlite(monkeypatch):
    monkeypatch.setattr(settings, "DATABASE_URL", "postgresql://user@host/db")
    assert backup_mod.backup_database(timestamp="x") is None


def test_warehouse_backup_and_rotation(tmp_path, monkeypatch):
    import duckdb
    import polars as pl
    from app.services import warehouse

    monkeypatch.setattr(settings, "WAREHOUSE_DIR", str(tmp_path / "wh"))
    monkeypatch.setattr(settings, "BACKUP_DIR", str(tmp_path / "backups"))
    monkeypatch.setattr(settings, "BACKUP_KEEP", 3)

    warehouse.materialize_df("mart_x", pl.DataFrame({"a": [1, 2, 3]}))

    for i in range(5):
        dest = backup_mod.backup_warehouse(timestamp=f"2026010100000{i}")
        assert dest is not None and dest.exists()

    backups = sorted((tmp_path / "backups").glob("warehouse_*.duckdb"))
    assert len(backups) == 3                       # rotazione: solo gli ultimi 3
    # il backup è un DuckDB valido e contiene i dati
    con = duckdb.connect(str(backups[-1]))
    assert con.execute('SELECT COUNT(*) FROM "mart_x"').fetchone()[0] == 3
    con.close()


def test_warehouse_backup_skips_when_absent(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "WAREHOUSE_DIR", str(tmp_path / "empty_wh"))
    assert backup_mod.backup_warehouse(timestamp="x") is None


def test_run_backups_runs_both(tmp_path, monkeypatch):
    import sqlite3
    import polars as pl
    from app.services import warehouse

    src_db = tmp_path / "source.db"
    conn = sqlite3.connect(str(src_db))
    conn.execute("CREATE TABLE t (id INTEGER)")
    conn.commit()
    conn.close()

    monkeypatch.setattr(settings, "DATABASE_URL", f"sqlite:///{src_db.as_posix()}")
    monkeypatch.setattr(settings, "WAREHOUSE_DIR", str(tmp_path / "wh"))
    monkeypatch.setattr(settings, "BACKUP_DIR", str(tmp_path / "bk"))
    warehouse.materialize_df("mart_y", pl.DataFrame({"a": [1]}))

    created = backup_mod.run_backups(timestamp="20260101_000000")
    names = [p.name for p in created]
    assert any(n.startswith("infobi_") for n in names)
    assert any(n.startswith("warehouse_") for n in names)
