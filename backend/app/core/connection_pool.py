"""
Persistent Connection Pool Manager
Eliminates cold start delays by maintaining warm database connections.

Key features:
- SQLAlchemy connection pooling with pre-ping
- Connections stay alive across requests
- Warm-up pre-initializes pools at startup
- Polars uses pooled connections for DataFrame operations
"""
import logging
import time
from typing import Dict, Optional, Any
from threading import Lock
from urllib.parse import quote_plus

from sqlalchemy import create_engine, text, pool
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)

# Global connection pools - one per database connection
_pools: Dict[str, Engine] = {}
_pools_lock = Lock()

# Pool configuration
POOL_SIZE = 5           # Connections per database
POOL_MAX_OVERFLOW = 10  # Extra connections under load
POOL_TIMEOUT = 30       # Wait for connection
POOL_RECYCLE = 3600     # Recycle connections after 1 hour
POOL_PRE_PING = True    # Check connection health before use


def _build_sqlalchemy_url(db_type: str, config: dict) -> str:
    """Build SQLAlchemy connection URL"""
    password = quote_plus(config['password'])
    username = quote_plus(config['username'])
    host = config['host']
    port = config.get('port')
    database = config['database']
    ssl_enabled = config.get('ssl_enabled', False)

    if db_type == "mssql":
        # SQL Server via pyodbc
        port = port or 1433
        encrypt = "yes" if ssl_enabled else "no"
        # Use ODBC Driver 18 (installed in Docker container via msodbcsql18)
        return (
            f"mssql+pyodbc://{username}:{password}@{host}:{port}/{database}"
            f"?driver=ODBC+Driver+18+for+SQL+Server"
            f"&TrustServerCertificate=yes"
            f"&Encrypt={encrypt}"
            f"&ApplicationIntent=ReadOnly"
        )
    elif db_type == "postgresql":
        port = port or 5432
        ssl_mode = "require" if ssl_enabled else "prefer"
        return f"postgresql+psycopg2://{username}:{password}@{host}:{port}/{database}?sslmode={ssl_mode}"
    elif db_type == "mysql":
        port = port or 3306
        ssl_part = "?ssl=true" if ssl_enabled else ""
        return f"mysql+pymysql://{username}:{password}@{host}:{port}/{database}{ssl_part}"
    else:
        raise ValueError(f"Unsupported database type: {db_type}")


def _get_pool_key(db_type: str, config: dict) -> str:
    """Generate unique key for connection pool"""
    return f"{db_type}://{config['host']}:{config.get('port', 0)}/{config['database']}/{config['username']}"


def get_or_create_pool(db_type: str, config: dict) -> Engine:
    """
    Get existing pool or create new one.
    Thread-safe and ensures connection reuse.
    """
    pool_key = _get_pool_key(db_type, config)

    with _pools_lock:
        if pool_key in _pools:
            engine = _pools[pool_key]
            # Verify engine is still valid
            try:
                with engine.connect() as conn:
                    conn.execute(text("SELECT 1"))
                return engine
            except Exception as e:
                logger.warning(f"Pool {pool_key} stale, recreating: {e}")
                try:
                    engine.dispose()
                except:
                    pass
                del _pools[pool_key]

        # Create new pool
        logger.info(f"Creating connection pool: {pool_key}")
        url = _build_sqlalchemy_url(db_type, config)

        engine = create_engine(
            url,
            pool_size=POOL_SIZE,
            max_overflow=POOL_MAX_OVERFLOW,
            pool_timeout=POOL_TIMEOUT,
            pool_recycle=POOL_RECYCLE,
            pool_pre_ping=POOL_PRE_PING,
            echo=False,  # Set True for SQL debugging
        )

        _pools[pool_key] = engine
        return engine


def warm_pool(db_type: str, config: dict) -> bool:
    """
    Pre-initialize a connection pool by establishing connections.
    This eliminates cold start delay for first query.

    Returns True if successful, False otherwise.
    """
    pool_key = _get_pool_key(db_type, config)
    start = time.perf_counter()

    try:
        engine = get_or_create_pool(db_type, config)

        # Force pool to create initial connections by checking out and returning
        connections = []
        for i in range(min(POOL_SIZE, 3)):  # Warm at least 3 connections
            try:
                conn = engine.connect()
                conn.execute(text("SELECT 1"))
                connections.append(conn)
            except Exception as e:
                logger.warning(f"Failed to warm connection {i}: {e}")
                break

        # Return connections to pool (they stay warm)
        for conn in connections:
            conn.close()

        elapsed = (time.perf_counter() - start) * 1000
        logger.info(f"Pool warmed: {pool_key} ({len(connections)} connections, {elapsed:.0f}ms)")
        return True

    except Exception as e:
        elapsed = (time.perf_counter() - start) * 1000
        logger.error(f"Pool warm failed: {pool_key} ({elapsed:.0f}ms) - {e}")
        return False


def get_raw_connection(db_type: str, config: dict):
    """
    Get a raw DBAPI connection from the pool.
    This can be used with Polars or direct execution.

    IMPORTANT: Caller must close the connection when done!
    """
    engine = get_or_create_pool(db_type, config)
    return engine.raw_connection()


def execute_with_pool(db_type: str, config: dict, query: str) -> Any:
    """
    Execute a query using pooled connection.
    Returns SQLAlchemy Result object.
    """
    engine = get_or_create_pool(db_type, config)
    with engine.connect() as conn:
        result = conn.execute(text(query))
        return result.fetchall()


def get_pool_status() -> Dict[str, Dict[str, Any]]:
    """Get status of all connection pools"""
    status = {}
    with _pools_lock:
        for key, engine in _pools.items():
            pool_obj = engine.pool
            status[key] = {
                "size": pool_obj.size(),
                "checked_out": pool_obj.checkedout(),
                "overflow": pool_obj.overflow(),
                "checked_in": pool_obj.checkedin(),
            }
    return status


def dispose_all_pools():
    """Dispose all connection pools (for shutdown)"""
    with _pools_lock:
        for key, engine in _pools.items():
            try:
                engine.dispose()
                logger.info(f"Disposed pool: {key}")
            except Exception as e:
                logger.error(f"Error disposing pool {key}: {e}")
        _pools.clear()


def dispose_pool(db_type: str, config: dict):
    """Dispose a specific connection pool"""
    pool_key = _get_pool_key(db_type, config)
    with _pools_lock:
        if pool_key in _pools:
            try:
                _pools[pool_key].dispose()
                del _pools[pool_key]
                logger.info(f"Disposed pool: {pool_key}")
            except Exception as e:
                logger.error(f"Error disposing pool {pool_key}: {e}")
