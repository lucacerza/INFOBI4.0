"""AI API: stato configurazione LLM (8.1) e NL -> Pivot (8.2)."""
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from typing import Any, Dict, List

from app.db.database import get_db, Report
from app.core.deps import get_current_user, get_current_superuser
from app.services import llm, nl_pivot, insights
from app.services.llm.base import LLMError

logger = logging.getLogger(__name__)
router = APIRouter()


class AskRequest(BaseModel):
    question: str


class InsightRequest(BaseModel):
    group_by: List[str] = []
    metrics: List[Dict[str, Any]] = []     # [{field, aggregation, name?}]
    filters: Dict[str, Any] = {}           # {field: {type, value|values}}


@router.get("/status")
async def ai_status(user=Depends(get_current_superuser)):
    """Stato della configurazione AI (provider, modello, fallback). SUPERUSER."""
    return llm.provider_info()


@router.post("/reports/{report_id}/ask")
async def ask_report(
    report_id: int,
    data: AskRequest,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Domanda in linguaggio naturale -> configurazione pivot validata.
    Ritorna {config, explanation}: il frontend applica la config alla pivot.
    """
    question = (data.question or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="Domanda vuota")

    report = (await db.execute(select(Report).where(Report.id == report_id))).scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report non trovato")

    try:
        return await nl_pivot.ask(db, report, llm.get_llm(), question)
    except ValueError as e:
        # config non valida o colonna inventata (guardrail anti-allucinazione)
        raise HTTPException(status_code=422, detail=str(e))
    except LLMError as e:
        logger.warning("AI non disponibile per report %s: %s", report_id, e)
        raise HTTPException(status_code=503, detail=f"AI non disponibile: {e}")


@router.post("/reports/{report_id}/insights")
async def report_insights(
    report_id: int,
    data: InsightRequest,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """
    Genera una narrazione testuale dei dati aggregati del report.
    Se group_by/metrics non sono forniti, usa i default del report.
    """
    report = (await db.execute(select(Report).where(Report.id == report_id))).scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report non trovato")

    group_by = data.group_by or report.default_group_by or []
    metrics = data.metrics or report.default_metrics or []
    if not metrics:
        raise HTTPException(status_code=400, detail="Nessuna misura: configura la pivot o i default del report")

    try:
        return await insights.narrate(db, report, llm.get_llm(), group_by, metrics, data.filters)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except LLMError as e:
        logger.warning("AI non disponibile per insight report %s: %s", report_id, e)
        raise HTTPException(status_code=503, detail=f"AI non disponibile: {e}")
