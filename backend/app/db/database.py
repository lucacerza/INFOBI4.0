"""Database models and initialization"""
import logging
from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, JSON, ForeignKey, Table, UniqueConstraint
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base, relationship
from app.core.config import settings

logger = logging.getLogger(__name__)

# Create async engine
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    future=True
)

# Session factory
AsyncSessionLocal = sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)

Base = declarative_base()

# ============================================
# USER & PERMISSIONS
# ============================================
class User(Base):
    """User with role-based access control

    Gerarchia ruoli:
    - superuser: Accesso completo (connessioni, report, utenti). Account protetto.
    - admin: Gestisce dashboard e utenti USER. NON vede connessioni/report.
    - user: Solo visualizzazione dashboard assegnate.
    """
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(255), unique=True, nullable=False)
    email = Column(String(255), unique=True)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(255))
    role = Column(String(50), default="user")  # superuser, admin, user
    is_active = Column(Boolean, default=True)
    is_system_account = Column(Boolean, default=False)  # True solo per infostudio
    preferences = Column(JSON, default={})
    created_at = Column(DateTime, default=datetime.utcnow)
    last_login = Column(DateTime)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)  # Chi ha creato questo utente

class UserReportAccess(Base):
    """User access to specific reports"""
    __tablename__ = "user_report_access"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    report_id = Column(Integer, ForeignKey("reports.id", ondelete="CASCADE"), nullable=False)
    can_edit = Column(Boolean, default=False)  # False = view only
    created_at = Column(DateTime, default=datetime.utcnow)

class UserDashboardAccess(Base):
    """User access to specific dashboards"""
    __tablename__ = "user_dashboard_access"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    dashboard_id = Column(Integer, ForeignKey("dashboards.id", ondelete="CASCADE"), nullable=False)
    can_edit = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

# ============================================
# CONNECTIONS
# ============================================
class Connection(Base):
    __tablename__ = "connections"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    db_type = Column(String(50), nullable=False)  # mssql, postgresql, mysql
    host = Column(String(255), nullable=False)
    port = Column(Integer, nullable=False)
    database = Column(String(255), nullable=False)
    username = Column(String(255), nullable=False)
    password_encrypted = Column(Text, nullable=False)
    ssl_enabled = Column(Boolean, default=False)
    pool_size = Column(Integer, default=5)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

# ============================================
# REPORTS
# ============================================
class Report(Base):
    """Report with query and BiGrid pivot configuration"""
    __tablename__ = "reports"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    connection_id = Column(Integer, ForeignKey("connections.id"), nullable=False)
    
    # SQL Query (flat data source)
    query = Column(Text, nullable=False)
    
    # Column metadata from query: [{name, type, label}]
    columns_config = Column(JSON, default=[])
    
    # BiGrid pivot configuration (saved by admin)
    # Stores the complete pivot state: rows, columns, metrics
    perspective_config = Column(JSON, default={})
    # Example:
    # {
    #   "rows": ["Agente", "Cliente"],
    #   "columns": ["Anno"],
    #   "values": [
    #     {"id": "v1", "name": "Venduto", "field": "Venduto", "aggregation": "SUM"}
    #   ]
    # }
    
    # Legacy tabulator configuration (deprecated)
    tabulator_config = Column(JSON, default={})
    
    # Configuration fields
    default_group_by = Column(JSON, default=[])
    default_metrics = Column(JSON, default=[])
    available_metrics = Column(JSON, default=[])
    column_labels = Column(JSON, default={})
    view_config = Column(JSON, default={})
    layout = Column(JSON, default={})
    
    # Warehouse: se True le query (pivot/grid/schema/distinct) girano sul mart
    # materializzato in DuckDB invece che sulla sorgente live (fallback automatico
    # alla sorgente se il dataset non è ancora materializzato).
    warehouse_backed = Column(Boolean, default=False)

    # Cache settings
    cache_enabled = Column(Boolean, default=True)
    cache_ttl = Column(Integer, default=3600)
    
    # Visibility: 'public' = all users, 'private' = only assigned users
    visibility = Column(String(50), default="private")
    
    # Metadata
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

