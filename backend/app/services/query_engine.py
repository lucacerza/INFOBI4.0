"""
High-Performance Query Engine
- SQLAlchemy Connection Pooling: Pre-warmed connections eliminate cold start
- Polars DataFrame: Blazing fast in-memory operations
- Arrow IPC: Zero-copy binary serialization
- ThreadPoolExecutor: Non-blocking async DB queries
"""
import logging
import hashlib
import time
import asyncio
from typing import Optional, List, Dict, Any
from concurrent.futures import ThreadPoolExecutor
import polars as pl
import pyarrow as pa
import pyarrow.ipc as ipc
from io import BytesIO
from sqlalchemy import text
from app.models.schemas import GridRequest, PivotDrillRequest
from app.core.engine_pool import get_engine

logger = logging.getLogger(__name__)

# Thread pool for blocking DB operations
# Conservative: 4 workers to avoid pool exhaustion
_executor = ThreadPoolExecutor(max_workers=4)

# Track which connections have been warmed this session
_warmed_connections: set = set()

class QueryEngine:
    """Execute queries and return Arrow IPC format"""

    @staticmethod
    def ensure_pool_warm(conn_type: str, config: dict) -> None:
        """
        Ensure connection pool is warmed before executing query.
        This eliminates cold start delays by pre-establishing connections.
        Only warms once per unique connection per session.
        """
        pool_key = f"{conn_type}://{config['host']}:{config.get('port', 0)}/{config['database']}"

        if pool_key not in _warmed_connections:
            logger.info(f"🔥 Pre-warming pool for first query: {pool_key}")
            try:
                engine = get_engine(conn_type, config)
                with engine.connect() as conn:
                    conn.execute(text("SELECT 1"))
                _warmed_connections.add(pool_key)
            except Exception as e:
                logger.warning(f"Pool warm failed (will retry on query): {e}")

    @staticmethod
    def _execute_query_sync(db_type: str, config: dict, query: str) -> pa.Table:
        """Synchronous query execution using SQLAlchemy Pool"""
        engine = get_engine(db_type, config)
        with engine.connect() as conn:
            # Polars legge usando la connessione aperta del pool
            df = pl.read_database(query, connection=conn)
            return df.to_arrow()

    @staticmethod
    def _execute_df_sync(db_type: str, config: dict, query: str) -> pl.DataFrame:
        """Synchronous query execution returning Polars DataFrame (for Pivot/Split)"""
        engine = get_engine(db_type, config)
        with engine.connect() as conn:
            return pl.read_database(query, connection=conn)

    @staticmethod
    async def execute_query(
        db_type: str,
        config: dict,
        query: str,
        limit: Optional[int] = None
    ) -> tuple[bytes, int, float]:
        start = time.perf_counter()
        
        try:
            # Apply limit if specified
            if limit:
                if db_type == "mssql":
                    query = f"SELECT TOP {limit} * FROM ({query}) AS subq"
                else:
                    query = f"SELECT * FROM ({query}) AS subq LIMIT {limit}"
            
            # Run blocking DB operation in thread pool
            loop = asyncio.get_event_loop()
            arrow_table = await loop.run_in_executor(
                _executor,
                QueryEngine._execute_query_sync,
                db_type,
                config,
                query
            )
            
            # Serialize to IPC
            sink = BytesIO()
            with ipc.new_stream(sink, arrow_table.schema) as writer:
                writer.write_table(arrow_table)
            
            elapsed = (time.perf_counter() - start) * 1000
            arrow_bytes = sink.getvalue()
            
            logger.info(f"Query executed: {arrow_table.num_rows} rows in {elapsed:.1f}ms")
            
            return arrow_bytes, arrow_table.num_rows, elapsed
            
        except Exception as e:
            elapsed = (time.perf_counter() - start) * 1000
            logger.error(f"Query error after {elapsed:.1f}ms: {e}")
            raise
    
    @staticmethod
    async def execute_pivot(
        db_type: str,
        config: dict,
        base_query: str,
        group_by: List[str],
        metrics: List[Dict[str, Any]],
        filters: Optional[Dict[str, Any]] = None,
        limit: Optional[int] = None
    ) -> tuple[bytes, int, float]:
        """
        Execute pivot query with ROLLUP for correct aggregations
        Returns: (arrow_bytes, row_count, execution_time_ms)
        """
        start_total = time.perf_counter()
        
        try:
            is_mssql = db_type == "mssql"

            logger.info(f"🔍 execute_pivot called with groups={group_by}, metrics={len(metrics)}")
            
            # --- MEASURE SQL EXECUTION TIME ---
            start_sql = time.perf_counter()

            # CASE 1: No group_by and no metrics → FLAT TABLE (raw data with all columns)
            if not group_by and not metrics:
                row_limit = limit if limit else 10000
                limited_query = f"SELECT TOP {row_limit} * FROM ({base_query}) AS raw_data" if is_mssql else f"SELECT * FROM ({base_query}) AS raw_data LIMIT {row_limit}"

                loop = asyncio.get_event_loop()
                arrow_table = await loop.run_in_executor(
                    _executor,
                    QueryEngine._execute_query_sync,
                    db_type,
                    config,
                    limited_query
                )
            


                sink = BytesIO()
                with ipc.new_stream(sink, arrow_table.schema) as writer:
                    writer.write_table(arrow_table)

                elapsed = (time.perf_counter() - start) * 1000
                logger.info(f"📊 FLAT TABLE mode: {arrow_table.num_rows} rows, {len(arrow_table.schema)} columns ({elapsed:.1f}ms)")
                return sink.getvalue(), arrow_table.num_rows, elapsed

            # Build SELECT clause
            start_build = time.perf_counter()
            select_parts = []
            
            # Group by columns
            for col in group_by:
                select_parts.append(f'[{col}]' if is_mssql else f'"{col}"')
            
            # Metrics with aggregations
            for m in metrics:
                if m.get('type') == 'margin':
                    # Margin formula: (revenue - cost) / revenue * 100
                    rev = m.get('revenueField', m.get('field', 'Venduto'))
                    cost = m.get('costField', 'Costo')
                    col_name = m.get('name', 'MarginePerc')
                    if is_mssql:
                        select_parts.append(f'''
                            CASE 
                                WHEN SUM([{rev}]) = 0 THEN 0 
                                ELSE ROUND(CAST((SUM([{rev}]) - SUM([{cost}])) * 100.0 / SUM([{rev}]) AS DECIMAL(10,2)), 2)
                            END AS [{col_name}]
                        ''')
                    else:
                        select_parts.append(f'''
                            CASE 
                                WHEN SUM("{rev}") = 0 THEN 0 
                                ELSE ROUND(CAST((SUM("{rev}") - SUM("{cost}")) * 100.0 / SUM("{rev}") AS DECIMAL(10,2)), 2)
                            END AS "{col_name}"
                        ''')
                else:
                    agg = m.get('aggregation', 'SUM').upper()
                    field = m.get('field', '')
                    name = m.get('name', field)
                    if field:
                        # FIX: Handle COUNT(*) correctly without quoting *
                        if field == '*':
                            select_parts.append(f'{agg}(*) AS [{name}]' if is_mssql else f'{agg}(*) AS "{name}"')
                        elif is_mssql:
                            select_parts.append(f'{agg}([{field}]) AS [{name}]')
                        else:
                            select_parts.append(f'{agg}("{field}") AS "{name}"')
            
            # If no select parts, select all
            if not select_parts:
                select_parts = ['*']
            
            # Build GROUP BY with ROLLUP for initial flat loading 
            # (Note: This old execute_pivot might be deprecated by execute_pivot_drill later)
            if group_by:
                if is_mssql:
                    group_clause = ', '.join(f'[{col}]' for col in group_by)
                    # Use standard grouping for now to avoid complexity of handling rollup structure in UI
                    # unless standard grouping is requested.
                    group_by_sql = f"GROUP BY {group_clause}" 
                    order_by_sql = f"ORDER BY {group_clause}"
                else:
                    group_clause = ', '.join(f'"{col}"' for col in group_by)
                    group_by_sql = f"GROUP BY {group_clause}"
                    order_by_sql = f"ORDER BY {group_clause}"
            else:
                group_by_sql = ""
                order_by_sql = ""
            
            # Build WHERE clause from filters
            where_sql = ""
            if filters:
                conditions = []
                for field, filter_def in filters.items():
                    col = f'[{field}]' if is_mssql else f'"{field}"'
                    if filter_def.get('type') == 'contains':
                        conditions.append(f"{col} LIKE '%{filter_def['value']}%'")
                    elif filter_def.get('type') == 'equals':
                        conditions.append(f"{col} = '{filter_def['value']}'")
                    elif filter_def.get('type') == 'greaterThan':
                        conditions.append(f"{col} > {filter_def['value']}")
                    elif filter_def.get('type') == 'lessThan':
                        conditions.append(f"{col} < {filter_def['value']}")
                    elif filter_def.get('type') == 'greaterThanOrEqual':
                        conditions.append(f"{col} >= {filter_def['value']}")
                    elif filter_def.get('type') == 'lessThanOrEqual':
                        conditions.append(f"{col} <= {filter_def['value']}")
                    elif filter_def.get('type') == 'notEqual':
                        conditions.append(f"{col} != '{filter_def['value']}'")
                    elif filter_def.get('type') == 'isNotNull':
                        conditions.append(f"{col} IS NOT NULL")
                    elif filter_def.get('type') == 'isNull':
                        conditions.append(f"{col} IS NULL")

                if conditions:
                    where_sql = "WHERE " + " AND ".join(conditions)
            
            # Build LIMIT clause for preview mode
            limit_sql = ""
            if limit:
                if is_mssql:
                    limit_sql = f"TOP {limit}"
                    sql = f"""
                        SELECT {limit_sql} {', '.join(select_parts)}
                        FROM ({base_query}) AS base_data
                        {where_sql}
                        {group_by_sql}
                        {order_by_sql}
                    """
                else:
                    sql = f"""
                        SELECT {', '.join(select_parts)}
                        FROM ({base_query}) AS base_data
                        {where_sql}
                        {group_by_sql}
                        {order_by_sql}
                        LIMIT {limit}
                    """
            else:
                 sql = f"""
                    SELECT {', '.join(select_parts)}
                    FROM ({base_query}) AS base_data
                    {where_sql}
                    {group_by_sql}
                    {order_by_sql}
                """
            
            logger.info(f"Pivot SQL: {sql[:500]}...")
            
            # Execute
            loop = asyncio.get_event_loop()
            arrow_table = await loop.run_in_executor(
                _executor,
                QueryEngine._execute_query_sync,
                db_type,
                config,
                sql
            )
            
            # Serialize to IPC
            sink = BytesIO()
            with ipc.new_stream(sink, arrow_table.schema) as writer:
                writer.write_table(arrow_table)
            
            elapsed = (time.perf_counter() - start) * 1000
            arrow_bytes = sink.getvalue()
            
            logger.info(f"Pivot executed: {arrow_table.num_rows} rows in {elapsed:.1f}ms")
            
            return arrow_bytes, arrow_table.num_rows, elapsed
            
        except Exception as e:
            logger.error(f"Pivot error: {e}")
            raise
    
    @staticmethod
    async def execute_grid_query(
        db_type: str,
        config: dict,
        base_query: str,
        request: GridRequest
    ) -> tuple[List[Dict[str, Any]], int, float]:
        """
        Execute query with server-side pagination, sorting, and filtering.
        Returns: (rows, total_count, execution_time_ms)
        """
        start = time.perf_counter()
        
        try:
            # 1. Build WHERE clause (Basic implementation - requires sanitization in prod)
            where_clauses = []
            
            for col, filter_def in request.filterModel.items():
                # Basic sanitization for col name to prevent obvious injection
                clean_col = "".join(c for c in col if c.isalnum() or c in '_')
                
                val = filter_def.filter
                if isinstance(val, str):
                    val = val.replace("'", "''") # Escape single quotes
                    
                if filter_def.type == 'contains':
                    where_clauses.append(f"{clean_col} LIKE '%{val}%'")
                elif filter_def.type == 'equals':
                    if isinstance(val, str):
                        where_clauses.append(f"{clean_col} = '{val}'")
                    else:
                        where_clauses.append(f"{clean_col} = {val}")
                elif filter_def.type == 'startsWith':
                    where_clauses.append(f"{clean_col} LIKE '{val}%'")
                elif filter_def.type == 'notEqual':
                    if isinstance(val, str): where_clauses.append(f"{clean_col} != '{val}'")
                    else: where_clauses.append(f"{clean_col} != {val}")
                elif filter_def.type == 'greaterThan':
                    where_clauses.append(f"{clean_col} > {val}")
                elif filter_def.type == 'greaterThanOrEqual':
                    where_clauses.append(f"{clean_col} >= {val}")
                elif filter_def.type == 'lessThan':
                    where_clauses.append(f"{clean_col} < {val}")
                elif filter_def.type == 'lessThanOrEqual':
                    where_clauses.append(f"{clean_col} <= {val}")
                elif filter_def.type == 'isNotNull':
                    where_clauses.append(f"{clean_col} IS NOT NULL")
                elif filter_def.type == 'isNull':
                    where_clauses.append(f"{clean_col} IS NULL")
            
            where_sql = " WHERE " + " AND ".join(where_clauses) if where_clauses else ""
            
            # 2. Build ORDER BY
            order_clauses = []
            for sort in request.sortModel:
                clean_col = "".join(c for c in sort.colId if c.isalnum() or c in '_')
                direction = "DESC" if sort.sort == "desc" else "ASC"
                order_clauses.append(f"{clean_col} {direction}")
            
            order_sql = " ORDER BY " + ", ".join(order_clauses) if order_clauses else ""
            
            # 3. Construct SQL
            is_mssql = db_type == "mssql"
            limit = request.endRow - request.startRow
            offset = request.startRow
            
            # Wrap base query to treat it as a table
            wrapped_base = f"SELECT * FROM ({base_query}) AS base"
            full_sql_structure = f"{wrapped_base} {where_sql}"
            
            # Get Total Count
            count_query = f"SELECT COUNT(*) as total FROM ({full_sql_structure}) AS count_tbl"
            
            engine = get_engine(db_type, config)
            with engine.connect() as conn:
                count_df = pl.read_database(count_query, connection=conn)
                total_rows = int(count_df['total'][0]) if not count_df.is_empty() else 0
            
            # Fetch Page
            if is_mssql:
                if not order_sql:
                     order_sql = "ORDER BY (SELECT NULL)"
                data_query = f"{full_sql_structure} {order_sql} OFFSET {offset} ROWS FETCH NEXT {limit} ROWS ONLY"
            else:
                data_query = f"{full_sql_structure} {order_sql} LIMIT {limit} OFFSET {offset}"
            
            # Execute
            with engine.connect() as conn:
                data_df = pl.read_database(data_query, connection=conn)
            
            rows = data_df.to_dicts()
            
            elapsed = (time.perf_counter() - start) * 1000
            logger.info(f"Grid query: {len(rows)}/{total_rows} rows in {elapsed:.1f}ms")
            
            return rows, total_rows, elapsed
            
        except Exception as e:
            logger.error(f"Grid query error: {e}")
            raise

    @staticmethod
    async def execute_pivot_drill(
        db_type: str,
        config: dict,
        base_query: str,
        request: PivotDrillRequest
    ) -> tuple[List[Dict[str, Any]], int, float]:
        """
        Executes a Drill-Down query for Lazy Loading.
        Calculates aggregations for the specific node requested.
        """
        start = time.perf_counter()
        try:
            # 1. Determine which column we are expanding
            current_level = len(request.groupKeys)
            
            # Special Case: No Groups Defined -> Return Flat Paginated Data
            if len(request.rowGroupCols) == 0:
                 is_mssql = db_type == "mssql"
                 
                 # Determine columns to select
                 select_parts = []
                 added_cols = set() # Track added columns to prevent duplicates
                 
                 # 1. Add Pivot/Split columns first (so they appear on left)
                 for p_col in request.pivotCols:
                     if p_col not in added_cols:
                        if is_mssql: select_parts.append(f"[{p_col}]")
                        else: select_parts.append(f'"{p_col}"')
                        added_cols.add(p_col)

                 # 2. Add Value/Metric columns
                 for val_col in request.valueCols:
                    # In flat mode, valueCols are just columns to show
                    # We strip aggregation if present, or just use the colId
                    col_id = val_col.colId
                    if col_id not in added_cols:
                        if is_mssql: select_parts.append(f"[{col_id}]")
                        else: select_parts.append(f'"{col_id}"')
                        added_cols.add(col_id)
                 
                 if not select_parts:
                     select_parts = ["*"]

                 base_select = f"SELECT {', '.join(select_parts)} FROM ({base_query}) AS base"
                 
                 # Apply filters
                 where_clauses = []
                 for col, filter_def in request.filterModel.items():
                    clean_col = "".join(c for c in col if c.isalnum() or c in '_')
                    val = filter_def.filter
                    if isinstance(val, str): val = val.replace("'", "''")
                    
                    if filter_def.type == 'contains': where_clauses.append(f"{clean_col} LIKE '%{val}%'")
                    elif filter_def.type == 'equals':
                        if isinstance(val, str): where_clauses.append(f"{clean_col} = '{val}'")
                        else: where_clauses.append(f"{clean_col} = {val}")
                    elif filter_def.type == 'notEqual':
                        if isinstance(val, str): where_clauses.append(f"{clean_col} != '{val}'")
                        else: where_clauses.append(f"{clean_col} != {val}")
                    elif filter_def.type == 'greaterThan':
                        where_clauses.append(f"{clean_col} > {val}")
                    elif filter_def.type == 'greaterThanOrEqual':
                        where_clauses.append(f"{clean_col} >= {val}")
                    elif filter_def.type == 'lessThan':
                        where_clauses.append(f"{clean_col} < {val}")
                    elif filter_def.type == 'lessThanOrEqual':
                        where_clauses.append(f"{clean_col} <= {val}")
                    elif filter_def.type == 'isNotNull':
                        where_clauses.append(f"{clean_col} IS NOT NULL")
                    elif filter_def.type == 'isNull':
                        where_clauses.append(f"{clean_col} IS NULL")
                 
                 if where_clauses:
                     base_select += " WHERE " + " AND ".join(where_clauses)
                 
                 # Apply Sorting
                 order_sql = ""
                 if request.sortModel:
                    order_clauses = []
                    for sort in request.sortModel:
                        clean_col = "".join(c for c in sort.colId if c.isalnum() or c in '_')
                        direction = "DESC" if sort.sort == "desc" else "ASC"
                        order_clauses.append(f"{clean_col} {direction}")
                    order_sql = " ORDER BY " + ", ".join(order_clauses)

                 # Apply Pagination
                 start_row = request.startRow or 0
                 end_row = request.endRow or 100
                 limit = end_row - start_row
                 
                 if is_mssql:
                     if start_row == 0 and not order_sql:
                         full_query = base_select.replace("SELECT", f"SELECT TOP {limit}", 1)
                     else:
                         if not order_sql: order_sql = " ORDER BY (SELECT NULL)"
                         full_query = f"{base_select}{order_sql} OFFSET {start_row} ROWS FETCH NEXT {limit} ROWS ONLY"
                 else:
                     # Standard SQL (SQLite, Postgres, MySQL)
                     full_query = f"{base_select}{order_sql} LIMIT {limit} OFFSET {start_row}"

                 engine = get_engine(db_type, config)
                 with engine.connect() as conn:
                     data_df = pl.read_database(full_query, connection=conn)
                 
                 rows = data_df.to_dicts()
                 elapsed = (time.perf_counter() - start) * 1000
                 return rows, len(rows), elapsed

            # If we digged deeper than defined groups, return empty (shouldn't happen in logic)
            if current_level >= len(request.rowGroupCols):
                 return [], 0, 0
            
            group_col = request.rowGroupCols[current_level] # The column to group by NOW
            
            # 2. Build WHERE clauses
            where_clauses = []
            
            # 2a. Parent Path Filters (The "Drill-Down" constraints)
            # e.g. groupKeys=['Europe'] -> WHERE Region='Europe'
            for idx, key in enumerate(request.groupKeys):
                parent_col = request.rowGroupCols[idx]
                val = key
                if isinstance(val, str):
                   val = val.replace("'", "''")
                   where_clauses.append(f"{parent_col} = '{val}'")
                else:
                   where_clauses.append(f"{parent_col} = {val}")
            
            # 2b. Global filters from UI
            for col, filter_def in request.filterModel.items():
                clean_col = "".join(c for c in col if c.isalnum() or c in '_')
                val = filter_def.filter
                if isinstance(val, str):
                    val = val.replace("'", "''")
                if filter_def.type == 'contains':
                    where_clauses.append(f"{clean_col} LIKE '%{val}%'")
                elif filter_def.type == 'equals':
                     if isinstance(val, str): where_clauses.append(f"{clean_col} = '{val}'")
                     else: where_clauses.append(f"{clean_col} = {val}")
                elif filter_def.type == 'notEqual':
                    if isinstance(val, str): where_clauses.append(f"{clean_col} != '{val}'")
                    else: where_clauses.append(f"{clean_col} != {val}")
                elif filter_def.type == 'greaterThan':
                    where_clauses.append(f"{clean_col} > {val}")
                elif filter_def.type == 'greaterThanOrEqual':
                    where_clauses.append(f"{clean_col} >= {val}")
                elif filter_def.type == 'lessThan':
                    where_clauses.append(f"{clean_col} < {val}")
                elif filter_def.type == 'lessThanOrEqual':
                    where_clauses.append(f"{clean_col} <= {val}")
                elif filter_def.type == 'isNotNull':
                    where_clauses.append(f"{clean_col} IS NOT NULL")
                elif filter_def.type == 'isNull':
                    where_clauses.append(f"{clean_col} IS NULL")
            
            where_sql = " WHERE " + " AND ".join(where_clauses) if where_clauses else ""
            
            # 3. Build Select & Aggregations
            select_parts = [f"{group_col} as key_val"] # Key column used for tree structure
            group_by_parts = [group_col]
            
            # Support for Split By (Pivot Columns)
            # If pivotCols are present, we must include them in SELECT and GROUP BY
            for pivot_col in request.pivotCols:
                select_parts.append(f"{pivot_col} as {pivot_col}")
                group_by_parts.append(pivot_col)

            for val_col in request.valueCols:
                col_id = val_col.colId
                agg = val_col.aggFunc.upper()
                if agg == 'COUNT':
                     select_parts.append(f"COUNT(*) as {col_id}")
                else:
                    # Basic SUM, AVG, MIN, MAX
                    select_parts.append(f"{agg}({col_id}) as {col_id}")
            
            select_sql = ", ".join(select_parts)
            group_by_sql = ", ".join(group_by_parts)
            
            # 4. Construct SQL with Pagination for Groups (Drill-Down)
            # This prevents crashing when a group has thousands of children
            
            # Default pagination if not provided (safety net)
            limit_val = (request.endRow or 1000) - (request.startRow or 0)
            offset_val = request.startRow or 0
            
            # Build ORDER BY
            order_sql = ""
            if request.sortModel:
                order_clauses = []
                for sort in request.sortModel:
                    clean_col = "".join(c for c in sort.colId if c.isalnum() or c in '_')
                    direction = "DESC" if sort.sort == "desc" else "ASC"
                    order_clauses.append(f"{clean_col} {direction}")
                order_sql = "ORDER BY " + ", ".join(order_clauses)
            else:
                order_sql = f"ORDER BY {group_col} ASC"

            is_mssql_drill = db_type == "mssql"

            if is_mssql_drill:
                # MSSQL Pagination requires ORDER BY
                # Verify if group_col is valid for ordering
                full_query = f"""
                    SELECT {select_sql}
                    FROM ({base_query}) AS base
                    {where_sql}
                    GROUP BY {group_by_sql}
                    {order_sql}
                    OFFSET {offset_val} ROWS FETCH NEXT {limit_val} ROWS ONLY
                """
            else:
                # Standard SQL Pagination
                full_query = f"""
                    SELECT {select_sql}
                    FROM ({base_query}) AS base
                    {where_sql}
                    GROUP BY {group_by_sql}
                    {order_sql}
                    LIMIT {limit_val} OFFSET {offset_val}
                """
            
            # Execute
            engine = get_engine(db_type, config)
            with engine.connect() as conn:
                data_df = pl.read_database(full_query, connection=conn)
            rows = data_df.to_dicts()
            
            elapsed = (time.perf_counter() - start) * 1000
            return rows, len(rows), elapsed
            
        except Exception as e:
            logger.error(f"Pivot drill error: {e}")
            raise

    @staticmethod
    async def get_column_values(db_type: str, config: dict, base_query: str, column: str) -> List[Any]:
        """Fetch distinct sorted values for a column (used for Pivot Headers)"""
        try:
             # Sanitization
             clean_col = "".join(c for c in column if c.isalnum() or c in '_')
             
             query = f"SELECT DISTINCT {clean_col} FROM ({base_query}) AS base ORDER BY {clean_col}"
             engine = get_engine(db_type, config)
             with engine.connect() as conn:
                 df = pl.read_database(query, connection=conn)
             
             # Handle potential None/Null values
             values = df[clean_col].to_list()
             return [v for v in values if v is not None]
             
        except Exception as e:
            logger.error(f"Get values error: {e}")
            return []

    @staticmethod
    def hash_config(config: dict) -> str:
        """Create hash of pivot configuration for caching"""
        import json
        content = json.dumps(config, sort_keys=True)
        return hashlib.md5(content.encode()).hexdigest()[:16]

# Singleton
query_engine = QueryEngine()
