"""
Anomaly detection sui dati aggregati: statistica pura (z-score / IQR),
deterministica e senza LLM. Riusa il grounding/guardrail per validare le
colonne e il motore pivot per l'aggregazione.
"""
import logging
import math
from typing import Any, Dict, List, Optional, Tuple
from io import BytesIO

import pyarrow.ipc as ipc
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import Report
from app.services import nl_pivot
from app.services.query_engine import QueryEngine
from app.services.report_source import resolve_report_source

logger = logging.getLogger(__name__)

PIVOT_LIMIT = 5000
MIN_POINTS = 3  # sotto questa soglia non ha senso cercare outlier


def _mean_std(values: List[float]) -> Tuple[float, float]:
    n = len(values)
    mean = sum(values) / n
    var = sum((v - mean) ** 2 for v in values) / n
    return mean, math.sqrt(var)


def _quartiles(values: List[float]) -> Tuple[float, float]:
    """Q1 e Q3 con interpolazione lineare."""
    s = sorted(values)
    n = len(s)

    def q(p: float) -> float:
        pos = p * (n - 1)
        lo = int(math.floor(pos))
        hi = int(math.ceil(pos))
        if lo == hi:
            return s[lo]
        return s[lo] + (s[hi] - s[lo]) * (pos - lo)

    return q(0.25), q(0.75)


def detect(values: List[float], method: str = "zscore", threshold: float = 3.0) -> List[Dict[str, Any]]:
    """
    Ritorna gli outlier come [{index, value, score, direction}].
    - zscore: |(x-media)/dev_std| >= threshold
    - iqr: x < Q1 - 1.5*IQR  oppure  x > Q3 + 1.5*IQR (score = scarto in IQR)
    """
    if len(values) < MIN_POINTS:
        return []

    out: List[Dict[str, Any]] = []

    if method == "iqr":
        q1, q3 = _quartiles(values)
        iqr = q3 - q1
        if iqr == 0:
            return []
        low, high = q1 - 1.5 * iqr, q3 + 1.5 * iqr
        for i, v in enumerate(values):
            if v < low:
                out.append({"index": i, "value": v, "score": round((q1 - v) / iqr, 2), "direction": "low"})
            elif v > high:
                out.append({"index": i, "value": v, "score": round((v - q3) / iqr, 2), "direction": "high"})
        return out

    # default: z-score
    mean, std = _mean_std(values)
    if std == 0:
        return []
    for i, v in enumerate(values):
        z = (v - mean) / std
        if abs(z) >= threshold:
            out.append({"index": i, "value": v, "score": round(z, 2), "direction": "high" if z > 0 else "low"})
    return out


async def analyze(
    db: AsyncSession,
    report: Report,
    group_by: List[str],
    metric: Dict[str, Any],
    filters: Optional[Dict[str, Any]] = None,
    method: str = "zscore",
    threshold: float = 3.0,
) -> Dict[str, Any]:
    """Aggrega per group_by/metric e individua i valori anomali della misura."""
    if not group_by:
        raise ValueError("Serve almeno una dimensione (group_by) per cercare anomalie")

    # guardrail: valida colonne reali e ottiene il nome della misura
    columns = await nl_pivot.build_grounding(db, report)
    validated = nl_pivot.validate_and_build(columns, {"group_by": group_by, "metrics": [metric]})
    metric_key = validated["metrics"][0]["name"]

    db_type, src_config, base_query = await resolve_report_source(db, report)
    arrow_bytes, _, _ = await QueryEngine.execute_pivot(
        db_type, src_config, base_query, validated["group_by"], validated["metrics"], filters or {}, PIVOT_LIMIT
    )
    rows = ipc.open_stream(BytesIO(arrow_bytes)).read_all().to_pylist()

    indexed = [(i, r) for i, r in enumerate(rows) if isinstance(r.get(metric_key), (int, float))]
    values = [r[metric_key] for _, r in indexed]

    found = detect(values, method=method, threshold=threshold)
    mean, std = (_mean_std(values) if values else (0.0, 0.0))

    anomalies = []
    for f in found:
        _, row = indexed[f["index"]]
        anomalies.append({
            "label": " · ".join(str(row.get(g)) for g in validated["group_by"]),
            "dimensions": {g: row.get(g) for g in validated["group_by"]},
            "value": f["value"],
            "score": f["score"],
            "direction": f["direction"],
        })
    # le anomalie più "forti" in cima
    anomalies.sort(key=lambda a: abs(a["score"]), reverse=True)

    return {
        "method": method,
        "threshold": threshold,
        "metric": metric_key,
        "total_rows": len(values),
        "mean": round(mean, 2),
        "std": round(std, 2),
        "count": len(anomalies),
        "anomalies": anomalies,
    }
