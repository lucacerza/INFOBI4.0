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
from app.services.query_engine import QueryEngine

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
    """Estrae il risultato di `query` dalla sorgente e lo materializza nel warehouse."""
    df = QueryEngine._execute_df_with_params_sync(db_type, config, query, {})
    return materialize_df(table_name, df)


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
