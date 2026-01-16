"""Database models and initialization"""
import logging
from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, JSON, ForeignKey, Table
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
    """User with role-based access control"""
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(255), unique=True, nullable=False)
    email = Column(String(255), unique=True)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(255))
    role = Column(String(50), default="viewer")  # admin, editor, viewer
    is_active = Column(Boolean, default=True)
    preferences = Column(JSON, default={})
    created_at = Column(DateTime, default=datetime.utcnow)
    last_login = Column(DateTime)

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
# INITIALIZATION
# ============================================
async def init_db():
    """Initialize database and create tables"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    # Create default admin user
    async with AsyncSessionLocal() as session:
        from sqlalchemy import select
        from app.core.security import get_password_hash
        
        result = await session.execute(select(User).where(User.username == "admin"))
        admin = result.scalar_one_or_none()
        
        if not admin:
            admin = User(
                username="admin",
                email="admin@example.com",
                full_name="Amministratore",
                password_hash=get_password_hash("admin"),
                role="admin"
            )
            session.add(admin)
            await session.commit()
            logger.info("✅ Created default admin user (admin/admin)")
        
        # REMOVED FORCED RESET: User credentials should persist across restarts
        # else:
        #    # Ensure admin password is always 'admin' in this dev environment
        #    admin.password_hash = get_password_hash("admin")
        #    session.add(admin)
        #    await session.commit()
        #    logger.info("✅ Reset admin password to 'admin'")

async def get_db():
    """Dependency for database session"""
    async with AsyncSessionLocal() as session:
        yield session
