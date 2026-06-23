"""
NL -> Pivot: traduce una domanda in linguaggio naturale in una configurazione
pivot VALIDATA (non SQL grezzo), grounded sul semantic layer del report.

Anti-allucinazione: l'LLM può riferirsi solo alle colonne reali del report;
qualunque colonna inventata fa fallire la richiesta (nessuna query "fantasma").
La config prodotta ha la forma attesa da /api/pivot/{id} (EnhancedPivotRequest).
"""
import logging
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.database import Report
from app.services import semantic
from app.services.llm.base import ResilientLLM, ToolSpec

logger = logging.getLogger(__name__)

_ALLOWED_AGG = {"sum", "avg", "count", "min", "max"}
_ALLOWED_OPS = {
    "equals", "notEqual", "contains", "in",
    "greaterThan", "greaterThanOrEqual", "lessThan", "lessThanOrEqual",
}

PIVOT_TOOL = ToolSpec(
    name="build_pivot",
    description=(
        "Costruisce la configurazione di una tabella pivot a partire dalla richiesta. "
        "Usa esclusivamente le colonne elencate (riferendoti al nome tecnico). "
        "group_by = dimensioni/tempo (righe); metrics = misure da aggregare; "
        "split_by (opzionale) = colonne da disporre come colonne; filters (opzionale)."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "group_by": {"type": "array", "items": {"type": "string"},
                         "description": "Colonne dimensione/tempo per le righe"},
            "split_by": {"type": "array", "items": {"type": "string"},
                         "description": "Colonne da pivottare come colonne (opzionale)"},
            "metrics": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "field": {"type": "string"},
                        "aggregation": {"type": "string", "enum": sorted(_ALLOWED_AGG)},
                    },
                    "required": ["field", "aggregation"],
                },
                "description": "Misure da aggregare",
            },
            "filters": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "field": {"type": "string"},
                        "op": {"type": "string", "enum": sorted(_ALLOWED_OPS)},
                        "value": {},
                        "values": {"type": "array"},
                    },
                    "required": ["field", "op"],
                },
            },
        },
        "required": ["group_by", "metrics"],
    },
)

_SYSTEM = (
    "Sei un assistente di Business Intelligence. Traduci la domanda dell'utente "
    "in una configurazione pivot chiamando lo strumento build_pivot. "
    "REGOLE: usa SOLO le colonne elencate (nome tecnico tra parentesi quadre); "
    "non inventare colonne; metti le misure in 'metrics' con l'aggregazione adatta "
    "(le misure hanno un'aggregazione di default suggerita); metti dimensioni e "
    "colonne temporali in 'group_by'. Rispondi sempre chiamando lo strumento."
)


async def build_grounding(db: AsyncSession, report: Report) -> List[Dict[str, Any]]:
    """
    Colonne disponibili con metadati semantici. Usa column_metadata se presente,
    altrimenti deriva al volo dallo schema (nome + ruolo inferito).
    """
    meta = await semantic.list_metadata(db, report.id)
    if meta:
        # governance: escludi le colonne nascoste; in modalità certificata, solo le certificate
        cols = [m for m in meta if not m.is_hidden]
        if settings.AI_CERTIFIED_ONLY:
            cols = [m for m in cols if m.is_certified]
        return [{
            "name": m.column_name,
            "business_name": m.business_name,
            "role": m.role,
            "data_type": m.data_type,
            "default_aggregation": m.default_aggregation,
            "unit": m.unit,
            "is_certified": m.is_certified,
        } for m in cols]

    cols = await semantic._report_columns(db, report)
    grounding = []
    for name, raw_type in cols:
        data_type, role, default_agg = semantic.infer(name, raw_type)
        grounding.append({
            "name": name, "business_name": name, "role": role,
            "data_type": data_type, "default_aggregation": default_agg, "unit": None,
        })
    return grounding


