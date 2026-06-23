"""AI API: stato configurazione LLM (8.1) e NL -> Pivot (8.2)."""
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.db.database import get_db, Report
from app.core.deps import get_current_user, get_current_superuser
from app.services import llm, nl_pivot
from app.services.llm.base import LLMError

logger = logging.getLogger(__name__)
router = APIRouter()


class AskRequest(BaseModel):
    question: str


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
