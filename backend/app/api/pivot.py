"""
PIVOT API - High Performance Aggregations with Split By and Delta Calculations

This is the KEY endpoint that:
1. Aggregates data server-side with ROLLUP
2. Supports "Split By" (column pivoting) using Polars
3. Automatically calculates Delta columns for period comparisons
"""
import time
import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from app.db.database import get_db, Report, Connection
from app.core.deps import get_current_user
from app.core.security import decrypt_password
from app.services.query_engine import QueryEngine
from app.services.cache import cache

logger = logging.getLogger(__name__)
router = APIRouter()

# Enhanced Pivot Request with split_by
class MetricConfig(BaseModel):
    name: str
    field: Optional[str] = None
    type: str = "sum"
    aggregation: str = "SUM"
    revenueField: Optional[str] = None
    costField: Optional[str] = None

class EnhancedPivotRequest(BaseModel):
    group_by: List[str] = []          # Row grouping
    split_by: List[str] = []           # Multi-level column pivoting (e.g., ["Category", "Anno"])
    metrics: List[MetricConfig] = []   # Values to aggregate
    filters: dict = {}
    sort: Optional[List[dict]] = None
    calculate_delta: bool = True       # Auto-calculate differences
    limit: Optional[int] = None        # Limit aggregated rows for preview mode

