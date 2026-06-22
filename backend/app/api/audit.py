"""Audit log API - sola lettura, riservata ai superuser."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db, AuditLog
from app.core.deps import get_current_superuser

router = APIRouter()


@router.get("")
async def list_audit(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _user = Depends(get_current_superuser),
):
    """Elenca le voci di audit piu' recenti (paginazione)."""
    result = await db.execute(
        select(AuditLog).order_by(desc(AuditLog.timestamp)).limit(limit).offset(offset)
    )
    rows = result.scalars().all()
    return [
        {
            "id": r.id,
            "timestamp": r.timestamp.isoformat() if r.timestamp else None,
            "username": r.username,
            "action": r.action,
            "method": r.method,
            "path": r.path,
            "status_code": r.status_code,
            "success": r.success,
            "ip_address": r.ip_address,
            "detail": r.detail,
        }
        for r in rows
    ]
