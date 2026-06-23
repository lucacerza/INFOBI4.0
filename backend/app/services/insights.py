"""
Auto-insight / narrazione: l'AI riassume a parole i dati AGGREGATI di un report.

Per evitare allucinazioni numeriche, l'LLM riceve un "digest" compatto dei dati
realmente aggregati (con nomi business e unità dal semantic layer) e deve basarsi
solo su quelli. Nessun SQL grezzo: la query è quella della pivot esistente.
"""
import logging
from io import BytesIO
from typing import Any, Dict, List, Optional

import pyarrow.ipc as ipc
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import Report
from app.services import nl_pivot
from app.services.query_engine import QueryEngine
from app.services.report_source import resolve_report_source
from app.services.llm.base import ResilientLLM

logger = logging.getLogger(__name__)

# Quante righe aggregate mostrare all'LLM (cap di costo/contesto)
MAX_DIGEST_ROWS = 50
# Limite righe aggregate estratte dal motore pivot
PIVOT_LIMIT = 500

_SYSTEM = (
    "Sei un analista di Business Intelligence. Ti vengono forniti dati GIÀ AGGREGATI. "
    "Scrivi in italiano 3-5 osservazioni chiave, concrete e sintetiche: totali e voci "
    "principali, concentrazioni, scarti evidenti tra le voci. "
    "USA SOLO i numeri forniti (non inventarne altri) e cita le unità di misura quando presenti. "
    "Niente preamboli: vai diretto alle osservazioni."
)


def _round(v: Any) -> Any:
    if isinstance(v, float):
        return round(v, 2)
    return v


def build_digest(
    columns: List[Dict[str, Any]],
    group_by: List[str],
    metrics: List[Dict[str, Any]],
    rows: List[Dict[str, Any]],
    max_rows: int = MAX_DIGEST_ROWS,
) -> str:
    """Rappresentazione testuale compatta dei dati aggregati per il prompt."""
    by_name = {c["name"]: c for c in columns}

    def label(name: str) -> str:
        c = by_name.get(name)
        return (c and c.get("business_name")) or name

    def unit(name: str) -> str:
        c = by_name.get(name)
        return (c and c.get("unit")) or ""

    lines: List[str] = []
    lines.append("Dimensioni: " + (", ".join(label(g) for g in group_by) or "nessuna"))
    metric_keys = [(m.get("name") or m.get("field"), m.get("field")) for m in metrics]
    lines.append("Misure: " + ", ".join(
        f"{key}{(' (' + unit(field) + ')') if unit(field) else ''}" for key, field in metric_keys
    ))
    lines.append(f"Righe aggregate totali: {len(rows)} (mostrate fino a {max_rows})")
    lines.append("Dati:")
    for r in rows[:max_rows]:
        dims = " ".join(f"{label(g)}={r.get(g)}" for g in group_by) if group_by else "(totale)"
        mets = " ".join(f"{key}={_round(r.get(key))}" for key, _ in metric_keys)
        lines.append(f"- {dims} | {mets}")
    return "\n".join(lines)


async def narrate(
    db: AsyncSession,
    report: Report,
    llm: ResilientLLM,
    group_by: List[str],
    metrics: List[Dict[str, Any]],
    filters: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Esegue l'aggregazione e produce una narrazione testuale dei risultati."""
    if not metrics:
        raise ValueError("Nessuna misura: impossibile generare insight")

    db_type, src_config, base_query = await resolve_report_source(db, report)
    arrow_bytes, row_count, _ = await QueryEngine.execute_pivot(
        db_type, src_config, base_query, group_by, metrics, filters or {}, PIVOT_LIMIT
    )

    table = ipc.open_stream(BytesIO(arrow_bytes)).read_all()
    rows = table.to_pylist()
    if not rows:
        return {"narrative": "Nessun dato disponibile per i criteri scelti.", "row_count": 0}

    columns = await nl_pivot.build_grounding(db, report)
    digest = build_digest(columns, group_by, metrics, rows)

    res = await llm.generate(
        system=_SYSTEM,
        messages=[{"role": "user", "content": f"Domanda: riassumi questi dati.\n\n{digest}"}],
        max_tokens=700,
        temperature=0.3,
    )
    return {"narrative": (res.text or "").strip(), "row_count": row_count}
