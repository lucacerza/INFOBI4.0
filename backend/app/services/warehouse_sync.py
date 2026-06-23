"""
Sincronizzazione dataset warehouse: logica condivisa tra API (refresh manuale)
e scheduler (refresh automatico). Decide full vs incrementale e aggiorna lo stato.
"""
import logging
from datetime import datetime
from typing import Any, Dict, List

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import AsyncSessionLocal, Connection, WarehouseDataset
from app.core.security import decrypt_password
from app.services import warehouse

logger = logging.getLogger(__name__)


def _config_of(connection: Connection) -> dict:
    return {
        "host": connection.host,
        "port": connection.port,
        "database": connection.database,
        "username": connection.username,
        "password": decrypt_password(connection.password_encrypted),
        "ssl_enabled": connection.ssl_enabled,
    }


async def sync_dataset(db: AsyncSession, ds: WarehouseDataset) -> WarehouseDataset:
    """(Ri)materializza un dataset (full o incrementale). Aggiorna stato/righe/watermark.
    Solleva ValueError se la connessione manca; rilancia gli errori di materializzazione
    dopo aver marcato il dataset come 'error'."""
    connection = (await db.execute(
        select(Connection).where(Connection.id == ds.source_connection_id)
    )).scalar_one_or_none()
    if not connection:
        raise ValueError("Connessione sorgente non trovata")

    ds.status = "syncing"
    ds.last_error = None
    await db.commit()

    try:
        config = _config_of(connection)
        if ds.sync_mode == "incremental" and ds.watermark_column:
            result = await run_in_threadpool(
                warehouse.materialize_incremental,
                ds.table_name, connection.db_type, config, ds.source_query,
                ds.watermark_column, ds.last_watermark, ds.key_columns or [],
            )
            ds.row_count = result["total_rows"]
            ds.columns = result["columns"]
            ds.last_watermark = result["watermark"]
        else:
            row_count, columns = await run_in_threadpool(
                warehouse.materialize_from_source,
                ds.table_name, connection.db_type, config, ds.source_query,
            )
            ds.row_count = row_count
            ds.columns = columns
        ds.status = "ready"
        ds.last_sync_at = datetime.utcnow()
    except Exception as e:
        logger.exception("Sync fallito per dataset %s", ds.id)
        ds.status = "error"
        ds.last_error = str(e)
        await db.commit()
        raise

    await db.commit()
    await db.refresh(ds)
    return ds


async def refresh_all() -> Dict[str, Any]:
    """Rinfresca tutti i dataset (usata dallo scheduler). Apre una sessione propria."""
    summary: List[Dict[str, Any]] = []
    async with AsyncSessionLocal() as db:
        datasets = list((await db.execute(select(WarehouseDataset))).scalars().all())
        for ds in datasets:
            try:
                await sync_dataset(db, ds)
                summary.append({"id": ds.id, "name": ds.name, "status": "ready", "rows": ds.row_count})
            except Exception as e:
                summary.append({"id": ds.id, "name": ds.name, "status": "error", "detail": str(e)})
    logger.info("🔄 Warehouse sync schedulato: %d dataset", len(summary))
    return {"synced": len(summary), "datasets": summary}
