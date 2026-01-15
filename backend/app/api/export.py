"""Export API - Excel, CSV"""
from io import BytesIO
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import polars as pl
from app.db.database import get_db, Report, Connection
from app.core.deps import get_current_user
from app.core.security import decrypt_password
from app.services.query_engine import QueryEngine
from app.core.engine_pool import get_engine

router = APIRouter()

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
        engine = get_engine(connection.db_type, config)
        with engine.connect() as conn:
            df = pl.read_database(report.query, connection=conn)

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
        engine = get_engine(connection.db_type, config)
        with engine.connect() as conn:
            df = pl.read_database(report.query, connection=conn)

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
        raise HTTPException(status_code=500, detail=str(e))
