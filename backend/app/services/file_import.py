"""
Import di file Excel/CSV come sorgente SQLite locale.

Legge il file con Polars, lo scrive in un DB SQLite (un file per import) con
una tabella `data`. Diventa così una sorgente come le altre: pivot, dashboard,
AI e warehouse funzionano a valle senza modifiche.
"""
import io
import logging
import sqlite3
from pathlib import Path
from typing import List, Tuple

import polars as pl

logger = logging.getLogger(__name__)

CSV_EXT = {"csv", "txt", "tsv"}
EXCEL_EXT = {"xlsx", "xlsm"}
DEFAULT_TABLE = "data"


def parse_dataframe(filename: str, content: bytes) -> pl.DataFrame:
    """Legge il contenuto del file in un DataFrame Polars (CSV o Excel)."""
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    buf = io.BytesIO(content)
    if ext in CSV_EXT:
        sep = "\t" if ext == "tsv" else ","
        df = pl.read_csv(buf, separator=sep, infer_schema_length=1000)
    elif ext in EXCEL_EXT:
        df = pl.read_excel(buf, engine="openpyxl")
    else:
        raise ValueError(f"Formato non supportato: .{ext} (usa CSV o XLSX)")

    if df.height == 0 or df.width == 0:
        raise ValueError("Il file non contiene dati")
    return df


def _sqlite_type(dtype) -> str:
    s = str(dtype).lower()
    if "int" in s:
        return "INTEGER"
    if "float" in s or "decimal" in s:
        return "REAL"
    return "TEXT"


def _safe_col(name: str, i: int) -> str:
    return (name or f"col_{i}").replace('"', '""')


def _clean(value):
    # sqlite3 (Py 3.12) accetta solo str/int/float/bytes/None: converte il resto (es. date)
    if value is None or isinstance(value, (int, float, str, bytes)):
        return value
    return str(value)


def write_sqlite(df: pl.DataFrame, db_path: Path, table: str = DEFAULT_TABLE) -> Tuple[int, List[str]]:
    """Scrive il DataFrame in una tabella SQLite (sostituendola). Ritorna (righe, colonne)."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    cols = df.columns
    coldefs = ", ".join(
        f'"{_safe_col(c, i)}" {_sqlite_type(df.schema[c])}' for i, c in enumerate(cols)
    )
    placeholders = ", ".join(["?"] * len(cols))
    rows = [tuple(_clean(v) for v in row) for row in df.iter_rows()]

    con = sqlite3.connect(str(db_path))
    try:
        con.execute(f'DROP TABLE IF EXISTS "{table}"')
        con.execute(f'CREATE TABLE "{table}" ({coldefs})')
        con.executemany(f'INSERT INTO "{table}" VALUES ({placeholders})', rows)
        con.commit()
    finally:
        con.close()
    return len(rows), cols


def import_file(filename: str, content: bytes, db_path: Path, table: str = DEFAULT_TABLE) -> Tuple[int, List[str]]:
    """Pipeline completa: parse + scrittura SQLite. Ritorna (righe, colonne)."""
    df = parse_dataframe(filename, content)
    return write_sqlite(df, db_path, table)
