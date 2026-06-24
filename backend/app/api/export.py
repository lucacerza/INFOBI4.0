"""Export API - Excel, CSV (dati raw e aggregati/pivot)"""
import logging
from io import BytesIO
from typing import Any, Dict, List

import polars as pl
import pyarrow.ipc as ipc
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from app.db.database import get_db, Report, Connection
from app.core.deps import get_current_user
from app.core.security import decrypt_password
from app.services.query_engine import QueryEngine, _build_safe_filter_clause
from app.services.report_source import resolve_report_source
from app.services.rls import get_rls_filters, merge_rls

logger = logging.getLogger(__name__)
router = APIRouter()


class ExportAggRequest(BaseModel):
    group_by: List[str] = []
    split_by: List[str] = []
    metrics: List[Dict[str, Any]] = []     # [{field, aggregation, name?}]
    filters: Dict[str, Any] = {}


async def _query_with_rls(db, user, report, connection, config):
    """Esegue la query del report applicando i filtri RLS (parametrizzati). Ritorna un DataFrame Polars."""
    is_mssql = connection.db_type == "mssql"
    rls = await get_rls_filters(db, user, report.id)
    where_sql, params = _build_safe_filter_clause(rls, is_mssql)
    query = f"SELECT * FROM ({report.query}) AS rls_base {where_sql}" if where_sql else report.query
    return QueryEngine._execute_df_with_params_sync(connection.db_type, config, query, params)

def _dataframe_response(df: pl.DataFrame, fmt: str, base_name: str) -> StreamingResponse:
    """Serializza un DataFrame in CSV o XLSX come download."""
    safe = base_name.replace(" ", "_")
    output = BytesIO()
    if fmt == "csv":
        df.write_csv(output)
        media, ext = "text/csv", "csv"
    else:
        df.write_excel(output, worksheet="Pivot")
        media, ext = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"
    output.seek(0)
    return StreamingResponse(
        output, media_type=media,
        headers={"Content-Disposition": f"attachment; filename={safe}.{ext}"},
    )


@router.post("/{report_id}/aggregated")
async def export_aggregated(
    report_id: int,
    request: ExportAggRequest,
    format: str = "xlsx",
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user),
):
    """Esporta i dati AGGREGATI (pivot) in CSV/XLSX, rispettando RLS e warehouse."""
    fmt = "csv" if format.lower() == "csv" else "xlsx"
    report = (await db.execute(select(Report).where(Report.id == report_id))).scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report non trovato")

    group_by = request.group_by or report.default_group_by or []
    metrics = request.metrics or report.default_metrics or []
    if not metrics:
        raise HTTPException(status_code=400, detail="Nessuna misura: niente da aggregare")

    # RLS + risoluzione sorgente (warehouse o live)
    rls = await get_rls_filters(db, user, report_id)
    effective_filters = merge_rls(request.filters, rls)
    db_type, config, base_query = await resolve_report_source(db, report)

    try:
        if request.split_by:
            from app.api.pivot import execute_pivot_with_split
            arrow_bytes, _ = await execute_pivot_with_split(
                db_type, config, base_query, group_by, request.split_by,
                metrics, effective_filters, calculate_delta=False,
            )
        else:
            arrow_bytes, _, _ = await QueryEngine.execute_pivot(
                db_type, config, base_query, group_by, metrics, effective_filters,
            )
        df = pl.from_arrow(ipc.open_stream(BytesIO(arrow_bytes)).read_all())
        return _dataframe_response(df, fmt, report.name)
    except Exception as e:
        logger.exception("Export aggregato fallito per report %s", report_id)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{report_id}/xlsx")
async def export_xlsx(
    report_id: int,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    """Export report to Excel"""
    result = await db.execute(
        select(Report, Connection)
        .join(Connection, Report.connection_id == Connection.id)
        .where(Report.id == report_id)
    )
    row = result.one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Report not found")
    
    report, connection = row

    config = {
        "host": connection.host,
        "port": connection.port,
        "database": connection.database,
        "username": connection.username,
        "password": decrypt_password(connection.password_encrypted),
        "ssl_enabled": connection.ssl_enabled
    }

    # Ensure pool is warm before query (eliminates cold start)
    QueryEngine.ensure_pool_warm(connection.db_type, config)

    try:
        df = await _query_with_rls(db, user, report, connection, config)

        # Write to Excel
        output = BytesIO()
        df.write_excel(output, worksheet="Data")
        output.seek(0)
        
        filename = f"{report.name.replace(' ', '_')}.xlsx"
        
        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except Exception as e:
        logger.exception(f"Excel export failed for report {report_id}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{report_id}/csv")
async def export_csv(
    report_id: int,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    """Export report to CSV"""
    result = await db.execute(
        select(Report, Connection)
        .join(Connection, Report.connection_id == Connection.id)
        .where(Report.id == report_id)
    )
    row = result.one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Report not found")
    
    report, connection = row

    config = {
        "host": connection.host,
        "port": connection.port,
        "database": connection.database,
        "username": connection.username,
        "password": decrypt_password(connection.password_encrypted),
        "ssl_enabled": connection.ssl_enabled
    }

    # Ensure pool is warm before query (eliminates cold start)
    QueryEngine.ensure_pool_warm(connection.db_type, config)

    try:
        df = await _query_with_rls(db, user, report, connection, config)

        output = BytesIO()
        df.write_csv(output)
        output.seek(0)
        
        filename = f"{report.name.replace(' ', '_')}.csv"
        
        return StreamingResponse(
            output,
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    except Exception as e:
        logger.exception(f"CSV export failed for report {report_id}")
        raise HTTPException(status_code=500, detail=str(e))
