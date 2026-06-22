"""Versioning delle definizioni report: snapshot + ripristino."""
from typing import Any, Dict

from sqlalchemy import select, func

from app.db.database import ReportVersion

# Campi della definizione report inclusi nello snapshot
SNAPSHOT_FIELDS = [
    "name", "description", "query",
    "columns_config", "perspective_config",
    "default_group_by", "default_metrics", "available_metrics",
    "column_labels",
]


def snapshot_of(report) -> Dict[str, Any]:
    """Cattura lo stato corrente della definizione del report."""
    return {f: getattr(report, f, None) for f in SNAPSHOT_FIELDS}


def apply_snapshot(report, snapshot: Dict[str, Any]) -> None:
    """Applica al report i campi presenti nello snapshot."""
    for field, value in (snapshot or {}).items():
        if field in SNAPSHOT_FIELDS:
            setattr(report, field, value)


async def save_version(db, report, created_by) -> ReportVersion:
    """Aggiunge alla sessione una nuova versione con lo stato corrente del report.
    Non committa: il commit è responsabilità del chiamante (atomicità con l'update)."""
    result = await db.execute(
        select(func.max(ReportVersion.version_no)).where(ReportVersion.report_id == report.id)
    )
    current_max = result.scalar() or 0
    version = ReportVersion(
        report_id=report.id,
        version_no=current_max + 1,
        snapshot=snapshot_of(report),
        created_by=created_by,
    )
    db.add(version)
    return version
