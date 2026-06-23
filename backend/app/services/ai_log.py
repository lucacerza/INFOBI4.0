"""
Log delle traduzioni AI (governance/audit/feedback).
Registra ogni richiesta NL->pivot / insight con esito ed eventuale feedback.
"""
import logging
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import AITranslationLog

logger = logging.getLogger(__name__)


async def record(
    db: AsyncSession,
    *,
    username: Optional[str],
    report_id: Optional[int],
    kind: str,
    question: str,
    result: Optional[Dict[str, Any]] = None,
    status: str = "ok",
    error: Optional[str] = None,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    latency_ms: Optional[int] = None,
) -> AITranslationLog:
    entry = AITranslationLog(
        username=username,
        report_id=report_id,
        kind=kind,
        question=question,
        result=result or {},
        status=status,
        error=error,
        provider=provider,
        model=model,
        latency_ms=latency_ms,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry


async def list_logs(
    db: AsyncSession, limit: int = 100, report_id: Optional[int] = None
) -> List[AITranslationLog]:
    q = select(AITranslationLog).order_by(AITranslationLog.timestamp.desc()).limit(limit)
    if report_id is not None:
        q = q.where(AITranslationLog.report_id == report_id)
    return list((await db.execute(q)).scalars().all())


async def set_feedback(
    db: AsyncSession, log_id: int, helpful: bool, note: Optional[str] = None
) -> Optional[AITranslationLog]:
    entry = (await db.execute(
        select(AITranslationLog).where(AITranslationLog.id == log_id)
    )).scalar_one_or_none()
    if entry is None:
        return None
    entry.helpful = helpful
    if note is not None:
        entry.feedback_note = note
    await db.commit()
    await db.refresh(entry)
    return entry
