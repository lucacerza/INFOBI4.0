"""Database Connections API"""
import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List
from pydantic import BaseModel
from app.db.database import get_db, Connection
from app.core.deps import get_current_user, get_current_admin
from app.core.security import encrypt_password, decrypt_password
from app.models.schemas import ConnectionCreate, ConnectionUpdate, ConnectionResponse
from app.services.query_engine import QueryEngine

logger = logging.getLogger(__name__)
router = APIRouter()

# Thread pool for blocking operations
_test_executor = ThreadPoolExecutor(max_workers=2)

class TestConnectionRequest(BaseModel):
    db_type: str
    host: str
    port: int
    database: str
    username: str
    password: str
    ssl_enabled: bool = False

def _test_connection_sync(conn_string: str) -> dict:
    """Synchronous connection test (runs in thread pool)"""
    import connectorx as cx
    import time
    
    start = time.perf_counter()
    
    # Simple test query
    test_query = "SELECT 1 AS test"
    result = cx.read_sql(conn_string, test_query, return_type="arrow")
    
    elapsed = (time.perf_counter() - start) * 1000
    return {"rows": result.num_rows, "time_ms": elapsed}

@router.post("/test-new")
async def test_new_connection(
    request: TestConnectionRequest,
    user = Depends(get_current_user)
):
    """Test a connection BEFORE saving it (with automatic warm-up)"""
    try:
        conn_string = QueryEngine.build_connection_string(
            request.db_type,
            {
                "host": request.host,
                "port": request.port,
                "database": request.database,
                "username": request.username,
                "password": request.password
            }
        )

        logger.info(f"Testing connection to {request.host}:{request.port}/{request.database}")

        # Run in thread pool with timeout
        loop = asyncio.get_event_loop()
        try:
            result = await asyncio.wait_for(
                loop.run_in_executor(_test_executor, _test_connection_sync, conn_string),
                timeout=30.0  # 30 second timeout
            )
        except asyncio.TimeoutError:
            raise HTTPException(status_code=408, detail="Timeout: la connessione ha impiegato troppo tempo")

        # WARM-UP: If test succeeds, warm up the connection immediately
        # This ensures that when admin creates a report, first query is fast
        logger.info(f"🔥 Connection test OK, warming up...")
        from app.core.warmup import warm_up_single_connection
        asyncio.create_task(warm_up_single_connection({
            "name": f"{request.host}/{request.database}",
            "db_type": request.db_type,
            "host": request.host,
            "port": request.port,
            "database": request.database,
            "username": request.username,
            "password": request.password,
            "ssl_enabled": request.ssl_enabled
        }))

        return {
            "success": True,
            "message": f"Connessione riuscita! ({result['time_ms']:.0f}ms, warm-up avviato)"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        logger.error(f"Connection test failed: {error_msg}")
        
        # Clean up error message
        if "Login failed" in error_msg:
            error_msg = "Login fallito: username o password errati"
        elif "Cannot open database" in error_msg:
            error_msg = "Database non trovato"
        elif "server was not found" in error_msg or "Connection refused" in error_msg:
            error_msg = "Server non raggiungibile. Verifica host e porta."
        elif "tcp connect error" in error_msg.lower():
            error_msg = "Server non raggiungibile. Verifica host e porta."
        elif "timed out" in error_msg.lower():
            error_msg = "Timeout connessione. Il server potrebbe essere lento o irraggiungibile."
        
        raise HTTPException(status_code=400, detail=error_msg)

@router.get("", response_model=List[ConnectionResponse])
async def list_connections(
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    """List all database connections"""
    result = await db.execute(select(Connection).order_by(Connection.name))
    return result.scalars().all()

@router.post("", response_model=ConnectionResponse, status_code=status.HTTP_201_CREATED)
async def create_connection(
    data: ConnectionCreate,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_admin)
):
    """Create a new database connection (with automatic warm-up)"""
    conn = Connection(
        name=data.name,
        db_type=data.db_type,
        host=data.host,
        port=data.port,
        database=data.database,
        username=data.username,
        password_encrypted=encrypt_password(data.password),
        ssl_enabled=data.ssl_enabled
    )
    db.add(conn)
    await db.commit()
    await db.refresh(conn)

    # WARM-UP: Automatically warm up new connection in background
    logger.info(f"🔥 New connection created: {conn.name}, starting warm-up...")
    from app.core.warmup import warm_up_single_connection
    asyncio.create_task(warm_up_single_connection({
        "name": conn.name,
        "db_type": conn.db_type,
        "host": conn.host,
        "port": conn.port,
        "database": conn.database,
        "username": conn.username,
        "password": decrypt_password(conn.password_encrypted),
        "ssl_enabled": conn.ssl_enabled
    }))

    return conn

@router.get("/{conn_id}", response_model=ConnectionResponse)
async def get_connection(
    conn_id: int,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    """Get connection details"""
    result = await db.execute(select(Connection).where(Connection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    return conn

@router.put("/{conn_id}", response_model=ConnectionResponse)
async def update_connection(
    conn_id: int,
    data: ConnectionUpdate,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_admin)
):
    """Update connection (with automatic re-warm-up)"""
    result = await db.execute(select(Connection).where(Connection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    for field, value in data.model_dump(exclude_unset=True).items():
        if field == "password" and value:
            setattr(conn, "password_encrypted", encrypt_password(value))
        elif value is not None:
            setattr(conn, field, value)

    await db.commit()
    await db.refresh(conn)

    # WARM-UP: Re-warm connection with NEW credentials/host
    # This is critical if host/port/password changed
    logger.info(f"🔥 Connection updated: {conn.name}, re-warming up with new settings...")
    from app.core.warmup import warm_up_single_connection
    asyncio.create_task(warm_up_single_connection({
        "name": conn.name,
        "db_type": conn.db_type,
        "host": conn.host,
        "port": conn.port,
        "database": conn.database,
        "username": conn.username,
        "password": decrypt_password(conn.password_encrypted),
        "ssl_enabled": conn.ssl_enabled
    }))

    return conn

@router.delete("/{conn_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_connection(
    conn_id: int,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_admin)
):
    """Delete connection"""
    result = await db.execute(select(Connection).where(Connection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    
    await db.delete(conn)
    await db.commit()

@router.post("/{conn_id}/test")
async def test_connection(
    conn_id: int,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    """Test database connection"""
    result = await db.execute(select(Connection).where(Connection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    try:
        conn_string = QueryEngine.build_connection_string(
            conn.db_type,
            {
                "host": conn.host,
                "port": conn.port,
                "database": conn.database,
                "username": conn.username,
                "password": decrypt_password(conn.password_encrypted)
            }
        )

        # Run in thread pool with timeout
        loop = asyncio.get_event_loop()
        result = await asyncio.wait_for(
            loop.run_in_executor(_test_executor, _test_connection_sync, conn_string),
            timeout=30.0
        )

        return {"success": True, "message": f"Connessione OK ({result['time_ms']:.0f}ms)"}
    except asyncio.TimeoutError:
        return {"success": False, "message": "Timeout: connessione troppo lenta"}
    except Exception as e:
        return {"success": False, "message": str(e)}


@router.post("/warmup-all")
async def warmup_all_connections(
    user = Depends(get_current_admin)
):
    """
    Manually trigger warm-up of ALL connections used by reports.

    This is useful:
    - After database server restart
    - After backend maintenance
    - To pre-warm connections before peak usage

    Requires admin role.
    """
    logger.info(f"🔥 Manual warm-up triggered by admin: {user.username}")

    from app.core.warmup import warm_up_connections

    # Start warm-up in background
    asyncio.create_task(warm_up_connections())

    return {
        "status": "started",
        "message": "Warm-up di tutte le connessioni avviato in background. Controlla i log per lo stato."
    }
