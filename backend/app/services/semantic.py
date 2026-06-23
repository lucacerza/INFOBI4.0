"""
Semantic layer: gestione dei metadati semantici per colonna (column_metadata).
Include l'auto-rilevamento (ruolo/tipo/aggregazione di default) dalle colonne
reali del report — il seed del "modello" che l'AI userà.
"""
import logging
from typing import Any, Dict, List, Tuple

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.database import Report, ColumnMetadata
from app.services.query_engine import QueryEngine
from app.services.report_source import resolve_report_source
from app.services.schema_catalog import semantic_type

logger = logging.getLogger(__name__)


def infer(name: str, raw_type: str) -> Tuple[str, str, str]:
    """
    Inferisce (data_type, role, default_aggregation) da nome + tipo SQL.

    - data_type: number | date | string | boolean (semantico)
    - role: time (nome temporale) | measure (numerico) | dimension (resto)
    - default_aggregation: sum per le misure, none altrimenti
    """
    sem = semantic_type(raw_type)
    name_l = (name or "").lower()
    is_time_name = any((h or "").lower() in name_l for h in settings.SEMANTIC_TIME_HINTS)

    if sem == "date" or is_time_name:
        return sem, "time", "none"
    if sem == "number":
        return sem, "measure", "sum"
    return sem, "dimension", "none"


async def _report_columns(db: AsyncSession, report: Report) -> List[Tuple[str, str]]:
    """Estrae (nome, tipo_sql) delle colonne del report con una query a 1 riga."""
    db_type, config, base_query = await resolve_report_source(db, report)
    if db_type == "mssql":
        q = f"SELECT TOP 1 * FROM ({base_query}) AS s"
    else:
        q = f"SELECT * FROM ({base_query}) AS s LIMIT 1"
    arrow = await run_in_threadpool(QueryEngine._execute_query_sync, db_type, config, q)
    return [(f.name, str(f.type)) for f in arrow.schema]


async def list_metadata(db: AsyncSession, report_id: int) -> List[ColumnMetadata]:
    return list((await db.execute(
        select(ColumnMetadata)
        .where(ColumnMetadata.report_id == report_id)
        .order_by(ColumnMetadata.id)
    )).scalars().all())


async def autodetect(db: AsyncSession, report: Report) -> List[ColumnMetadata]:
    """
    Crea i metadati mancanti inferendoli dalle colonne reali del report.
    NON sovrascrive i valori già personalizzati: per le colonne esistenti
    aggiorna solo `data_type` (fatto tecnico), lasciando intatto il resto.
    """
    cols = await _report_columns(db, report)
    existing = {m.column_name: m for m in await list_metadata(db, report.id)}
    labels = report.column_labels or {}

    for name, raw_type in cols:
        data_type, role, default_agg = infer(name, raw_type)
        m = existing.get(name)
        if m is None:
            db.add(ColumnMetadata(
                report_id=report.id,
                column_name=name,
                business_name=labels.get(name) or name,
                role=role,
                data_type=data_type,
                default_aggregation=default_agg,
            ))
        else:
            # preserva l'arricchimento umano; aggiorna solo il tipo tecnico
            m.data_type = data_type

    await db.commit()
    return await list_metadata(db, report.id)
