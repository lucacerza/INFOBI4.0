"""
Semantic layer API: metadati semantici per colonna di un report.
- lettura: ogni utente autenticato (serve a UI e, in futuro, all'AI)
- scrittura/autodetect: superuser (fa parte della definizione del report)
"""
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.db.database import get_db, Report, ColumnMetadata
from app.core.deps import get_current_user, get_current_superuser
from app.services import semantic

logger = logging.getLogger(__name__)
router = APIRouter()


class ColumnMetaResponse(BaseModel):
    id: int
    report_id: int
    column_name: str
    business_name: Optional[str] = None
    description: Optional[str] = None
    role: str
    data_type: str
    unit: Optional[str] = None
    format: Optional[str] = None
    default_aggregation: str
    is_hidden: bool
    extra: Optional[Dict[str, Any]] = {}

    class Config:
        from_attributes = True


class ColumnMetaUpdate(BaseModel):
    business_name: Optional[str] = None
    description: Optional[str] = None
    role: Optional[str] = None              # dimension | measure | time | attribute
    unit: Optional[str] = None
    format: Optional[str] = None
    default_aggregation: Optional[str] = None  # sum | avg | count | min | max | none
    is_hidden: Optional[bool] = None
    extra: Optional[Dict[str, Any]] = None


_VALID_ROLES = {"dimension", "measure", "time", "attribute"}
_VALID_AGGS = {"sum", "avg", "count", "min", "max", "none"}


async def _get_report(db: AsyncSession, report_id: int) -> Report:
    report = (await db.execute(select(Report).where(Report.id == report_id))).scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report non trovato")
    return report


@router.get("/reports/{report_id}", response_model=List[ColumnMetaResponse])
async def list_semantic(
    report_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """Metadati semantici delle colonne del report."""
    await _get_report(db, report_id)
    return await semantic.list_metadata(db, report_id)


@router.post("/reports/{report_id}/autodetect", response_model=List[ColumnMetaResponse])
async def autodetect_semantic(
    report_id: int,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_superuser),
):
    """Rileva automaticamente ruolo/tipo/aggregazione dalle colonne reali (SUPERUSER)."""
    report = await _get_report(db, report_id)
    try:
        return await semantic.autodetect(db, report)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Autodetect semantico fallito per report %s", report_id)
        raise HTTPException(status_code=400, detail=f"Autodetect fallito: {e}")


@router.put("/reports/{report_id}/columns/{column}", response_model=ColumnMetaResponse)
async def update_semantic(
    report_id: int,
    column: str,
    data: ColumnMetaUpdate,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_superuser),
):
    """Aggiorna i metadati semantici di una colonna (SUPERUSER)."""
    if data.role is not None and data.role not in _VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Ruolo non valido: {data.role}")
    if data.default_aggregation is not None and data.default_aggregation not in _VALID_AGGS:
        raise HTTPException(status_code=400, detail=f"Aggregazione non valida: {data.default_aggregation}")

    m = (await db.execute(
        select(ColumnMetadata).where(
            ColumnMetadata.report_id == report_id,
            ColumnMetadata.column_name == column,
        )
    )).scalar_one_or_none()
    if not m:
        raise HTTPException(status_code=404, detail="Metadato colonna non trovato (esegui prima l'autodetect)")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(m, field, value)
    m.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(m)
    return m
