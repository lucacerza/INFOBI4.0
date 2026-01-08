"""Pydantic schemas for API validation"""
from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, EmailStr

# Auth
class LoginRequest(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict

class UserResponse(BaseModel):
    id: int
    username: str
    email: Optional[str]
    role: str
    is_active: bool
    
    class Config:
        from_attributes = True

# Connections
class ConnectionCreate(BaseModel):
    name: str
    db_type: str  # mssql, postgresql, mysql
    host: str
    port: int
    database: str
    username: str
    password: str
    ssl_enabled: bool = False

class ConnectionUpdate(BaseModel):
    name: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    database: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    ssl_enabled: Optional[bool] = None

class ConnectionResponse(BaseModel):
    id: int
    name: str
    db_type: str
    host: str
    port: int
    database: str
    username: str
    ssl_enabled: bool
    created_at: datetime
    
    class Config:
        from_attributes = True

# Reports
class ColumnConfig(BaseModel):
    """Column metadata discovered from query"""
    name: str
    type: str  # string, number, date
    label: Optional[str] = None

class MetricDefinition(BaseModel):
    """Metric definition for aggregation"""
    name: str
    field: Optional[str] = None  # Source field (null for calculated)
    type: str = "sum"  # sum, avg, count, min, max, margin
    aggregation: str = "SUM"
    # For margin calculations
    revenueField: Optional[str] = None
    costField: Optional[str] = None

class ReportCreate(BaseModel):
    name: str
    description: Optional[str] = None
    connection_id: int
    query: str
    # Layout configuration
    columns_config: List[ColumnConfig] = []
    default_group_by: List[str] = []
    default_metrics: List[MetricDefinition] = []
    available_metrics: List[MetricDefinition] = []
    column_labels: Dict[str, str] = {}
    view_config: Dict[str, Any] = {}
    # Cache
    cache_enabled: bool = True
    cache_ttl: int = 3600

class ReportUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    query: Optional[str] = None
    columns_config: Optional[List[ColumnConfig]] = None
    default_group_by: Optional[List[str]] = None
    default_metrics: Optional[List[MetricDefinition]] = None
    available_metrics: Optional[List[MetricDefinition]] = None
    column_labels: Optional[Dict[str, str]] = None
    view_config: Optional[Dict[str, Any]] = None
    layout: Optional[Dict[str, Any]] = None
    cache_enabled: Optional[bool] = None
    cache_ttl: Optional[int] = None

class ReportResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    connection_id: int
    query: str
    columns_config: Optional[List[dict]] = []
    perspective_config: Optional[Dict[str, Any]] = {}
    tabulator_config: Optional[Dict[str, Any]] = {}
    default_group_by: Optional[List[str]] = []
    default_metrics: Optional[List[dict]] = []
    available_metrics: Optional[List[dict]] = []
    column_labels: Optional[Dict[str, str]] = {}
    view_config: Optional[Dict[str, Any]] = {}
    layout: Optional[Dict[str, Any]] = {}
    cache_enabled: bool
    cache_ttl: int
    visibility: Optional[str] = "private"
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True

# Pivot Request
class PivotRequest(BaseModel):
    group_by: List[str] = []
    split_by: Optional[str] = None
    metrics: List[MetricDefinition] = []
    filters: Dict[str, Any] = {}
    sort: Optional[List[Dict[str, str]]] = None

# Dashboard
class WidgetPosition(BaseModel):
    x: int
    y: int
    w: int
    h: int

class WidgetCreate(BaseModel):
    report_id: int
    widget_type: str = "grid"
    title: Optional[str] = None
    config: Dict[str, Any] = {}
    position: WidgetPosition

class DashboardCreate(BaseModel):
    name: str
    description: Optional[str] = None
    auto_refresh: bool = False
    refresh_interval: int = 300

class DashboardResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    layout: Dict[str, Any]
    auto_refresh: bool
    refresh_interval: int
    widgets: List[dict] = []
    created_at: datetime
    
    class Config:
        from_attributes = True
