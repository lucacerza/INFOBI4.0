"""
Datawarehouse su DuckDB (file unico).
Step A: materializzazione "mart" piatti per-report (estrai dalla sorgente -> tabella DuckDB).
Le analisi (pivot) potranno girare su DuckDB -> dialetto unico + performance.
"""
import re
import logging
import pathlib
from typing import Any, Dict, List, Optional, Tuple

import duckdb
import polars as pl
import pyarrow as pa

from app.core.config import settings
from app.services.query_engine import QueryEngine, _sanitize_column_name

logger = logging.getLogger(__name__)


def warehouse_path() -> pathlib.Path:
    d = pathlib.Path(settings.WAREHOUSE_DIR)
    d.mkdir(parents=True, exist_ok=True)
    return d / "warehouse.duckdb"


def sanitize_table(name: str) -> str:
    """Nome tabella DuckDB sicuro (alfanumerico/underscore, non inizia con cifra)."""
    s = re.sub(r"[^A-Za-z0-9_]", "_", name).strip("_") or "dataset"
    if s[0].isdigit():
        s = "t_" + s
    return s.lower()


def columns_of(df: pl.DataFrame) -> List[Dict[str, str]]:
    return [{"name": c, "dtype": str(df.schema[c])} for c in df.columns]


def materialize_df(table_name: str, df: pl.DataFrame) -> Tuple[int, List[Dict[str, str]]]:
    """Scrive (sostituendo) un DataFrame Polars in una tabella DuckDB. Ritorna (righe, colonne)."""
    table = sanitize_table(table_name)
    con = duckdb.connect(str(warehouse_path()))
    try:
        arrow = df.to_arrow()
        con.register("incoming", arrow)
        con.execute(f'CREATE OR REPLACE TABLE "{table}" AS SELECT * FROM incoming')
        con.unregister("incoming")
        n = con.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
        return int(n), columns_of(df)
    finally:
        con.close()


def materialize_from_source(
    table_name: str, db_type: str, config: Dict[str, Any], query: str
) -> Tuple[int, List[Dict[str, str]]]:
    """Estrae il risultato di `query` dalla sorgente e lo materializza nel warehouse (full refresh)."""
    df = QueryEngine._execute_df_with_params_sync(db_type, config, query, {})
    return materialize_df(table_name, df)


def table_exists(table_name: str) -> bool:
    table = sanitize_table(table_name)
    con = duckdb.connect(str(warehouse_path()))
    try:
        row = con.execute(
            "SELECT 1 FROM information_schema.tables WHERE table_name = ?", [table]
        ).fetchone()
        return row is not None
    finally:
        con.close()


def _append_df(table_name: str, df: pl.DataFrame) -> int:
    """Aggiunge le righe di df alla tabella esistente. Ritorna il totale righe."""
    table = sanitize_table(table_name)
    con = duckdb.connect(str(warehouse_path()))
    try:
        con.register("incoming", df.to_arrow())
        con.execute(f'INSERT INTO "{table}" SELECT * FROM incoming')
        con.unregister("incoming")
        return int(con.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0])
    finally:
        con.close()


def _merge_df(table_name: str, df: pl.DataFrame, key_columns: List[str]) -> int:
    """
    Upsert idempotente sulla chiave: elimina dal mart le righe con le chiavi in
    arrivo, poi inserisce le nuove. Gestisce sia insert sia update. Ritorna il totale.
    """
    table = sanitize_table(table_name)
    keys = [_sanitize_column_name(k) for k in key_columns if k]
    if not keys:
        return _append_df(table_name, df)

    key_list = ", ".join(f'"{k}"' for k in keys)
    # row-value IN per chiavi composite; singola colonna senza parentesi
    lhs = f"({key_list})" if len(keys) > 1 else f'"{keys[0]}"'

    con = duckdb.connect(str(warehouse_path()))
    try:
        con.register("incoming", df.to_arrow())
        con.execute(f'DELETE FROM "{table}" WHERE {lhs} IN (SELECT {key_list} FROM incoming)')
        con.execute(f'INSERT INTO "{table}" SELECT * FROM incoming')
        con.unregister("incoming")
        return int(con.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0])
    finally:
        con.close()


def _coerce(value: Optional[str]) -> Any:
    """Ricoercizza il watermark salvato (stringa) al tipo plausibile per il confronto SQL."""
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        pass
    try:
        return float(value)
    except (TypeError, ValueError):
        return value  # es. data ISO: il confronto lessicografico è corretto


def materialize_incremental(
    table_name: str,
    db_type: str,
    config: Dict[str, Any],
    query: str,
    watermark_column: str,
    last_watermark: Optional[str],
    key_columns: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Carico incrementale basato su watermark.
    - Primo carico (o tabella assente): full create + watermark iniziale.
    - Carichi successivi: estrae solo `watermark_column > last_watermark` e
      o appende (append-only) o fa merge/upsert su `key_columns` (gestisce gli update).
    Ritorna {rows_added, total_rows, watermark, columns, mode}.
    """
    wm_col = _sanitize_column_name(watermark_column)
    base = f"SELECT * FROM ({query}) AS _src"

    first_load = last_watermark is None or not table_exists(table_name)

    if first_load:
        df = QueryEngine._execute_df_with_params_sync(db_type, config, base, {})
        total, columns = materialize_df(table_name, df)
        rows_added = total
        mode = "initial"
    else:
        delta_sql = f'{base} WHERE "{wm_col}" > :wm'
        df = QueryEngine._execute_df_with_params_sync(db_type, config, delta_sql, {"wm": _coerce(last_watermark)})
        rows_added = df.height
        columns = columns_of(df)
        if not rows_added:
            total = _count(table_name)
            mode = "noop"
        elif key_columns:
            total = _merge_df(table_name, df, key_columns)
            mode = "merge"
        else:
            total = _append_df(table_name, df)
            mode = "append"

    # avanza il watermark al massimo tra le righe appena caricate
    new_watermark = last_watermark
    if df.height and wm_col in df.columns:
        col_max = df[wm_col].max()
        if col_max is not None:
            new_watermark = str(col_max)

    return {
        "rows_added": rows_added,
        "total_rows": total,
        "watermark": new_watermark,
        "columns": columns,
        "mode": mode,
    }


def _count(table_name: str) -> int:
    table = sanitize_table(table_name)
    con = duckdb.connect(str(warehouse_path()))
    try:
        return int(con.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0])
    finally:
        con.close()


def query_arrow(sql: str, params: Optional[list] = None) -> pa.Table:
    """Esegue SQL analitico sul warehouse e ritorna una tabella Arrow."""
    con = duckdb.connect(str(warehouse_path()))
    try:
        rel = con.execute(sql, params or [])
        return rel.arrow()
    finally:
        con.close()


def drop_table(table_name: str) -> None:
    table = sanitize_table(table_name)
    con = duckdb.connect(str(warehouse_path()))
    try:
        con.execute(f'DROP TABLE IF EXISTS "{table}"')
    finally:
        con.close()
