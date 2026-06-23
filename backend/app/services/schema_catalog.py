"""
Catalogo schema: introspezione LIVE della sorgente (tabelle/colonne/tipi/PK/FK).
Sono "fatti tecnici" sempre aggiornati -> non si persistono (a differenza dei
metadati semantici, che sono arricchimento umano/AI in column_metadata).

Funziona su qualunque dialetto supportato (mssql/postgresql/mysql/sqlite/duckdb)
tramite SQLAlchemy Inspector.
"""
import logging
from typing import Any, Dict, List, Optional

from sqlalchemy import inspect

from app.core.engine_pool import get_engine

logger = logging.getLogger(__name__)


def semantic_type(sql_type: str) -> str:
    """Mappa un tipo SQL grezzo in tipo semantico: number | date | string | boolean."""
    t = (sql_type or "").lower()
    if any(k in t for k in ("int", "float", "double", "decimal", "numeric", "real", "money")):
        return "number"
    if any(k in t for k in ("date", "time", "timestamp")):
        return "date"
    if "bool" in t or "bit" in t:
        return "boolean"
    return "string"


def list_tables(db_type: str, config: Dict[str, Any], schema: Optional[str] = None) -> Dict[str, Any]:
    """Elenca tabelle e viste della sorgente (solo nomi: leggero)."""
    engine = get_engine(db_type, config)
    insp = inspect(engine)
    tables = list(insp.get_table_names(schema=schema))
    try:
        views = list(insp.get_view_names(schema=schema))
    except Exception:
        views = []
    return {
        "tables": sorted(tables),
        "views": sorted(views),
        "schema": schema,
    }


def describe_table(
    db_type: str, config: Dict[str, Any], table: str, schema: Optional[str] = None
) -> Dict[str, Any]:
    """Dettaglio di una tabella: colonne (tipo/nullable/PK), chiavi esterne (relazioni)."""
    engine = get_engine(db_type, config)
    insp = inspect(engine)

    pk_cols = set((insp.get_pk_constraint(table, schema=schema) or {}).get("constrained_columns") or [])

    columns: List[Dict[str, Any]] = []
    for c in insp.get_columns(table, schema=schema):
        raw_type = str(c.get("type"))
        columns.append({
            "name": c["name"],
            "type": raw_type,
            "semantic_type": semantic_type(raw_type),
            "nullable": bool(c.get("nullable", True)),
            "primary_key": c["name"] in pk_cols,
        })

    foreign_keys: List[Dict[str, Any]] = []
    try:
        for fk in insp.get_foreign_keys(table, schema=schema):
            foreign_keys.append({
                "columns": fk.get("constrained_columns", []),
                "ref_table": fk.get("referred_table"),
                "ref_columns": fk.get("referred_columns", []),
            })
    except Exception:
        # alcuni driver/sorgenti non espongono le FK: non è un errore fatale
        pass

    return {
        "table": table,
        "schema": schema,
        "columns": columns,
        "foreign_keys": foreign_keys,
    }
