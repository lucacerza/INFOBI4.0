"""
Connection Warm-Up System
Eliminates cold start delays by pre-initializing connection pools at backend startup.

When warm-up runs:
- Executes at backend container startup (before any user login)
- Pre-initializes SQLAlchemy connection pools for all databases
- Pools maintain persistent connections across ALL requests
- Only happens ONCE per backend restart

Benefits:
- First query from ANY user on ANY PC is fast (no 195s wait)
- Multi-database support (SQL Server, PostgreSQL, MySQL, etc.)
- Connections persist until backend restart (pooled, not recreated)
"""
import logging
import asyncio
import time
from typing import List, Dict, Any
from sqlalchemy import select, distinct, text
from app.db.database import AsyncSessionLocal, Report, Connection
from app.core.security import decrypt_password
from app.core.engine_pool import get_engine

logger = logging.getLogger(__name__)


async def warm_up_connections():
    """
    Warm-up all database connections used by reports.

    This runs at backend startup and initializes connections to all databases
    that have reports defined. The connections are global (backend-side) and
    shared across all users and client connections.
    """
    try:
        logger.info("🔥 Starting database connection warm-up...")
        start_time = time.time()

        # Get all unique connections used by reports
        connections_to_warm = await get_report_connections()

        if not connections_to_warm:
            logger.info("⚪ No connections found to warm up (no reports defined yet)")
            return

        logger.info(f"🔥 Found {len(connections_to_warm)} database(s) to warm up:")
        for conn in connections_to_warm:
            logger.info(f"   - {conn['name']} ({conn['db_type']})")

        # Warm up each connection in parallel
        tasks = [
            warm_up_single_connection(conn)
            for conn in connections_to_warm
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Log results
        success_count = sum(1 for r in results if r is True)
        fail_count = len(results) - success_count

        elapsed = time.time() - start_time

        if fail_count == 0:
            logger.info(f"✅ Warm-up complete! All {success_count} connection(s) ready ({elapsed:.1f}s)")
        else:
            logger.warning(f"⚠️ Warm-up partial: {success_count} OK, {fail_count} failed ({elapsed:.1f}s)")

    except Exception as e:
        logger.error(f"❌ Warm-up failed: {e}")
        # Don't crash the app - warm-up is optional optimization


async def get_report_connections() -> List[Dict[str, Any]]:
    """
    Get all unique database connections that have reports defined.

    Returns:
        List of connection info dicts: [{"id": 1, "name": "SQL Server Prod", "db_type": "mssql", ...}]
    """
    async with AsyncSessionLocal() as session:
        # Get distinct connection IDs from reports
        query = select(distinct(Report.connection_id)).where(Report.connection_id.isnot(None))
        result = await session.execute(query)
        connection_ids = [row[0] for row in result.fetchall()]

        if not connection_ids:
            return []

        # Get full connection details
        query = select(Connection).where(Connection.id.in_(connection_ids))
        result = await session.execute(query)
        connections = result.scalars().all()

        return [
            {
                "id": conn.id,
                "name": conn.name,
                "db_type": conn.db_type,
                "host": conn.host,
                "port": conn.port,
                "database": conn.database,
                "username": conn.username,
                "password": decrypt_password(conn.password_encrypted),
                "ssl_enabled": conn.ssl_enabled
            }
            for conn in connections
        ]


async def warm_up_single_connection(conn_info: Dict[str, Any]) -> bool:
    """
    Warm up a single database connection by pre-initializing the connection pool.

    Args:
        conn_info: Connection details dict

    Returns:
        True if successful, False otherwise
    """
    conn_name = conn_info["name"]
    db_type = conn_info["db_type"]

    try:
        logger.info(f"🔥 Warming up pool: {conn_name} ({db_type})...")
        start_time = time.time()

        config = {
            "host": conn_info["host"],
            "port": conn_info["port"],
            "database": conn_info["database"],
            "username": conn_info["username"],
            "password": conn_info["password"],
            "ssl_enabled": conn_info.get("ssl_enabled", False)
        }

        # Use connection pool manager - this creates PERSISTENT connections
        # Just getting the engine and running a query initializes the pool
        engine = get_engine(db_type, config)
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        
        success = True

        elapsed = time.time() - start_time

        if success:
            logger.info(f"✅ {conn_name}: Pool ready ({elapsed:.1f}s)")
        else:
            logger.warning(f"⚠️ {conn_name}: Pool partial ({elapsed:.1f}s)")

        return success

    except Exception as e:
        elapsed = time.time() - start_time
        logger.error(f"❌ {conn_name}: FAILED ({elapsed:.1f}s) - {e}")
        return False
