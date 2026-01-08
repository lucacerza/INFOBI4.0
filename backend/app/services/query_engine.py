"""
High-Performance Query Engine
- ConnectorX: 10x faster than pandas for DB reads
- Polars: Blazing fast DataFrame operations
- Arrow IPC: Zero-copy serialization
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
from urllib.parse import quote_plus

logger = logging.getLogger(__name__)

# Thread pool for blocking DB operations
_executor = ThreadPoolExecutor(max_workers=4)

class QueryEngine:
    """Execute queries and return Arrow IPC format"""
    
    @staticmethod
    def build_connection_string(conn_type: str, config: dict) -> str:
        """Build connection string for ConnectorX with optimizations"""
        # URL-encode password to handle special characters
        password = quote_plus(config['password'])
        username = quote_plus(config['username'])
        
        if conn_type == "mssql":
            # Optimized SQL Server connection string
            # - TrustServerCertificate: Skip SSL verification (faster)
            # - Connection Timeout: 30 seconds
            # - ApplicationIntent: ReadOnly for analytics queries
            return (
                f"mssql://{username}:{password}@{config['host']}:{config.get('port', 1433)}/{config['database']}"
                f"?TrustServerCertificate=true"
                f"&Connection+Timeout=30"
                f"&ApplicationIntent=ReadOnly"
            )
        elif conn_type == "postgresql":
            return (
                f"postgresql://{username}:{password}@{config['host']}:{config.get('port', 5432)}/{config['database']}"
                f"?connect_timeout=30"
            )
        elif conn_type == "mysql":
            return (
                f"mysql://{username}:{password}@{config['host']}:{config.get('port', 3306)}/{config['database']}"
                f"?connect_timeout=30"
            )
        else:
            raise ValueError(f"Unsupported database type: {conn_type}")
    
    @staticmethod
    def _execute_query_sync(conn_string: str, query: str) -> pa.Table:
        """Synchronous query execution (runs in thread pool)"""
        import connectorx as cx
        return cx.read_sql(conn_string, query, return_type="arrow")
    
    @staticmethod
    async def execute_query(
        conn_string: str,
        query: str,
        limit: Optional[int] = None
    ) -> tuple[bytes, int, float]:
        """
        Execute query and return Arrow IPC bytes
        Returns: (arrow_bytes, row_count, execution_time_ms)
        """
        start = time.perf_counter()
        
        try:
            # Apply limit if specified
            if limit:
                if "mssql" in conn_string:
                    query = f"SELECT TOP {limit} * FROM ({query}) AS subq"
                else:
                    query = f"SELECT * FROM ({query}) AS subq LIMIT {limit}"
            
            # Run blocking DB operation in thread pool
            loop = asyncio.get_event_loop()
            arrow_table = await loop.run_in_executor(
                _executor,
                QueryEngine._execute_query_sync,
                conn_string,
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
        conn_string: str,
        base_query: str,
        group_by: List[str],
        metrics: List[Dict[str, Any]],
        filters: Optional[Dict[str, Any]] = None,
        limit: Optional[int] = None
    ) -> tuple[bytes, int, float]:
        """
        Execute pivot query with ROLLUP for correct aggregations
        Returns: (arrow_bytes, row_count, execution_time_ms)

        Args:
            limit: If provided, limits aggregated rows for preview mode (e.g., 100)
        """
        start = time.perf_counter()
        
        try:
            is_mssql = "mssql" in conn_string

            # DEBUG: Log input parameters with full details
            logger.info(f"🔍 execute_pivot called:")
            logger.info(f"   - group_by: {group_by}")
            logger.info(f"   - metrics count: {len(metrics) if metrics else 0}")
            if metrics:
                for i, m in enumerate(metrics[:3]):  # Log first 3 metrics
                    logger.info(f"   - metric[{i}]: field={m.get('field')}, agg={m.get('aggregation')}, name={m.get('name')}")
            logger.info(f"   - filters: {filters}")
            logger.info(f"   - limit: {limit}")

            # CASE 1: No group_by and no metrics → FLAT TABLE (raw data with all columns)
            if not group_by and not metrics:
                row_limit = limit if limit else 10000
                limited_query = f"SELECT TOP {row_limit} * FROM ({base_query}) AS raw_data" if is_mssql else f"SELECT * FROM ({base_query}) AS raw_data LIMIT {row_limit}"

                loop = asyncio.get_event_loop()
                arrow_table = await loop.run_in_executor(
                    _executor,
                    QueryEngine._execute_query_sync,
                    conn_string,
                    limited_query
                )

                sink = BytesIO()
                with ipc.new_stream(sink, arrow_table.schema) as writer:
                    writer.write_table(arrow_table)

                elapsed = (time.perf_counter() - start) * 1000
                logger.info(f"📊 FLAT TABLE mode: {arrow_table.num_rows} rows, {len(arrow_table.schema)} columns ({elapsed:.1f}ms)")
                return sink.getvalue(), arrow_table.num_rows, elapsed

            # CASE 2: No group_by but has metrics → SELECT only specified columns (no aggregation!)
            # User wants to see specific columns from the raw data (like a filtered view)
            if not group_by and metrics:
                row_limit = limit if limit else 10000

                # Build SELECT for requested columns only
                select_cols = []
                for m in metrics:
                    field = m.get('field', '')
                    if field:
                        if is_mssql:
                            select_cols.append(f'[{field}]')
                        else:
                            select_cols.append(f'"{field}"')

                if not select_cols:
                    select_cols = ['*']

                select_clause = ', '.join(select_cols)
                limited_query = f"SELECT TOP {row_limit} {select_clause} FROM ({base_query}) AS raw_data" if is_mssql else f"SELECT {select_clause} FROM ({base_query}) AS raw_data LIMIT {row_limit}"

                loop = asyncio.get_event_loop()
                arrow_table = await loop.run_in_executor(
                    _executor,
                    QueryEngine._execute_query_sync,
                    conn_string,
                    limited_query
                )

                sink = BytesIO()
                with ipc.new_stream(sink, arrow_table.schema) as writer:
                    writer.write_table(arrow_table)

                elapsed = (time.perf_counter() - start) * 1000
                logger.info(f"📊 COLUMN SELECT mode: {arrow_table.num_rows} rows, {len(select_cols)} columns ({elapsed:.1f}ms)")
                return sink.getvalue(), arrow_table.num_rows, elapsed
            
            # Build SELECT clause
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
                        if is_mssql:
                            select_parts.append(f'{agg}([{field}]) AS [{name}]')
                        else:
                            select_parts.append(f'{agg}("{field}") AS "{name}"')
            
            # If no select parts, select all
            if not select_parts:
                select_parts = ['*']
            
            # Build GROUP BY with ROLLUP
            if group_by:
                if is_mssql:
                    group_clause = ', '.join(f'[{col}]' for col in group_by)
                    group_by_sql = f"GROUP BY ROLLUP({group_clause})"
                    # SQL Server ORDER BY without NULLS FIRST
                    order_parts = []
                    for i, col in enumerate(group_by):
                        order_parts.append(f"CASE WHEN [{col}] IS NULL THEN 0 ELSE 1 END, [{col}]")
                    order_by_sql = "ORDER BY " + ", ".join(order_parts)
                else:
                    group_clause = ', '.join(f'"{col}"' for col in group_by)
                    group_by_sql = f"GROUP BY ROLLUP({group_clause})"
                    order_by_sql = "ORDER BY " + ", ".join(f"{i+1} NULLS FIRST" for i in range(len(group_by)))
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
                if conditions:
                    where_sql = "WHERE " + " AND ".join(conditions)
            
            # Build LIMIT clause for preview mode
            # IMPORTANT: Only apply LIMIT when there's NO group_by (raw data mode)
            # When group_by is present, data is already aggregated and should not be limited
            limit_sql = ""
            if limit and not group_by:
                if is_mssql:
                    # SQL Server uses TOP in SELECT clause, so we need to wrap
                    limit_sql = f"TOP {limit}"
                    # Insert TOP after SELECT
                    sql = f"""
                        SELECT {limit_sql} {', '.join(select_parts)}
                        FROM ({base_query}) AS base_data
                        {where_sql}
                        {group_by_sql}
                        {order_by_sql}
                    """
                else:
                    # PostgreSQL/MySQL use LIMIT at the end
                    sql = f"""
                        SELECT {', '.join(select_parts)}
                        FROM ({base_query}) AS base_data
                        {where_sql}
                        {group_by_sql}
                        {order_by_sql}
                        LIMIT {limit}
                    """
            else:
                # No limit (either limit not specified, or data is aggregated)
                sql = f"""
                    SELECT {', '.join(select_parts)}
                    FROM ({base_query}) AS base_data
                    {where_sql}
                    {group_by_sql}
                    {order_by_sql}
                """
            
            logger.info(f"Pivot SQL: {sql[:500]}...")
            
            # Execute in thread pool
            loop = asyncio.get_event_loop()
            arrow_table = await loop.run_in_executor(
                _executor,
                QueryEngine._execute_query_sync,
                conn_string,
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
            elapsed = (time.perf_counter() - start) * 1000
            logger.error(f"Pivot error after {elapsed:.1f}ms: {e}")
            raise
    
    @staticmethod
    def hash_config(config: dict) -> str:
        """Create hash of pivot configuration for caching"""
        import json
        content = json.dumps(config, sort_keys=True)
        return hashlib.md5(content.encode()).hexdigest()[:16]

# Singleton
query_engine = QueryEngine()
