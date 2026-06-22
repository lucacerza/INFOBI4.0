"""
INFOBI 4.0 - High Performance BI Platform
Focus: Speed, Mobile, Industry 4.0
"""
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import ORJSONResponse

from app.core.config import settings, security_warnings
from app.core.logging_config import configure_logging
from app.db.database import init_db
from app.api import auth, connections, reports, pivot, dashboards, export, users

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

    yield

    # Cleanup: dispose all connection pools
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

@app.get("/health")
async def health():
    return {"status": "healthy", "version": "4.0.0"}

@app.get("/")
async def root():
    return {"message": "INFOBI 4.0 - High Performance BI", "docs": "/docs"}