# ============================================
# DASHBOARDS
# ============================================
class Dashboard(Base):
    __tablename__ = "dashboards"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    layout = Column(JSON, default={})  # Grid layout for widgets
    auto_refresh = Column(Boolean, default=False)
    refresh_interval = Column(Integer, default=300)
    
    # Visibility
    visibility = Column(String(50), default="private")
    
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class DashboardWidget(Base):
    __tablename__ = "dashboard_widgets"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    dashboard_id = Column(Integer, ForeignKey("dashboards.id", ondelete="CASCADE"), nullable=False)
    report_id = Column(Integer, ForeignKey("reports.id"), nullable=False)
    widget_type = Column(String(50), default="grid")  # grid, chart, kpi
    title = Column(String(255))
    config = Column(JSON, default={})
    position = Column(JSON, default={})  # {x, y, w, h}
    created_at = Column(DateTime, default=datetime.utcnow)

# ============================================
# WAREHOUSE (DuckDB) - registro dataset materializzati
# ============================================
class WarehouseDataset(Base):
    """Traccia una tabella materializzata nel warehouse DuckDB (mart per-report)."""
    __tablename__ = "warehouse_datasets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    table_name = Column(String(255), nullable=False)          # nome tabella in DuckDB
    source_connection_id = Column(Integer, ForeignKey("connections.id"))
    source_report_id = Column(Integer, ForeignKey("reports.id", ondelete="SET NULL"), nullable=True)
    source_query = Column(Text, nullable=False)
    columns = Column(JSON, default=[])                        # [{name, dtype}] - per estensione/semantic layer
    row_count = Column(Integer, default=0)
    # ETL incrementale
    sync_mode = Column(String(16), default="full")            # full | incremental
    watermark_column = Column(String(255))                    # colonna per il delta (es. updated_at, id)
    last_watermark = Column(String(255))                      # ultimo valore caricato (stringa, ricoercizzato)
    key_columns = Column(JSON, default=[])                    # chiavi per il merge (step successivo)
    status = Column(String(50), default="ready")              # ready | syncing | error
    last_error = Column(Text)
    last_sync_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)

