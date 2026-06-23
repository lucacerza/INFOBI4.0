"""
INFOBI 4.0 - High Performance BI Platform
Focus: Speed, Mobile, Industry 4.0
"""
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import ORJSONResponse, JSONResponse

from app.core.config import settings, security_warnings
from app.core.logging_config import configure_logging
from app.core.ratelimit import RateLimiter
from app.core.security import decode_token
from app.db.database import init_db
from app.services.audit import record_audit
from app.api import auth, connections, reports, pivot, dashboards, export, users, audit, rls, warehouse

# Metodi HTTP considerati "mutazioni" da auditare
AUDIT_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

# Configure logging (formato strutturato + livello da LOG_LEVEL)
configure_logging()
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize services on startup"""
    logger.info("🚀 Starting INFOBI 4.0...")

    # Validazione sicurezza chiavi: in produzione rifiuta l'avvio con chiavi di default
    warnings = security_warnings()
    if warnings:
        if settings.is_production:
            raise RuntimeError(
                "Avvio rifiutato: configurazione insicura in produzione -> " + "; ".join(warnings)
                + " (imposta JWT_SECRET e DATA_ENCRYPTION_KEY nel .env)"
            )
        for w in warnings:
            logger.warning(f"⚠️  SICUREZZA: {w} — imposta le chiavi nel .env prima della produzione")

    await init_db()
    logger.info("✅ Database initialized")

    # Warm-up database connections to eliminate cold start delays
    from app.core.warmup import warm_up_connections
    await warm_up_connections()

    # Scheduler per il backup automatico del DB SQLite
    scheduler = None
    if settings.BACKUP_ENABLED:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        from app.services.backup import backup_database
        scheduler = AsyncIOScheduler()
        scheduler.add_job(backup_database, "interval", hours=settings.BACKUP_INTERVAL_HOURS, id="db_backup")
        scheduler.start()
        logger.info(f"🗄️  Backup automatico DB attivo (ogni {settings.BACKUP_INTERVAL_HOURS}h, conserva {settings.BACKUP_KEEP})")

    yield

    # Cleanup: stop scheduler + dispose all connection pools
    if scheduler:
        scheduler.shutdown(wait=False)
    logger.info("🔌 Disposing connection pools...")
    from app.core.engine_pool import close_all_pools
    close_all_pools()
    logger.info("👋 Shutting down INFOBI 4.0")

app = FastAPI(
    title="INFOBI 4.0",
    description="High Performance BI for Industry 4.0",
    version="4.0.0",
    lifespan=lifespan,
    default_response_class=ORJSONResponse,  # Faster JSON serialization
)

def _username_from_request(request: Request) -> str | None:
    """Estrae lo username dal bearer token (best-effort, senza sollevare)."""
    auth_header = request.headers.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        payload = decode_token(auth_header[7:])
        if payload:
            return payload.get("sub")
    return None


# Rate limiter condiviso (per istanza)
_rate_limiter = RateLimiter(settings.RATE_LIMIT_RPM, settings.RATE_LIMIT_WINDOW_SECONDS)


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    """Limita le richieste /api per utente (o IP) entro una finestra scorrevole."""
    if settings.RATE_LIMIT_ENABLED and request.url.path.startswith("/api"):
        key = _username_from_request(request) or (request.client.host if request.client else "anon")
        if not _rate_limiter.allow(key):
            return JSONResponse(status_code=429, content={"detail": "Troppe richieste, riprova tra poco"})
    return await call_next(request)


@app.middleware("http")
async def audit_middleware(request: Request, call_next):
    """Audita automaticamente tutte le mutazioni /api (CRUD). Il login è auditato a parte."""
    response = await call_next(request)
    try:
        path = request.url.path
        if (
            request.method in AUDIT_METHODS
            and path.startswith("/api")
            and path != "/api/auth/login"  # login auditato esplicitamente con username noto
        ):
            await record_audit(
                username=_username_from_request(request),
                action=f"{request.method} {path}",
                method=request.method,
                path=path,
                status_code=response.status_code,
                success=response.status_code < 400,
                ip_address=request.client.host if request.client else None,
            )
    except Exception:
        logger.exception("audit middleware error")
    return response


# Middleware for performance
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Query-Time", "X-Cache-Hit", "X-Row-Count"],
)

# Include routers
app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])
app.include_router(users.router, prefix="/api/users", tags=["Users"])
app.include_router(connections.router, prefix="/api/connections", tags=["Connections"])
app.include_router(reports.router, prefix="/api/reports", tags=["Reports"])
app.include_router(pivot.router, prefix="/api/pivot", tags=["Pivot"])
app.include_router(dashboards.router, prefix="/api/dashboards", tags=["Dashboards"])
app.include_router(export.router, prefix="/api/export", tags=["Export"])
app.include_router(audit.router, prefix="/api/audit", tags=["Audit"])
app.include_router(rls.router, prefix="/api/rls", tags=["RLS"])
app.include_router(warehouse.router, prefix="/api/warehouse", tags=["Warehouse"])

@app.get("/health")
async def health():
    return {"status": "healthy", "version": "4.0.0"}

@app.get("/")
async def root():
    return {"message": "INFOBI 4.0 - High Performance BI", "docs": "/docs"}
