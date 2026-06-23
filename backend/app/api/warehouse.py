"""
Warehouse API (DuckDB).
Step A: materializza i report come tabelle "mart" piatte nel warehouse.
Il warehouse è una cache rigenerabile: il registro (warehouse_datasets) vive in
infobi.db (backuppato) e contiene tutto il necessario per ricostruirlo da zero.
"""
import logging
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.db.database import get_db, Report, Connection, WarehouseDataset
from app.core.deps import get_current_superuser
from app.core.security import decrypt_password
from app.services import warehouse, backup

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------- Schemi ----------
class DatasetResponse(BaseModel):
    id: int
    name: str
    table_name: str
    source_report_id: Optional[int] = None
    row_count: int
    status: str
    sync_mode: str = "full"
    watermark_column: Optional[str] = None
    last_watermark: Optional[str] = None
    last_error: Optional[str] = None
    last_sync_at: Optional[datetime] = None
    columns: list = []

    class Config:
        from_attributes = True


class CreateFromReport(BaseModel):
    report_id: int
    name: Optional[str] = None
    sync_mode: Optional[str] = None              # full | incremental
    watermark_column: Optional[str] = None
    key_columns: Optional[list] = None


# ---------- Helper ----------
def _config_of(connection: Connection) -> dict:
    return {
        "host": connection.host,
        "port": connection.port,
        "database": connection.database,
        "username": connection.username,
        "password": decrypt_password(connection.password_encrypted),
        "ssl_enabled": connection.ssl_enabled,
    }


async def _materialize(db: AsyncSession, ds: WarehouseDataset) -> WarehouseDataset:
    """Estrae dalla sorgente e (ri)materializza la tabella. Aggiorna stato/errore/righe."""
    connection = (await db.execute(
        select(Connection).where(Connection.id == ds.source_connection_id)
    )).scalar_one_or_none()
    if not connection:
        raise HTTPException(status_code=400, detail="Connessione sorgente non trovata")

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
        logger.exception("Materializzazione fallita per dataset %s", ds.id)
        ds.status = "error"
        ds.last_error = str(e)
        await db.commit()
        raise HTTPException(status_code=400, detail=f"Materializzazione fallita: {e}")

    await db.commit()
    await db.refresh(ds)
    return ds


# ---------- Endpoint ----------
@router.get("", response_model=List[DatasetResponse])
async def list_datasets(
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_superuser),
):
    """Elenca i dataset materializzati (SUPERUSER ONLY)."""
    rows = (await db.execute(
        select(WarehouseDataset).order_by(WarehouseDataset.name)
    )).scalars().all()
    return rows


@router.post("/from-report", response_model=DatasetResponse, status_code=status.HTTP_201_CREATED)
async def create_from_report(
    data: CreateFromReport,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_superuser),
):
    """Materializza un report come tabella mart nel warehouse (SUPERUSER ONLY)."""
    report = (await db.execute(
        select(Report).where(Report.id == data.report_id)
    )).scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report non trovato")

    if data.sync_mode is not None and data.sync_mode not in ("full", "incremental"):
        raise HTTPException(status_code=400, detail="sync_mode non valido (full|incremental)")
    if data.sync_mode == "incremental" and not (data.watermark_column or "").strip():
        raise HTTPException(status_code=400, detail="La modalità incrementale richiede watermark_column")

    table_name = warehouse.sanitize_table(f"mart_report_{report.id}")

    # Un dataset per report (riusa se esiste)
    ds = (await db.execute(
        select(WarehouseDataset).where(WarehouseDataset.source_report_id == report.id)
    )).scalar_one_or_none()
    if ds is None:
        ds = WarehouseDataset(
            name=data.name or report.name,
            table_name=table_name,
            source_connection_id=report.connection_id,
            source_report_id=report.id,
            source_query=report.query,
            sync_mode=data.sync_mode or "full",
            watermark_column=data.watermark_column,
            key_columns=data.key_columns or [],
        )
        db.add(ds)
        await db.commit()
        await db.refresh(ds)
    else:
        # aggiorna ricetta in caso la query del report sia cambiata
        ds.source_query = report.query
        ds.source_connection_id = report.connection_id
        if data.name:
            ds.name = data.name
        if data.sync_mode is not None:
            ds.sync_mode = data.sync_mode
        if data.watermark_column is not None:
            ds.watermark_column = data.watermark_column
        if data.key_columns is not None:
            ds.key_columns = data.key_columns
        await db.commit()

    return await _materialize(db, ds)


@router.post("/{dataset_id}/refresh", response_model=DatasetResponse)
async def refresh_dataset(
    dataset_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_superuser),
):
    """Ri-materializza un singolo dataset dalla sorgente (SUPERUSER ONLY)."""
    ds = (await db.execute(
        select(WarehouseDataset).where(WarehouseDataset.id == dataset_id)
    )).scalar_one_or_none()
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset non trovato")
    return await _materialize(db, ds)


@router.post("/rebuild-all")
async def rebuild_all(
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_superuser),
):
    """Ricostruisce l'intero warehouse dal registro (recupero da corruzione). SUPERUSER ONLY."""
    rows = (await db.execute(select(WarehouseDataset))).scalars().all()
    results = []
    for ds in rows:
        try:
            await _materialize(db, ds)
            results.append({"id": ds.id, "name": ds.name, "status": "ready", "rows": ds.row_count})
        except HTTPException as e:
            results.append({"id": ds.id, "name": ds.name, "status": "error", "detail": e.detail})
    return {"rebuilt": len(results), "datasets": results}


@router.post("/backup")
async def backup_warehouse_now(
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_superuser),
):
    """Crea subito un backup del file warehouse (SUPERUSER)."""
    dest = await run_in_threadpool(backup.backup_warehouse)
    if dest is None:
        raise HTTPException(status_code=404, detail="Warehouse non ancora creato: niente da copiare")
    return {"backup": dest.name}


@router.delete("/{dataset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dataset(
    dataset_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_superuser),
):
    """Elimina un dataset (droppa la tabella DuckDB + rimuove dal registro). SUPERUSER ONLY."""
    ds = (await db.execute(
        select(WarehouseDataset).where(WarehouseDataset.id == dataset_id)
    )).scalar_one_or_none()
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset non trovato")
    await run_in_threadpool(warehouse.drop_table, ds.table_name)
    await db.delete(ds)
    await db.commit()
