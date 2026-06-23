"""
Forecasting su serie temporali: regressione lineare (minimi quadrati) con
banda di confidenza ~95% dai residui. Statistica pura, deterministica, no LLM.
Riusa grounding/guardrail + motore pivot per costruire la serie aggregata.
"""
import logging
import math
from io import BytesIO
from typing import Any, Dict, List, Optional

import pyarrow.ipc as ipc
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import Report
from app.services import nl_pivot
from app.services.query_engine import QueryEngine
from app.services.report_source import resolve_report_source

logger = logging.getLogger(__name__)

PIVOT_LIMIT = 5000
MAX_PERIODS = 36


def linear_forecast(values: List[float], periods: int) -> Dict[str, Any]:
    """
    Fit lineare su x=0..n-1 e proiezione di `periods` passi.
    Ritorna slope/intercept, residual_std e i punti previsti (value, lower, upper).
    """
    n = len(values)
    if n < 2:
        raise ValueError("Servono almeno 2 punti storici per la previsione")

    xs = list(range(n))
    sx, sy = sum(xs), sum(values)
    sxx = sum(x * x for x in xs)
    sxy = sum(x * y for x, y in zip(xs, values))
    denom = n * sxx - sx * sx
    if denom == 0:
        raise ValueError("Serie non proiettabile")

    slope = (n * sxy - sx * sy) / denom
    intercept = (sy - slope * sx) / n

    residuals = [values[i] - (intercept + slope * i) for i in range(n)]
    dof = max(n - 2, 1)
    residual_std = math.sqrt(sum(r * r for r in residuals) / dof)
    margin = 1.96 * residual_std

    points = []
    for k in range(1, periods + 1):
        xf = n - 1 + k
        val = intercept + slope * xf
        points.append({
            "step": k,
            "value": round(val, 2),
            "lower": round(val - margin, 2),
            "upper": round(val + margin, 2),
        })

    return {
        "slope": round(slope, 4),
        "intercept": round(intercept, 4),
        "residual_std": round(residual_std, 2),
        "points": points,
    }


def _num(label: Any) -> Optional[float]:
    if isinstance(label, (int, float)):
        return float(label)
    if isinstance(label, str):
        try:
            return float(label)
        except ValueError:
            return None
    return None


async def analyze(
    db: AsyncSession,
    report: Report,
    time_field: str,
    metric: Dict[str, Any],
    periods: int = 3,
    filters: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Costruisce la serie temporale (time_field, metric) e proietta `periods` passi."""
    periods = max(1, min(int(periods), MAX_PERIODS))

    # guardrail: colonne reali + nome misura
    columns = await nl_pivot.build_grounding(db, report)
    validated = nl_pivot.validate_and_build(columns, {"group_by": [time_field], "metrics": [metric]})
    time_key = validated["group_by"][0]
    metric_key = validated["metrics"][0]["name"]

    db_type, src_config, base_query = await resolve_report_source(db, report)
    arrow_bytes, _, _ = await QueryEngine.execute_pivot(
        db_type, src_config, base_query, [time_key], validated["metrics"], filters or {}, PIVOT_LIMIT
    )
    rows = ipc.open_stream(BytesIO(arrow_bytes)).read_all().to_pylist()

    series = [(r.get(time_key), r.get(metric_key)) for r in rows
              if r.get(time_key) is not None and isinstance(r.get(metric_key), (int, float))]

    nums = [_num(t) for t, _ in series]
    numeric_time = len(nums) > 0 and all(v is not None for v in nums)
    if numeric_time:
        series = [s for _, s in sorted(zip(nums, series), key=lambda p: p[0])]
    else:
        series = sorted(series, key=lambda p: str(p[0]))

    labels = [t for t, _ in series]
    values = [float(v) for _, v in series]

    if len(values) < 2:
        raise ValueError("Storico insufficiente per la previsione (servono almeno 2 periodi)")

    fc = linear_forecast(values, periods)

    # etichette future: continuazione numerica se l'asse tempo è numerico
    future_labels: List[Any] = []
    if numeric_time:
        ordered = sorted(v for v in nums if v is not None)
        step = (ordered[-1] - ordered[0]) / (len(ordered) - 1) if len(ordered) > 1 else 1
        if step == 0:
            step = 1
        all_int = all(float(v).is_integer() for v in ordered)
        last = ordered[-1]
        for k in range(1, periods + 1):
            nxt = last + step * k
            future_labels.append(int(round(nxt)) if all_int else round(nxt, 2))
    else:
        future_labels = [f"+{k}" for k in range(1, periods + 1)]

    forecast = [
        {"label": future_labels[i], **fc["points"][i]} for i in range(periods)
    ]
    trend = "up" if fc["slope"] > 0 else ("down" if fc["slope"] < 0 else "flat")

    return {
        "time": time_key,
        "metric": metric_key,
        "history": [{"label": labels[i], "value": round(values[i], 2)} for i in range(len(values))],
        "forecast": forecast,
        "slope": fc["slope"],
        "trend": trend,
    }