@router.post("/{report_id}")
async def execute_pivot(
    report_id: int,
    request: EnhancedPivotRequest,
    force_refresh: bool = False,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    """
    Execute pivot query with optional multi-level column pivoting (Split By).

    When split_by is provided:
    1. SQL aggregates data by group_by + split_by dimensions
    2. Polars pivots the data (split_by values become hierarchical columns)
    3. Delta columns are calculated automatically

    Example:
    - group_by: ["Cliente"]
    - split_by: ["Category", "Anno"]
    - metrics: [{field: "Venduto", aggregation: "SUM"}]

    Result columns: Cliente | Electronics|2023 | Electronics|2024 | Furniture|2023 | ...
    """
    import polars as pl
    import pyarrow.ipc as ipc
    from io import BytesIO
    
    start_time = time.perf_counter()
    
    # Get report and connection
    result = await db.execute(
        select(Report, Connection)
        .join(Connection, Report.connection_id == Connection.id)
        .where(Report.id == report_id)
    )
    row = result.one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Report not found")
    
    report, connection = row
    
    # Build config hash for caching
    config = {
        "query": report.query,
        "group_by": request.group_by,
        "split_by": request.split_by,
        "metrics": [m.model_dump() for m in request.metrics],
        "filters": request.filters,
        "calculate_delta": request.calculate_delta
    }
    config_hash = QueryEngine.hash_config(config)
    
    # Check cache
    cache_hit = False
    if report.cache_enabled and not force_refresh:
        cached = await cache.get_pivot(report_id, config_hash)
        if cached:
            cache_hit = True
            arrow_bytes = cached
            row_count = -1
            elapsed = (time.perf_counter() - start_time) * 1000
            logger.info(f"Pivot cache HIT for report {report_id} in {elapsed:.1f}ms")
    
    if not cache_hit:
        # Build connection string
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
        
        # Merge default metrics with request metrics
        metrics = [m.model_dump() for m in request.metrics]
        if not metrics and report.default_metrics:
            metrics = report.default_metrics
        
        group_by = request.group_by or report.default_group_by or []
        split_by = request.split_by or []

        # Execute query with split_by support
        if split_by and len(split_by) > 0:
            arrow_bytes, row_count = await execute_pivot_with_split(
                conn_string,
                report.query,
                group_by,
                split_by,
                metrics,
                request.filters,
                request.calculate_delta,
                connection.db_type
            )
        else:
            # Standard pivot without split
            arrow_bytes, row_count, query_time = await QueryEngine.execute_pivot(
                conn_string,
                report.query,
                group_by,
                metrics,
                request.filters,
                request.limit  # Pass limit for preview mode
            )
        
        elapsed = (time.perf_counter() - start_time) * 1000
        logger.info(f"Pivot executed for report {report_id}: {row_count} rows in {elapsed:.1f}ms")
        
        # Cache result
        if report.cache_enabled:
            await cache.set_pivot(report_id, config_hash, arrow_bytes)
    
    return Response(
        content=arrow_bytes,
        media_type="application/vnd.apache.arrow.stream",
        headers={
            "X-Query-Time": f"{elapsed:.1f}",
            "X-Cache-Hit": str(cache_hit).lower(),
            "X-Row-Count": str(row_count) if row_count >= 0 else "cached",
        }
    )


async def execute_pivot_with_split(
    conn_string: str,
    base_query: str,
    group_by: List[str],
    split_by: List[str],
    metrics: List[dict],
    filters: dict,
    calculate_delta: bool,
    db_type: str
) -> tuple[bytes, int]:
    """
    Execute pivot with multi-level column splitting using Polars.

    This function:
    1. Fetches aggregated data from DB (group_by + all split_by dimensions)
    2. Creates hierarchical column paths by joining split_by values (e.g., "Electronics|2023")
    3. Pivots data using Polars (column paths become pivoted columns)
    4. Calculates Delta columns if requested
    5. Returns Arrow IPC bytes

    Example:
    - split_by: ["Category", "Anno"]
    - Creates columns: Electronics|2023, Electronics|2024, Furniture|2023, etc.
    """
    import polars as pl
    import connectorx as cx
    import pyarrow.ipc as ipc
    from io import BytesIO

    # DEBUG: Log split pivot parameters
    logger.info(f"🔍 execute_pivot_with_split called:")
    logger.info(f"   - group_by: {group_by}")
    logger.info(f"   - split_by: {split_by}")
    logger.info(f"   - metrics count: {len(metrics)}")
    if metrics:
        for i, m in enumerate(metrics[:3]):
            logger.info(f"   - metric[{i}]: field={m.get('field')}, agg={m.get('aggregation')}, name={m.get('name')}")

    is_mssql = "mssql" in conn_string or db_type == "mssql"

    # GROUP BY mode: Build aggregated SELECT
    select_parts = []

    # Group by columns (split_by is already a list, don't wrap it again!)
    all_groups = group_by + split_by
    for col in all_groups:
        if is_mssql:
            select_parts.append(f'[{col}]')
        else:
            select_parts.append(f'"{col}"')

    # Metrics - include ALL aggregations (SUM, AVG, COUNT, MIN, MAX)
    metric_names = []
    for m in metrics:
        agg = m.get('aggregation', 'SUM').upper()
        field = m.get('field', '')
        name = m.get('name', field)

        if field and agg in ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX']:
            metric_names.append(name)
            if is_mssql:
                select_parts.append(f'{agg}([{field}]) AS [{name}]')
            else:
                select_parts.append(f'{agg}("{field}") AS "{name}"')

    # Log what we're using
    logger.info(f"📊 Metrics for pivot: {metric_names}")

    # Build GROUP BY
    if is_mssql:
        group_clause = ', '.join(f'[{col}]' for col in all_groups)
    else:
        group_clause = ', '.join(f'"{col}"' for col in all_groups)

    # Build WHERE clause
    where_sql = ""
    if filters:
        conditions = []
        for field, filter_def in filters.items():
            col = f'[{field}]' if is_mssql else f'"{field}"'
            if filter_def.get('type') == 'contains':
                conditions.append(f"{col} LIKE '%{filter_def['value']}%'")
            elif filter_def.get('type') == 'equals':
                conditions.append(f"{col} = '{filter_def['value']}'")
        if conditions:
            where_sql = "WHERE " + " AND ".join(conditions)

    # Final SQL
    sql = f"""
        SELECT {', '.join(select_parts)}
        FROM ({base_query}) AS base_data
        {where_sql}
        GROUP BY {group_clause}
    """
    
    logger.info(f"Split pivot SQL: {sql[:300]}...")
    
    # Execute query
    arrow_table = cx.read_sql(conn_string, sql, return_type="arrow")
    df = pl.from_arrow(arrow_table)

    if df.is_empty():
        # Return empty result
        sink = BytesIO()
        with ipc.new_stream(sink, arrow_table.schema) as writer:
            writer.write_table(arrow_table)
        return sink.getvalue(), 0

    # Pivot with multi-level column hierarchy if split_by is present
    if split_by:
        # If no group_by, we cannot pivot (need at least one index column)
        if not group_by or len(group_by) == 0:
            logger.warning("⚠️ Cannot pivot with split_by when group_by is empty. Returning aggregated data without pivot.")
            result_df = df
        else:
            # Multi-level pivot: Create hierarchical column paths
            if len(split_by) > 1:
                df = df.with_columns([
                    pl.concat_str([pl.col(dim) for dim in split_by], separator="|").alias("_column_path")
                ])
                pivot_column = "_column_path"
            else:
                pivot_column = split_by[0]

            pivot_index = group_by
            logger.info(f"📊 Pivoting with aggregation, index={pivot_index}, column={pivot_column}")

            result_df = None
            for metric_name in metric_names:
                logger.info(f"   Pivoting '{metric_name}' with aggregation 'sum'")

                pivoted = df.pivot(
                    values=metric_name,
                    index=pivot_index,
                    columns=pivot_column,
                    aggregate_function='sum'
                )

                # Rename pivoted columns to include metric name
                rename_map = {}
                for col_name in pivoted.columns:
                    if col_name not in pivot_index:
                        rename_map[col_name] = f"{col_name}|{metric_name}"

                if rename_map:
                    pivoted = pivoted.rename(rename_map)

                if result_df is None:
                    result_df = pivoted
                else:
                    new_cols = [col for col in pivoted.columns if col not in pivot_index]
                    result_df = result_df.join(pivoted, on=pivot_index, how="outer", suffix="_DROP")
                    drop_cols = [col for col in result_df.columns if col.endswith("_DROP")]
                    if drop_cols:
                        result_df = result_df.drop(drop_cols)

            if result_df is None:
                result_df = df
    else:
        # No split_by: just return aggregated data
        result_df = df
    
    # Calculate Delta columns if requested
    # DISABLED: User doesn't need Delta functionality (causes arithmetic errors on mixed types)
    if False and calculate_delta and split_by:
        # Get the split_by column values (e.g., years)
        split_values = sorted([c for c in result_df.columns if c not in group_by])
        
        # If we have at least 2 periods, calculate delta
        if len(split_values) >= 2:
            # Get last two periods for comparison
            period_cols = [c for c in split_values if c not in group_by]
            if len(period_cols) >= 2:
                # Sort to get chronological order
                period_cols_sorted = sorted(period_cols, key=lambda x: str(x))
                prev_period = period_cols_sorted[-2]
                curr_period = period_cols_sorted[-1]
                
                # Calculate Delta (absolute difference)
                delta_col = f"Delta ({curr_period} - {prev_period})"
                result_df = result_df.with_columns([
                    (pl.col(str(curr_period)).fill_null(0) - pl.col(str(prev_period)).fill_null(0)).alias(delta_col)
                ])
                
                # Calculate Delta % (percentage change)
                delta_pct_col = "Delta %"
                result_df = result_df.with_columns([
                    pl.when(pl.col(str(prev_period)) != 0)
                    .then(
                        ((pl.col(str(curr_period)).fill_null(0) - pl.col(str(prev_period)).fill_null(0)) 
                         / pl.col(str(prev_period)).abs() * 100).round(2)
                    )
                    .otherwise(0)
                    .alias(delta_pct_col)
                ])

    # Clean up: Remove __row_index__ if it exists (used for pivoting without group_by)
    if "__row_index__" in result_df.columns:
        result_df = result_df.drop("__row_index__")

    # Convert to Arrow and serialize
    arrow_result = result_df.to_arrow()
    
    sink = BytesIO()
    with ipc.new_stream(sink, arrow_result.schema) as writer:
        writer.write_table(arrow_result)
    
    return sink.getvalue(), result_df.height


@router.get("/{report_id}/schema")
async def get_pivot_schema(
    report_id: int,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    """
    Get available columns and metrics for pivot configuration.
    Used by frontend to populate the pivot builder UI.
    """
    result = await db.execute(
        select(Report, Connection)
        .join(Connection, Report.connection_id == Connection.id)
        .where(Report.id == report_id)
    )
    row = result.one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Report not found")
    
    report, connection = row
    
    try:
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
        
        import connectorx as cx
        
        # Get just 1 row to infer schema
        if connection.db_type == "mssql":
            limit_query = f"SELECT TOP 1 * FROM ({report.query}) AS schema_query"
        else:
            limit_query = f"SELECT * FROM ({report.query}) AS schema_query LIMIT 1"
        
        logger.info(f"Executing schema query for report {report_id}")
        arrow_table = cx.read_sql(conn_string, limit_query, return_type="arrow")
        
        columns = []
        for field in arrow_table.schema:
            col_type = str(field.type)
            is_numeric = any(t in col_type.lower() for t in ['int', 'float', 'decimal', 'double', 'numeric'])
            
            # Detect date-like columns by name
            name_lower = field.name.lower()
            is_date = any(d in name_lower for d in ['date', 'data', 'anno', 'year', 'mese', 'month'])
            
            columns.append({
                "name": field.name,
                "type": "number" if is_numeric else ("date" if is_date else "string"),
                "label": report.column_labels.get(field.name, field.name) if report.column_labels else field.name
            })
        
        return {
            "columns": columns,
            "default_group_by": report.default_group_by or [],
            "default_split_by": None,
            "default_metrics": report.default_metrics or [],
            "available_metrics": report.available_metrics or []
        }
    except Exception as e:
        logger.error(f"Schema error for report {report_id}: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Errore nel caricamento dello schema: {str(e)}"
        )


# ============================================
# PIVOT CONFIGURATION - Save/Load
# ============================================

class PivotConfigSave(BaseModel):
    """Pivot configuration to save"""
    rows: List[str] = []
    columns: List[str] = []
    values: List[dict] = []  # [{id, name, field, aggregation}]

@router.post("/{report_id}/config")
async def save_pivot_config(
    report_id: int,
    config: PivotConfigSave,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    """
    Save pivot configuration to report.perspective_config
    This is used by the Report Editor (/reports/:id/edit)
    """
    try:
        # Get report
        result = await db.execute(select(Report).where(Report.id == report_id))
        report = result.scalar_one_or_none()
        if not report:
            raise HTTPException(status_code=404, detail="Report not found")

        # Save config in perspective_config field
        report.perspective_config = {
            "rows": config.rows,
            "columns": config.columns,
            "values": config.values
        }

        await db.commit()

        logger.info(f"Saved pivot config for report {report_id}: {config.model_dump()}")
        return {"success": True, "message": "Configurazione salvata"}

    except Exception as e:
        logger.error(f"Error saving pivot config: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{report_id}/config")
async def load_pivot_config(
    report_id: int,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    """
    Load saved pivot configuration from report.perspective_config
    This is used by the Report Viewer (/reports/:id/pivot)
    """
    try:
        # Get report
        result = await db.execute(select(Report).where(Report.id == report_id))
        report = result.scalar_one_or_none()
        if not report:
            raise HTTPException(status_code=404, detail="Report not found")

        # Return saved config or empty default
        config = report.perspective_config or {
            "rows": [],
            "columns": [],
            "values": []
        }

        logger.info(f"Loaded pivot config for report {report_id}")
        return config

    except Exception as e:
        logger.error(f"Error loading pivot config: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{report_id}/lazy")
async def execute_lazy_pivot(
    report_id: int,
    request: EnhancedPivotRequest,
    depth: int = 0,
    parent_filters: dict = {},
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    """
    Lazy loading endpoint for hierarchical pivot data.
    
    Returns only the requested level of grouping:
    - depth=0: Load root level (first group_by dimension)
    - depth=1: Load second level (requires parent_filters)
    
    Example:
    1. Initial: depth=0 → 50 categories
    2. Expand "Electronics": depth=1, parent_filters={"Category": "Electronics"} → subcategories
    """
    import pyarrow.ipc as ipc
    from io import BytesIO
    
    start_time = time.perf_counter()
    
    # Get report and connection
    result = await db.execute(
        select(Report, Connection)
        .join(Connection, Report.connection_id == Connection.id)
        .where(Report.id == report_id)
    )
    row = result.one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Report not found")
    
    report, connection = row
    
    # Validate depth
    if depth >= len(request.group_by):
        raise HTTPException(status_code=400, detail=f"Invalid depth {depth}")
    
    # Build connection string
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
    
    # Group by ONLY current level
    current_dimension = request.group_by[depth]
    combined_filters = {**request.filters, **parent_filters}
    
    # Execute query for this level only
    arrow_bytes, row_count, query_time = await QueryEngine.execute_pivot(
        conn_string,
        report.query,
        [current_dimension],
        [m.model_dump() for m in request.metrics],
        combined_filters,
        None
    )
    
    elapsed = (time.perf_counter() - start_time) * 1000
    logger.info(f"Lazy level {depth} for report {report_id}: {row_count} rows in {elapsed:.1f}ms")
    
    return Response(
        content=arrow_bytes,
        media_type="application/vnd.apache.arrow.stream",
        headers={
            "X-Row-Count": str(row_count),
            "X-Query-Time": f"{elapsed:.1f}",
            "X-Depth": str(depth)
        }
    )


@router.post("/{report_id}/grand-total")
async def get_grand_total(
    report_id: int,
    request: EnhancedPivotRequest,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    """
    Get grand total (no grouping, aggregate everything).
    Used for total row in lazy loading.
    """
    import pyarrow.ipc as ipc
    from io import BytesIO
    
    start_time = time.perf_counter()
    
    # Get report and connection
    result = await db.execute(
        select(Report, Connection)
        .join(Connection, Report.connection_id == Connection.id)
        .where(Report.id == report_id)
    )
    row = result.one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Report not found")
    
    report, connection = row
    
    # Build connection string
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
    
    # Execute with NO grouping
    arrow_bytes, row_count, query_time = await QueryEngine.execute_pivot(
        conn_string,
        report.query,
        [],  # No group by = grand total
        [m.model_dump() for m in request.metrics],
        request.filters,
        None
    )
    
    elapsed = (time.perf_counter() - start_time) * 1000
    
    return Response(
        content=arrow_bytes,
        media_type="application/vnd.apache.arrow.stream",
        headers={
            "X-Row-Count": str(row_count),
            "X-Query-Time": f"{elapsed:.1f}"
        }
    )
