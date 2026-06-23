"""AI API: stato LLM (8.1), NL->Pivot (8.2), insight (8.3), governance/log (8.4)."""
import time
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.db.database import get_db, Report, AITranslationLog, Dashboard, DashboardWidget
from app.core.deps import get_current_user, get_current_admin, get_current_superuser
from app.services import llm, nl_pivot, insights, ai_log, nl_dashboard, anomaly, forecast
from app.services.llm.base import LLMError

logger = logging.getLogger(__name__)
router = APIRouter()


class AskRequest(BaseModel):
    question: str


class InsightRequest(BaseModel):
    group_by: List[str] = []
    metrics: List[Dict[str, Any]] = []     # [{field, aggregation, name?}]
    filters: Dict[str, Any] = {}           # {field: {type, value|values}}


class FeedbackRequest(BaseModel):
    helpful: bool
    note: Optional[str] = None


class DashboardRequest(BaseModel):
    description: str


class AnomalyRequest(BaseModel):
    group_by: List[str]
    metric: Dict[str, Any]                 # {field, aggregation, name?}
    filters: Dict[str, Any] = {}
    method: str = "zscore"                 # zscore | iqr
    threshold: float = 3.0


class ForecastRequest(BaseModel):
    time_field: str
    metric: Dict[str, Any]                 # {field, aggregation, name?}
    periods: int = 3
    filters: Dict[str, Any] = {}


