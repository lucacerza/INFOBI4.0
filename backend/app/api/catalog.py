"""
Catalogo schema API: introspezione live delle sorgenti (base conoscitiva per l'AI).
Superuser-only (espone la struttura dei DB sorgente).
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db, Connection
from app.core.deps import get_current_superuser
from app.core.security import decrypt_password
from app.services import schema_catalog

logger = logging.getLogger(__name__)
router = APIRouter()


def _config_of(connection: Connection) -> dict:
    return {
        "host": connection.host,
        "port": connection.port,
        "database": connection.database,
        "username": connection.username,
        "password": decrypt_password(connection.password_encrypted),
        "ssl_enabled": connection.ssl_enabled,
    }


async def _get_connection(db: AsyncSession, conn_id: int) -> Connection:
    connection = (await db.execute(
        select(Connection).where(Connection.id == conn_id)
    )).scalar_one_or_none()
    if not connection:
        raise HTTPException(status_code=404, detail="Connessione non trovata")
    return connection


@router.get("/connections/{conn_id}/tables")
async def list_tables(
    conn_id: int,
    schema: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_superuser),
):
    """Elenca tabelle e viste della sorgente (SUPERUSER ONLY)."""
    connection = await _get_connection(db, conn_id)
    try:
        return await run_in_threadpool(
            schema_catalog.list_tables, connection.db_type, _config_of(connection), schema
        )
    except Exception as e:
        logger.exception("Introspezione tabelle fallita per connessione %s", conn_id)
        raise HTTPException(status_code=400, detail=f"Introspezione fallita: {e}")


@router.get("/connections/{conn_id}/tables/{table}")
async def describe_table(
    conn_id: int,
    table: str,
    schema: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_superuser),
):
    """Dettaglio colonne + relazioni (FK) di una tabella (SUPERUSER ONLY)."""
    connection = await _get_connection(db, conn_id)
    try:
        return await run_in_threadpool(
            schema_catalog.describe_table, connection.db_type, _config_of(connection), table, schema
        )
    except Exception as e:
        logger.exception("Introspezione tabella %s fallita (conn %s)", table, conn_id)
        raise HTTPException(status_code=400, detail=f"Introspezione fallita: {e}")
