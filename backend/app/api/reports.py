"""Reports API with high-performance data streaming"""
import time
import logging
from fastapi import APIRouter, Depends, HTTPException, status, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List
from pydantic import BaseModel
from app.db.database import get_db, Report, Connection
from app.core.deps import get_current_user, get_current_admin, get_current_superuser
from app.core.security import decrypt_password
from app.models.schemas import ReportCreate, ReportUpdate, ReportResponse, GridRequest, PivotDrillRequest
from app.services.query_engine import QueryEngine, query_engine
from app.services.cache import cache

logger = logging.getLogger(__name__)

router = APIRouter()

class TestQueryRequest(BaseModel):
    connection_id: int
    query: str

@router.post("/test-query")
async def test_query(
    request: TestQueryRequest,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_superuser)  # SECURITY: Solo superuser può testare query
):
    """Test a SQL query and return column info and row count (SUPERUSER ONLY)"""
    # Get connection
    result = await db.execute(select(Connection).where(Connection.id == request.connection_id))
    connection = result.scalar_one_or_none()
    if not connection:
        raise HTTPException(status_code=404, detail="Connessione non trovata")
    
    try:
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

        # Wrap query with limit for testing
        if connection.db_type == "mssql":
            test_query = f"SELECT TOP 100 * FROM ({request.query}) AS test_query"
        else:
            test_query = f"SELECT * FROM ({request.query}) AS test_query LIMIT 100"

        # Execute using pool
        # Nota: usiamo _execute_query_sync direttamente o tramite wrapper
        arrow_table = QueryEngine._execute_query_sync(connection.db_type, config, test_query)
        
        return {
            "success": True,
            "row_count": arrow_table.num_rows,
            "columns": [field.name for field in arrow_table.schema],
            "message": "Query eseguita con successo"
        }
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("", response_model=List[ReportResponse])
async def list_reports(
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_admin)  # SECURITY: Superuser e Admin possono vedere la lista report
):
    """List all reports (SUPERUSER e ADMIN)"""
    result = await db.execute(select(Report).order_by(Report.name))
    return result.scalars().all()

@router.post("", response_model=ReportResponse, status_code=status.HTTP_201_CREATED)
async def create_report(
    data: ReportCreate,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_superuser)  # SECURITY: Solo superuser può creare report
):
    """Create a new report (SUPERUSER ONLY)"""
    # Verify connection exists
    conn_result = await db.execute(select(Connection).where(Connection.id == data.connection_id))
    if not conn_result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Connection not found")
    
    report = Report(
        name=data.name,
        description=data.description,
        connection_id=data.connection_id,
        query=data.query,
        default_group_by=data.default_group_by,
        default_metrics=[m.model_dump() for m in data.default_metrics],
        available_metrics=[m.model_dump() for m in data.available_metrics],
        column_labels=data.column_labels,
        cache_enabled=data.cache_enabled,
        cache_ttl=data.cache_ttl,
        created_by=user.id
    )
    db.add(report)
    await db.commit()
    await db.refresh(report)
    return report

