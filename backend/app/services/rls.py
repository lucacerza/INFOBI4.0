"""
Row-Level Security: calcola i filtri obbligatori da applicare alle query
in base alle regole definite per utente/ruolo su un report.

I filtri prodotti sono nel formato del filterModel ({col: {type:'in', values:[...]}})
e vengono uniti a quelli dell'utente, così da passare per il builder parametrizzato
(_build_safe_filter_clause) — nessun valore interpolato a mano.
"""
from typing import Any, Dict

from sqlalchemy import select, or_, and_

from app.db.database import RlsRule


def rules_to_filters(rules) -> Dict[str, Any]:
    """Trasforma un elenco di regole RLS in un filtro 'in' per colonna (union dei valori)."""
    filters: Dict[str, Any] = {}
    for r in rules:
        vals = list(r.allowed_values or [])
        if r.column in filters:
            seen = {str(v) for v in filters[r.column]["values"]}
            filters[r.column]["values"].extend(v for v in vals if str(v) not in seen)
        else:
            filters[r.column] = {"type": "in", "values": vals}
    return filters


async def get_rls_filters(db, user, report_id: int) -> Dict[str, Any]:
    """Filtri RLS applicabili a (utente, report). Il superuser non ha restrizioni."""
    if getattr(user, "role", None) == "superuser":
        return {}

    result = await db.execute(
        select(RlsRule).where(
            RlsRule.report_id == report_id,
            or_(
                and_(RlsRule.subject_type == "user", RlsRule.subject == user.username),
                and_(RlsRule.subject_type == "role", RlsRule.subject == user.role),
            ),
        )
    )
    return rules_to_filters(result.scalars().all())


def merge_rls(user_filters: Dict[str, Any], rls_filters: Dict[str, Any]) -> Dict[str, Any]:
    """Unisce i filtri utente con quelli RLS. L'RLS è obbligatorio: ha la precedenza."""
    merged = dict(user_filters or {})
    merged.update(rls_filters or {})
    return merged


def apply_rls_to_filtermodel(filter_model: Dict[str, Any], rls_filters: Dict[str, Any]) -> Dict[str, Any]:
    """
    Inietta i filtri RLS (obbligatori) in un filterModel come FilterDef 'in'.
    Usato dai path grid/drill che consumano oggetti FilterDef.
    """
    from app.models.schemas import FilterDef
    merged = dict(filter_model or {})
    for col, f in (rls_filters or {}).items():
        merged[col] = FilterDef(filterType="set", type="in", filter=None, values=f.get("values", []))
    return merged
