"""Database Connections API"""
import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from typing import List
from pydantic import BaseModel
from app.db.database import get_db, Connection
from app.core.deps import get_current_user, get_current_admin
from app.core.security import encrypt_password, decrypt_password
from app.models.schemas import ConnectionCreate, ConnectionUpdate, ConnectionResponse
from app.services.query_engine import QueryEngine
from app.core.engine_pool import get_engine

logger = logging.getLogger(__name__)
router = APIRouter()

# Thread pool for blocking operations
_test_executor = ThreadPoolExecutor(max_workers=4)

class TestConnectionRequest(BaseModel):
    db_type: str
    host: str
    port: int
    database: str
    username: str
    password: str
    ssl_enabled: bool = False

def _test_connection_sync(db_type: str, config: dict) -> dict:
    """Synchronous connection test using SQLAlchemy Engine Pool"""
    import time

    start = time.perf_counter()

    # Ottiene l'engine dal pool (o ne crea uno nuovo)
    engine = get_engine(db_type, config)

    # Esegue una query leggera per validare la connessione e "scaldare" il pool
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))

    elapsed = (time.perf_counter() - start) * 1000
    return {"rows": 1, "time_ms": elapsed}

def _format_connection_error(e: Exception, host: str, database: str) -> str:
    """Traduci errori tecnici in messaggi utente comprensibili"""
    import socket
    try:
        resolved_ip = socket.gethostbyname(host)
        ip_info = f" (IP risolto da Docker: {resolved_ip})"
        
        # Rileva IP interni di Docker Desktop (spesso mappati sull'host)
        if resolved_ip.startswith("192.168.65.") or resolved_ip == "127.0.0.1" or resolved_ip.startswith("172."):
             ip_info += " [⚠️ È IL TUO PC LOCALE!]"
    except:
        ip_info = " (Docker non riesce a risolvere questo nome)"

    error_msg = str(e)
    if "Login failed" in error_msg or "Login non riuscito" in error_msg or "18456" in error_msg:
        return "Login fallito: username o password errati"
    elif "Cannot open database" in error_msg or "Non è possibile aprire il database" in error_msg or "4060" in error_msg:
        return f"Login OK, ma il database '{database}' non esiste sul server {host}{ip_info}. Docker sta puntando al server sbagliato (probabilmente il tuo PC). Usa l'IP del server."
    elif "server was not found" in error_msg or "Connection refused" in error_msg or "10061" in error_msg:
        return f"Server {host}{ip_info} non raggiungibile. Docker non vede i nomi NetBIOS di Windows (prova a usare l'IP)."
    elif "tcp connect error" in error_msg.lower():
        return f"Impossibile connettersi a {host}. Verifica indirizzo e porta."
    elif "timed out" in error_msg.lower():
        return "Timeout connessione. Il server potrebbe essere lento o irraggiungibile."
    return error_msg

@router.post("/test-new")
async def test_new_connection(
    request: TestConnectionRequest,
    user = Depends(get_current_user)
):
    """Test a connection BEFORE saving it (with automatic warm-up)"""
    try:
        config = {
            "host": request.host,
            "port": request.port,
            "database": request.database,
            "username": request.username,
            "password": request.password,
            "ssl_enabled": request.ssl_enabled
        }

        logger.info(f"Testing connection to {request.host}:{request.port}/{request.database}")

        # Run in thread pool with timeout (increased to 180s for cold start)
        loop = asyncio.get_event_loop()
        try:
            result = await asyncio.wait_for(
                loop.run_in_executor(
                    _test_executor,
                    _test_connection_sync,
                    request.db_type,
                    config
                ),
                timeout=180.0  # 180 second timeout for cold start + warm-up
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
        logger.error(f"Connection test failed: {e}")
        error_msg = _format_connection_error(e, request.host, request.database)
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
        config = {
            "host": conn.host,
            "port": conn.port,
            "database": conn.database,
            "username": conn.username,
            "password": decrypt_password(conn.password_encrypted),
            "ssl_enabled": conn.ssl_enabled
        }

        # Run in thread pool with timeout (increased to 180s for cold start)
        loop = asyncio.get_event_loop()
        result = await asyncio.wait_for(
            loop.run_in_executor(
                _test_executor,
                _test_connection_sync,
                conn.db_type,
                config
            ),
            timeout=180.0  # 180 second timeout for cold start + warm-up
        )

        return {"success": True, "message": f"Connessione OK ({result['time_ms']:.0f}ms)"}
    except asyncio.TimeoutError:
        return {"success": False, "message": "Timeout: connessione troppo lenta"}
    except Exception as e:
        msg = _format_connection_error(e, conn.host, conn.database)
        return {"success": False, "message": msg}


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


@router.get("/pool-status")
async def get_pool_status(
    user = Depends(get_current_admin)
):
    """
    Get status of all connection pools.

    Returns information about each pool:
    - size: configured pool size
    - checked_out: connections currently in use
    - checked_in: connections available in pool
    - overflow: extra connections beyond pool_size

    Requires admin role.
    """
    from app.core.engine_pool import get_pool_status

    status = get_pool_status()

    return {
        "pools": status,
        "pool_count": len(status),
        "message": "Connection pool status"
    }