@router.get("/{report_id}", response_model=ReportResponse)
async def get_report(
    report_id: int,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    """Get report details"""
    result = await db.execute(select(Report).where(Report.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return report

@router.put("/{report_id}", response_model=ReportResponse)
async def update_report(
    report_id: int,
    data: ReportUpdate,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_superuser)  # SECURITY: Solo superuser può modificare report
):
    """Update report (SUPERUSER ONLY)"""
    result = await db.execute(select(Report).where(Report.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    
    for field, value in data.model_dump(exclude_unset=True).items():
        if field == "default_metrics" and value:
            value = [m.model_dump() if hasattr(m, 'model_dump') else m for m in value]
        if field == "available_metrics" and value:
            value = [m.model_dump() if hasattr(m, 'model_dump') else m for m in value]
        if value is not None:
            setattr(report, field, value)
    
    await db.commit()
    await db.refresh(report)
    
    # Invalidate cache
    await cache.invalidate_report(report_id)
    
    return report

@router.delete("/{report_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_report(
    report_id: int,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_superuser)  # SECURITY: Solo superuser può eliminare report
):
    """Delete report (SUPERUSER ONLY)"""
    result = await db.execute(select(Report).where(Report.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    
    await db.delete(report)
    await db.commit()
    
    # Invalidate cache
    await cache.invalidate_report(report_id)

@router.put("/{report_id}/layout")
async def save_layout(
    report_id: int,
    layout: dict,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    """Save user's layout configuration"""
    result = await db.execute(select(Report).where(Report.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    
    report.layout = layout
    await db.commit()
    
    return {"success": True}

@router.put("/{report_id}/perspective-config")
async def save_perspective_config(
    report_id: int,
    config: dict,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_admin)
):
    """
    Save Perspective.js configuration (ADMIN ONLY)
    
    This stores the complete view state that will be loaded for all users.
    Example config:
    {
        "plugin": "Datagrid",
        "plugin_config": {"columns": {}},
        "group_by": ["Agente", "Cliente"],
        "split_by": ["Anno"],
        "columns": ["Venduto", "Costo"],
        "sort": [["Venduto", "desc"]],
        "filter": [],
        "aggregates": {"Venduto": "sum", "Costo": "sum"}
    }
    """
    result = await db.execute(select(Report).where(Report.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    
    report.perspective_config = config
    await db.commit()
    
    return {"success": True, "message": "Configurazione salvata"}

@router.get("/{report_id}/data")
async def get_report_data(
    report_id: int,
    force_refresh: bool = False,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    """
    Get report data as Arrow IPC stream
    This is the RAW data endpoint - no aggregations
    Use /pivot endpoint for aggregated data
    """
    start_time = time.perf_counter()
    
    # Get report
    result = await db.execute(
        select(Report, Connection)
        .join(Connection, Report.connection_id == Connection.id)
        .where(Report.id == report_id)
    )
    row = result.one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Report not found")
    
    report, connection = row
    
    # Check cache first
    cache_hit = False
    query_hash = QueryEngine.hash_config({"query": report.query})
    
    if report.cache_enabled and not force_refresh:
        cached = await cache.get_query(report_id, query_hash)
        if cached:
            cache_hit = True
            arrow_bytes = cached
            row_count = -1  # Unknown from cache
            elapsed = (time.perf_counter() - start_time) * 1000
    
    if not cache_hit:
        # Build config and ensure pool is warm
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

        # Execute query
        arrow_bytes, row_count, query_time = await QueryEngine.execute_query(
            connection.db_type,
            config,
            report.query
        )
        
        elapsed = (time.perf_counter() - start_time) * 1000
        
        # Cache result
        if report.cache_enabled:
            await cache.set_query(report_id, query_hash, arrow_bytes)
    
    return Response(
        content=arrow_bytes,
        media_type="application/vnd.apache.arrow.stream",
        headers={
            "X-Query-Time": f"{elapsed:.1f}",
            "X-Cache-Hit": str(cache_hit).lower(),
            "X-Row-Count": str(row_count) if row_count >= 0 else "cached",
            "Content-Disposition": f"attachment; filename=report_{report_id}.arrow"
        }
    )

@router.post("/{report_id}/refresh-cache")
async def refresh_cache(
    report_id: int,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_admin)
):
    """Force refresh report cache"""
    await cache.invalidate_report(report_id)
    return {"success": True, "message": "Cache invalidated"}

@router.put("/{report_id}/tabulator-config")
async def save_tabulator_config(
    report_id: int,
    config: dict,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_admin)
):
    """
    Save Tabulator configuration (ADMIN ONLY)
    
    This stores the view config for Tabulator viewer.
    Example config:
    {
        "groupBy": ["Agente"],
        "splitBy": [],
        "columns": ["Agente", "Venduto", "Costo"],
        "aggregations": {"Venduto": "sum", "Costo": "sum"},
        "filters": [{"field": "Anno", "type": "=", "value": "2024"}],
        "sort": [{"column": "Venduto", "dir": "desc"}]
    }
    """
    result = await db.execute(select(Report).where(Report.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    
    report.tabulator_config = config
    await db.commit()
    
    return {"success": True, "message": "Configurazione Tabulator salvata"}

    
@router.post('/{report_id}/grid')
async def execute_grid_query(
    report_id: int,
    request: GridRequest,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    # 1. Fetch Report
    result = await db.execute(select(Report).where(Report.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail='Report not found')

    # 2. Fetch Connection
    conn_result = await db.execute(select(Connection).where(Connection.id == report.connection_id))
    connection = conn_result.scalar_one_or_none()
    if not connection:
        raise HTTPException(status_code=400, detail='Connection not found')
    
    # 3. Execute
    try:
        config = {
            'host': connection.host,
            'port': connection.port,
            'database': connection.database,
            'username': connection.username,
            'password': decrypt_password(connection.password_encrypted),
            'ssl_enabled': connection.ssl_enabled
        }

        # Ensure pool is warm before query (eliminates cold start)
        QueryEngine.ensure_pool_warm(connection.db_type, config)

        rows, total, elapsed = await query_engine.execute_grid_query(
            connection.db_type,
            config,
            report.query,  # Base query
            request
        )
        
        return {
            'rows': rows,
            'lastRow': total,
            'elapsed_ms': elapsed
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post('/{report_id}/pivot-drill')
async def execute_pivot_drill(
    report_id: int,
    request: PivotDrillRequest,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    import time
    start_total = time.perf_counter()
    
    # 1. Fetch Report
    result = await db.execute(select(Report).where(Report.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail='Report not found')

    # 2. Fetch Connection
    conn_result = await db.execute(select(Connection).where(Connection.id == report.connection_id))
    connection = conn_result.scalar_one_or_none()
    if not connection:
        raise HTTPException(status_code=400, detail='Connection not found')
    
    # 3. Execute
    try:
        config = {
            'host': connection.host,
            'port': connection.port,
            'database': connection.database,
            'username': connection.username,
            'password': decrypt_password(connection.password_encrypted),
            'ssl_enabled': connection.ssl_enabled
        }

        # Ensure pool is warm before query (eliminates cold start)
        QueryEngine.ensure_pool_warm(connection.db_type, config)

        rows, total, elapsed_query = await query_engine.execute_pivot_drill(
            connection.db_type,
            config,
            report.query,  # Base query
            request
        )
        
        total_time = (time.perf_counter() - start_total) * 1000
        logger.info(f"⚡ PIVOT DRILL Report {report_id}: {total} rows. Query={elapsed_query:.1f}ms, Total={total_time:.1f}ms")
        
        return {
            'rows': rows,
            'count': total,
            'elapsed_ms': elapsed_query
        }
        
    except Exception as e:
        logger.error(f"❌ PIVOT DRILL Error Report {report_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
