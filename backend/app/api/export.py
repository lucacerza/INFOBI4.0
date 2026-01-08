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
    
    conn_string = QueryEngine.build_connection_string(
        connection.db_type,
        {
            "host": connection.host,
            "port": connection.port,
            "database": connection.database,
            "username": connection.username,
            "password": decrypt_password(connection.password_encrypted)
        }
    )
    
    try:
        import connectorx as cx
        
        arrow_table = cx.read_sql(conn_string, report.query, return_type="arrow")
        df = pl.from_arrow(arrow_table)
        
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
    
    conn_string = QueryEngine.build_connection_string(
        connection.db_type,
        {
            "host": connection.host,
            "port": connection.port,
            "database": connection.database,
            "username": connection.username,
            "password": decrypt_password(connection.password_encrypted)
        }
    )
    
    try:
        import connectorx as cx
        
        arrow_table = cx.read_sql(conn_string, report.query, return_type="arrow")
        df = pl.from_arrow(arrow_table)
        
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