def _elapsed_ms(start: float) -> int:
    return int((time.perf_counter() - start) * 1000)


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
    Ogni richiesta viene loggata (governance/feedback).
    """
    question = (data.question or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="Domanda vuota")

    report = (await db.execute(select(Report).where(Report.id == report_id))).scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report non trovato")

    info = llm.provider_info()
    start = time.perf_counter()

    async def log(status: str, result=None, error=None):
        return await ai_log.record(
            db, username=getattr(user, "username", None), report_id=report_id,
            kind="pivot", question=question, result=result, status=status, error=error,
            provider=info["provider"], model=info["model"], latency_ms=_elapsed_ms(start),
        )

    try:
        result = await nl_pivot.ask(db, report, llm.get_llm(), question)
        entry = await log("ok", result=result.get("config"))
        result["log_id"] = entry.id
        return result
    except ValueError as e:
        # guardrail anti-allucinazione / config non valida
        await log("rejected", error=str(e))
        raise HTTPException(status_code=422, detail=str(e))
    except LLMError as e:
        await log("error", error=str(e))
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

    info = llm.provider_info()
    start = time.perf_counter()
    question = f"insight(group_by={group_by})"

    async def log(status: str, result=None, error=None):
        return await ai_log.record(
            db, username=getattr(user, "username", None), report_id=report_id,
            kind="insight", question=question, result=result, status=status, error=error,
            provider=info["provider"], model=info["model"], latency_ms=_elapsed_ms(start),
        )

    try:
        result = await insights.narrate(db, report, llm.get_llm(), group_by, metrics, data.filters)
        entry = await log("ok", result={"row_count": result.get("row_count")})
        result["log_id"] = entry.id
        return result
    except ValueError as e:
        await log("rejected", error=str(e))
        raise HTTPException(status_code=422, detail=str(e))
    except LLMError as e:
        await log("error", error=str(e))
        logger.warning("AI non disponibile per insight report %s: %s", report_id, e)
        raise HTTPException(status_code=503, detail=f"AI non disponibile: {e}")


@router.post("/reports/{report_id}/dashboard")
async def ai_dashboard(
    report_id: int,
    data: DashboardRequest,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_admin),
):
    """
    Descrizione in linguaggio naturale -> dashboard creata con i widget proposti.
    Crea una nuova dashboard (sui dati del report) e ritorna il suo id.
    """
    description = (data.description or "").strip()
    if not description:
        raise HTTPException(status_code=400, detail="Descrizione vuota")

    report = (await db.execute(select(Report).where(Report.id == report_id))).scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report non trovato")

    info = llm.provider_info()
    start = time.perf_counter()

    async def log(status: str, result=None, error=None):
        return await ai_log.record(
            db, username=getattr(user, "username", None), report_id=report_id,
            kind="dashboard", question=description, result=result, status=status, error=error,
            provider=info["provider"], model=info["model"], latency_ms=_elapsed_ms(start),
        )

    try:
        spec = await nl_dashboard.design(db, report, llm.get_llm(), description)
    except ValueError as e:
        await log("rejected", error=str(e))
        raise HTTPException(status_code=422, detail=str(e))
    except LLMError as e:
        await log("error", error=str(e))
        logger.warning("AI dashboard non disponibile per report %s: %s", report_id, e)
        raise HTTPException(status_code=503, detail=f"AI non disponibile: {e}")

    # Persiste la dashboard + i widget
    dashboard = Dashboard(
        name=spec["title"],
        description=f"Generata dall'AI: {description[:200]}",
        created_by=user.id,
    )
    db.add(dashboard)
    await db.commit()
    await db.refresh(dashboard)

    for w in spec["widgets"]:
        db.add(DashboardWidget(
            dashboard_id=dashboard.id,
            report_id=report_id,
            widget_type=w["widget_type"],
            title=w["title"],
            config=w["config"],
            position=w["position"],
        ))
    await db.commit()

    await log("ok", result={"dashboard_id": dashboard.id, "widgets": len(spec["widgets"])})
    return {
        "dashboard_id": dashboard.id,
        "title": spec["title"],
        "widget_count": len(spec["widgets"]),
        "widgets": spec["widgets"],
    }


@router.post("/reports/{report_id}/anomalies")
async def report_anomalies(
    report_id: int,
    data: AnomalyRequest,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """Rileva valori anomali (z-score/IQR) della misura per le dimensioni scelte."""
    report = (await db.execute(select(Report).where(Report.id == report_id))).scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report non trovato")
    if data.method not in ("zscore", "iqr"):
        raise HTTPException(status_code=400, detail="Metodo non valido (zscore|iqr)")

    try:
        return await anomaly.analyze(
            db, report, data.group_by, data.metric, data.filters, data.method, data.threshold
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.post("/reports/{report_id}/forecast")
async def report_forecast(
    report_id: int,
    data: ForecastRequest,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """Previsione (regressione lineare) della misura lungo la dimensione temporale."""
    report = (await db.execute(select(Report).where(Report.id == report_id))).scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report non trovato")

    try:
        return await forecast.analyze(
            db, report, data.time_field, data.metric, data.periods, data.filters
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.get("/logs")
async def list_ai_logs(
    limit: int = 100,
    report_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_superuser),
):
    """Storico delle traduzioni AI (SUPERUSER)."""
    rows = await ai_log.list_logs(db, limit=min(limit, 500), report_id=report_id)
    return [
        {
            "id": r.id,
            "timestamp": r.timestamp.isoformat() if r.timestamp else None,
            "username": r.username,
            "report_id": r.report_id,
            "kind": r.kind,
            "question": r.question,
            "result": r.result,
            "status": r.status,
            "error": r.error,
            "provider": r.provider,
            "model": r.model,
            "latency_ms": r.latency_ms,
            "helpful": r.helpful,
            "feedback_note": r.feedback_note,
        }
        for r in rows
    ]


@router.post("/logs/{log_id}/feedback")
async def ai_feedback(
    log_id: int,
    data: FeedbackRequest,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """Feedback utente su una traduzione AI (pollice su/giù + nota)."""
    entry = await ai_log.set_feedback(db, log_id, data.helpful, data.note)
    if entry is None:
        raise HTTPException(status_code=404, detail="Log non trovato")
    return {"id": entry.id, "helpful": entry.helpful, "feedback_note": entry.feedback_note}