def render_columns(columns: List[Dict[str, Any]]) -> str:
    """Rende le colonne come testo per il prompt (solo quelle non nascoste)."""
    lines = []
    for c in columns:
        biz = f' "{c["business_name"]}"' if c.get("business_name") else ""
        unit = f", unità {c['unit']}" if c.get("unit") else ""
        agg = c.get("default_aggregation") or "none"
        agg_txt = f", aggregazione {agg}" if c.get("role") == "measure" and agg != "none" else ""
        lines.append(f'- [{c["name"]}]{biz} — {c.get("role", "dimension")} ({c.get("data_type", "string")}{unit}{agg_txt})')
    return "Colonne disponibili:\n" + "\n".join(lines)


def _index(columns: List[Dict[str, Any]]):
    by_name = {c["name"].lower(): c for c in columns}
    by_biz: Dict[str, Dict[str, Any]] = {}
    for c in columns:
        if c.get("business_name"):
            by_biz.setdefault(c["business_name"].lower(), c)
    return by_name, by_biz


def validate_and_build(columns: List[Dict[str, Any]], args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Valida l'output dell'LLM contro le colonne reali e costruisce la config pivot.
    Solleva ValueError se vengono citate colonne inesistenti (anti-allucinazione).
    """
    by_name, by_biz = _index(columns)
    unknown: List[str] = []

    def resolve(token: Any) -> Optional[Dict[str, Any]]:
        if not isinstance(token, str):
            unknown.append(str(token))
            return None
        c = by_name.get(token.strip().lower()) or by_biz.get(token.strip().lower())
        if c is None:
            unknown.append(token)
        return c

    group_by: List[str] = []
    for g in args.get("group_by") or []:
        c = resolve(g)
        if c and c["name"] not in group_by:
            group_by.append(c["name"])

    split_by: List[str] = []
    for s in args.get("split_by") or []:
        c = resolve(s)
        if c and c["name"] not in split_by:
            split_by.append(c["name"])

    metrics: List[Dict[str, Any]] = []
    for m in args.get("metrics") or []:
        c = resolve(m.get("field"))
        if not c:
            continue
        agg = (m.get("aggregation") or c.get("default_aggregation") or "sum").lower()
        if agg not in _ALLOWED_AGG:
            agg = "sum"
        metrics.append({
            "name": c.get("business_name") or c["name"],
            "field": c["name"],
            "aggregation": agg.upper(),
            "type": "measure",
        })

    filters: Dict[str, Any] = {}
    for f in args.get("filters") or []:
        c = resolve(f.get("field"))
        op = f.get("op")
        if not c or op not in _ALLOWED_OPS:
            continue
        if op == "in":
            values = f.get("values")
            if not values and f.get("value") is not None:
                values = [f.get("value")]
            filters[c["name"]] = {"type": "in", "values": values or []}
        else:
            filters[c["name"]] = {"type": op, "value": f.get("value")}

    if unknown:
        raise ValueError("Colonne non riconosciute: " + ", ".join(sorted(set(unknown))))
    if not metrics:
        raise ValueError("Nessuna misura valida individuata nella richiesta")

    return {"group_by": group_by, "split_by": split_by, "metrics": metrics, "filters": filters}


async def ask(db: AsyncSession, report: Report, llm: ResilientLLM, question: str) -> Dict[str, Any]:
    """Domanda NL -> {config, explanation, columns}. Esegue il grounding e valida l'output."""
    columns = await build_grounding(db, report)
    system = _SYSTEM + "\n\n" + render_columns(columns)

    res = await llm.generate(
        system=system,
        messages=[{"role": "user", "content": question}],
        tools=[PIVOT_TOOL],
        tool_choice={"type": "tool", "name": PIVOT_TOOL.name},
        max_tokens=1024,
        temperature=0.0,
    )

    if not res.tool_calls:
        raise ValueError("L'AI non ha prodotto una configurazione pivot")

    config = validate_and_build(columns, res.tool_calls[0].arguments)
    return {"config": config, "explanation": res.text, "question": question}
