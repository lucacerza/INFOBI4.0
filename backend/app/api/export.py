"""Export API - Excel, CSV"""
import logging
from io import BytesIO
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.database import get_db, Report, Connection
from app.core.deps import get_current_user
from app.core.security import decrypt_password
from app.services.query_engine import QueryEngine, _build_safe_filter_clause
from app.services.rls import get_rls_filters

logger = logging.getLogger(__name__)
router = APIRouter()


async def _query_with_rls(db, user, report, connection, config):
    """Esegue la query del report applicando i filtri RLS (parametrizzati). Ritorna un DataFrame Polars."""
    is_mssql = connection.db_type == "mssql"
    rls = await get_rls_filters(db, user, report.id)
    where_sql, params = _build_safe_filter_clause(rls, is_mssql)
    query = f"SELECT * FROM ({report.query}) AS rls_base {where_sql}" if where_sql else report.query
    return QueryEngine._execute_df_with_params_sync(connection.db_type, config, query, params)

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
