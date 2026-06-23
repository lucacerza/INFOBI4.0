"""
NL -> Dashboard: descrizione in linguaggio naturale -> insieme di widget.

Riusa il grounding e il validatore di NL->Pivot per ogni widget (stesso
guardrail anti-allucinazione). Produce widget nella forma attesa dal viewer
dashboard ({chartType, groupBy, splitBy, metrics}); il salvataggio avviene
nell'endpoint.
"""
import logging
from typing import Any, Dict, List

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import Report
from app.services import nl_pivot
from app.services.llm.base import ResilientLLM, ToolSpec

logger = logging.getLogger(__name__)

_CHART_TYPES = {"bar", "line", "pie", "area"}
_WIDGET_TYPES = {"chart", "grid"}

DASHBOARD_TOOL = ToolSpec(
    name="build_dashboard",
    description=(
        "Costruisce una dashboard come insieme di widget a partire dalla descrizione. "
        "Ogni widget usa SOLO le colonne elencate (nome tecnico). "
        "Scegli 'chart' (con chart_type) per i grafici e 'grid' per le tabelle. "
        "Ogni widget deve avere almeno una misura in metrics."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Titolo della dashboard"},
            "widgets": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "widget_type": {"type": "string", "enum": sorted(_WIDGET_TYPES)},
                        "chart_type": {"type": "string", "enum": sorted(_CHART_TYPES)},
                        "group_by": {"type": "array", "items": {"type": "string"}},
                        "split_by": {"type": "array", "items": {"type": "string"}},
                        "metrics": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "field": {"type": "string"},
                                    "aggregation": {"type": "string",
                                                    "enum": ["sum", "avg", "count", "min", "max"]},
                                },
                                "required": ["field", "aggregation"],
                            },
                        },
                    },
                    "required": ["title", "widget_type", "metrics"],
                },
            },
        },
        "required": ["widgets"],
    },
)

_SYSTEM = (
    "Sei un assistente di Business Intelligence. Traduci la richiesta in una dashboard "
    "chiamando lo strumento build_dashboard. Crea 2-6 widget complementari (es. un grafico "
    "per i totali per dimensione, un trend temporale, una tabella di dettaglio). "
    "Usa SOLO le colonne elencate (nome tecnico); ogni widget deve avere almeno una misura. "
    "Rispondi sempre chiamando lo strumento."
)


def _widget_config(widget_type: str, chart_type: str, validated: Dict[str, Any]) -> Dict[str, Any]:
    cfg: Dict[str, Any] = {
        "groupBy": validated["group_by"],
        "splitBy": validated["split_by"],
        "metrics": [
            {"id": f"m{j}", "name": m["name"], "field": m["field"], "aggregation": m["aggregation"]}
            for j, m in enumerate(validated["metrics"])
        ],
    }
    if widget_type == "chart":
        cfg["chartType"] = chart_type if chart_type in _CHART_TYPES else "bar"
    return cfg


async def design(db: AsyncSession, report: Report, llm: ResilientLLM, description: str) -> Dict[str, Any]:
    """Descrizione NL -> {title, widgets:[{title, widget_type, config, position}]}."""
    columns = await nl_pivot.build_grounding(db, report)
    system = _SYSTEM + "\n\n" + nl_pivot.render_columns(columns)

    res = await llm.generate(
        system=system,
        messages=[{"role": "user", "content": description}],
        tools=[DASHBOARD_TOOL],
        tool_choice={"type": "tool", "name": DASHBOARD_TOOL.name},
        max_tokens=1500,
        temperature=0.0,
    )
    if not res.tool_calls:
        raise ValueError("L'AI non ha prodotto widget")

    raw_widgets = res.tool_calls[0].arguments.get("widgets") or []
    if not raw_widgets:
        raise ValueError("Nessun widget proposto")

    widgets: List[Dict[str, Any]] = []
    for i, w in enumerate(raw_widgets):
        validated = nl_pivot.validate_and_build(columns, w)  # guardrail anti-allucinazione
        wtype = w.get("widget_type") if w.get("widget_type") in _WIDGET_TYPES else "grid"
        widgets.append({
            "title": w.get("title") or f"Widget {i + 1}",
            "widget_type": wtype,
            "config": _widget_config(wtype, w.get("chart_type", "bar"), validated),
            "position": {"x": (i % 2) * 6, "y": (i // 2) * 8, "w": 6, "h": 8},
        })

    title = res.tool_calls[0].arguments.get("title") or "Dashboard AI"
    return {"title": title, "widgets": widgets}
