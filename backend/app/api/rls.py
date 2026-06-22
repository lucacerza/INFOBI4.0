"""API gestione regole Row-Level Security (solo superuser)."""
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db, RlsRule
from app.core.deps import get_current_superuser

router = APIRouter()


class RlsRuleCreate(BaseModel):
    report_id: int
    subject_type: str           # 'user' | 'role'
    subject: str
    column: str
    allowed_values: List[Any] = []


def _serialize(r: RlsRule) -> dict:
    return {
        "id": r.id,
        "report_id": r.report_id,
        "subject_type": r.subject_type,
        "subject": r.subject,
        "column": r.column,
        "allowed_values": r.allowed_values or [],
    }


@router.get("")
async def list_rules(
    report_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    _user = Depends(get_current_superuser),
):
    query = select(RlsRule)
    if report_id is not None:
        query = query.where(RlsRule.report_id == report_id)
    rows = (await db.execute(query)).scalars().all()
    return [_serialize(r) for r in rows]


@router.post("")
async def create_rule(
    data: RlsRuleCreate,
    db: AsyncSession = Depends(get_db),
    _user = Depends(get_current_superuser),
):
    if data.subject_type not in ("user", "role"):
        raise HTTPException(status_code=400, detail="subject_type deve essere 'user' o 'role'")
    rule = RlsRule(
        report_id=data.report_id,
        subject_type=data.subject_type,
        subject=data.subject,
        column=data.column,
        allowed_values=data.allowed_values,
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return _serialize(rule)


@router.delete("/{rule_id}")
async def delete_rule(
    rule_id: int,
    db: AsyncSession = Depends(get_db),
    _user = Depends(get_current_superuser),
):
    rule = (await db.execute(select(RlsRule).where(RlsRule.id == rule_id))).scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Regola non trovata")
    await db.delete(rule)
    await db.commit()
    return {"success": True}