# ============================================
# SEMANTIC LAYER - metadati semantici per colonna (base per l'AI)
# ============================================
class ColumnMetadata(Base):
    """
    Metadati semantici di una colonna di un report (il "modello" delle BI:
    misure/dimensioni, nome business, unità, formato). Arricchimento umano/AI,
    separato dai fatti tecnici (lo schema fisico è introspezione live).
    """
    __tablename__ = "column_metadata"
    __table_args__ = (UniqueConstraint("report_id", "column_name", name="uq_colmeta_report_column"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    report_id = Column(Integer, ForeignKey("reports.id", ondelete="CASCADE"), nullable=False, index=True)
    column_name = Column(String(255), nullable=False)        # colonna fisica nel risultato del report
    business_name = Column(String(255))                      # nome leggibile (es. "Fatturato netto")
    description = Column(Text)                                # descrizione per l'utente/AI
    role = Column(String(32), default="dimension")           # dimension | measure | time | attribute
    data_type = Column(String(32), default="string")         # string | number | date (semantico)
    unit = Column(String(32))                                # es. "€", "pz", "%"
    format = Column(String(64))                              # es. "#,##0.00", "0%", "dd/mm/yyyy"
    default_aggregation = Column(String(16), default="none") # sum | avg | count | min | max | none
    is_hidden = Column(Boolean, default=False)               # escludi da UI/AI
    is_certified = Column(Boolean, default=False)            # colonna "certificata": usabile dall'AI in modalità governata
    extra = Column(JSON, default={})                         # estensibilità: sinonimi NL, FK target, ecc.
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ============================================
# AI - log delle traduzioni NL (governance/audit/feedback)
# ============================================
class AITranslationLog(Base):
    """Traccia ogni richiesta AI (NL->pivot, insight): domanda, esito, feedback."""
    __tablename__ = "ai_translation_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
    username = Column(String(255))
    report_id = Column(Integer, ForeignKey("reports.id", ondelete="SET NULL"), nullable=True)
    kind = Column(String(32))                # pivot | insight
    question = Column(Text)
    result = Column(JSON, default={})        # config prodotta (pivot) o sintesi (insight)
    status = Column(String(16), default="ok")  # ok | rejected | error
    error = Column(Text)
    provider = Column(String(32))
    model = Column(String(64))
    latency_ms = Column(Integer)
    helpful = Column(Boolean)                # feedback utente (null = nessun feedback)
    feedback_note = Column(Text)

# ============================================
# AUDIT LOG
# ============================================
class AuditLog(Base):
    """Traccia eventi sensibili: login, mutazioni (CRUD), export, ecc."""
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
    username = Column(String(255))          # denormalizzato: l'utente potrebbe essere cancellato
    action = Column(String(255))            # es. "login", "POST /api/connections"
    method = Column(String(10))
    path = Column(String(512))
    status_code = Column(Integer)
    success = Column(Boolean, default=True)
    ip_address = Column(String(64))
    detail = Column(Text)

# ============================================
# REPORT VERSIONING
# ============================================
class ReportVersion(Base):
    """Snapshot storico della definizione di un report (per ripristino/audit)."""
    __tablename__ = "report_versions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    report_id = Column(Integer, ForeignKey("reports.id", ondelete="CASCADE"), nullable=False)
    version_no = Column(Integer, nullable=False)
    snapshot = Column(JSON, default={})   # stato della definizione al momento
    created_by = Column(Integer)
    created_at = Column(DateTime, default=datetime.utcnow)

# ============================================
# ROW-LEVEL SECURITY
# ============================================
class RlsRule(Base):
    """
    Regola di Row-Level Security: per un report, limita le righe visibili a un
    soggetto (utente o ruolo) ai soli valori consentiti su una colonna.
    Applicata come filtro server-side parametrizzato (IN).
    """
    __tablename__ = "rls_rules"

    id = Column(Integer, primary_key=True, autoincrement=True)
    report_id = Column(Integer, ForeignKey("reports.id", ondelete="CASCADE"), nullable=False)
    subject_type = Column(String(20), nullable=False)   # 'user' | 'role'
    subject = Column(String(255), nullable=False)        # username oppure nome ruolo
    column = Column(String(255), nullable=False)
    allowed_values = Column(JSON, default=[])            # valori consentiti (filtro IN)
    created_at = Column(DateTime, default=datetime.utcnow)

# ============================================
# INITIALIZATION
# ============================================
async def init_db():
    """Initialize database and create tables"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Run migrations for existing databases
    async with AsyncSessionLocal() as session:
        from app.db.migrations import run_migrations
        await run_migrations(session)

    # Create system superuser account (infostudio)
    async with AsyncSessionLocal() as session:
        from sqlalchemy import select
        from app.core.security import get_password_hash

        # 1. Create/ensure SUPERUSER account (infostudio)
        result = await session.execute(select(User).where(User.username == "infostudio"))
        superuser = result.scalar_one_or_none()

        if not superuser:
            superuser = User(
                username="infostudio",
                email="infostudio@system.local",
                full_name="InfoStudio Superuser",
                password_hash=get_password_hash("Infostudi0++"),
                role="superuser",
                is_system_account=True,  # Protetto da eliminazione
                is_active=True
            )
            session.add(superuser)
            await session.commit()
            logger.info("✅ Created system superuser (infostudio/Infostudi0++)")
        else:
            # Ensure superuser always has correct role and protection
            if superuser.role != "superuser" or not superuser.is_system_account:
                superuser.role = "superuser"
                superuser.is_system_account = True
                session.add(superuser)
                await session.commit()
                logger.info("✅ Fixed superuser account protection")

        # 2. Migrate old 'admin' account if exists (backward compatibility)
        result = await session.execute(select(User).where(User.username == "admin"))
        old_admin = result.scalar_one_or_none()

        if old_admin:
            # Keep admin account but downgrade to 'admin' role (not superuser)
            if old_admin.role == "admin" and not old_admin.is_system_account:
                logger.info("ℹ️ Existing admin account preserved (role: admin)")
            # Note: old admin can still manage dashboards and users, but NOT connections/reports

async def get_db():
    """Dependency for database session"""
    async with AsyncSessionLocal() as session:
        yield session
