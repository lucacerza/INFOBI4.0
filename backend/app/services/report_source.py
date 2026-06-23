"""
Risoluzione della sorgente di esecuzione di un report.

Punto unico che decide SE una query (pivot/grid/schema/distinct) gira sul
warehouse DuckDB (mart materializzato) o sulla sorgente live. Tutto il resto
del motore query resta invariato: cambia solo la tripla (db_type, config, base_query).
"""
import logging
from typing import Optional, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import Report, Connection, WarehouseDataset
from app.core.security import decrypt_password
from app.services.query_engine import QueryEngine
from app.services import warehouse

logger = logging.getLogger(__name__)

# Tripla di esecuzione: (db_type, config, base_query)
ExecTarget = Tuple[str, dict, str]


def _live_config(connection: Connection) -> dict:
    return {
        "host": connection.host,
        "port": connection.port,
        "database": connection.database,
        "username": connection.username,
        "password": decrypt_password(connection.password_encrypted),
        "ssl_enabled": connection.ssl_enabled,
    }


async def _ready_dataset(db: AsyncSession, report_id: int) -> Optional[WarehouseDataset]:
    return (await db.execute(
        select(WarehouseDataset).where(
            WarehouseDataset.source_report_id == report_id,
            WarehouseDataset.status == "ready",
        )
    )).scalar_one_or_none()


async def resolve_report_source(
    db: AsyncSession,
    report: Report,
    connection: Optional[Connection] = None,
    *,
    warm: bool = True,
) -> ExecTarget:
    """
    Restituisce (db_type, config, base_query) per eseguire le query del report.

    - Se il report è `warehouse_backed` e il suo mart è materializzato (status ready),
      punta al warehouse DuckDB: base_query = SELECT * FROM "<mart>".
    - Altrimenti usa la sorgente live (e, se richiesto, scalda il pool).

    `connection` può essere passata se già caricata (evita una query); se serve
    il fallback live e non è fornita, viene caricata qui.
    """
    if getattr(report, "warehouse_backed", False):
        ds = await _ready_dataset(db, report.id)
        if ds is not None:
            base_query = f'SELECT * FROM "{ds.table_name}"'
            config = {"database": str(warehouse.warehouse_path())}
            logger.info("Report %s -> warehouse (%s)", report.id, ds.table_name)
            return "duckdb", config, base_query
        logger.info("Report %s warehouse-backed ma mart non pronto: fallback live", report.id)

    # Sorgente live
    if connection is None:
        connection = (await db.execute(
            select(Connection).where(Connection.id == report.connection_id)
        )).scalar_one_or_none()
    if connection is None:
        raise ValueError("Connessione non trovata")

    config = _live_config(connection)
    if warm:
        QueryEngine.ensure_pool_warm(connection.db_type, config)
    return connection.db_type, config, report.query
