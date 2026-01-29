"""
Dashboards API
Gestione dashboard, widget e permessi di visualizzazione.
"""
import logging
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, or_
from pydantic import BaseModel
from app.db.database import get_db, Dashboard, UserDashboardAccess, DashboardWidget
from app.core.deps import get_current_user, get_current_admin

logger = logging.getLogger(__name__)
router = APIRouter()

# ============================================
# SCHEMAS
# ============================================

class DashboardWidgetCreate(BaseModel):
    report_id: int
    widget_type: str = "grid"
    title: Optional[str] = None
    config: Dict[str, Any] = {}
    position: Dict[str, Any] = {}

class DashboardCreate(BaseModel):
    name: str
    description: Optional[str] = None
    layout: Dict[str, Any] = {}
    auto_refresh: bool = False
    refresh_interval: int = 300
    visibility: str = "private"

class DashboardUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    layout: Optional[Dict[str, Any]] = None
    auto_refresh: Optional[bool] = None
    refresh_interval: Optional[int] = None
    visibility: Optional[str] = None

class WidgetResponse(BaseModel):
    id: int
    report_id: int
    widget_type: str
    title: Optional[str]
    config: Dict[str, Any]
    position: Dict[str, Any]

    class Config:
        from_attributes = True

class DashboardResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    layout: Optional[Dict[str, Any]]
    auto_refresh: bool
    refresh_interval: int
    visibility: str
    created_by: Optional[int]

    class Config:
        from_attributes = True

class DashboardWithWidgetsResponse(DashboardResponse):
    widgets: List[WidgetResponse] = []

# ============================================
# ENDPOINTS
# ============================================

@router.get("", response_model=List[DashboardResponse])
async def list_dashboards(
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """
    Lista dashboard visibili all'utente.
    - Superuser/Admin: Vedono TUTTE le dashboard.
    - User: Vedono solo dashboard Pubbliche o Assegnate a loro.
    """
    if current_user.role in ["superuser", "admin"]:
        query = select(Dashboard).order_by(Dashboard.name)
    else:
        query = select(Dashboard).outerjoin(
            UserDashboardAccess,
            (UserDashboardAccess.dashboard_id == Dashboard.id) &
            (UserDashboardAccess.user_id == current_user.id)
        ).where(
            or_(
                Dashboard.visibility == "public",
                UserDashboardAccess.user_id == current_user.id
            )
        ).order_by(Dashboard.name)
        
    result = await db.execute(query)
    return result.scalars().all()

@router.post("", response_model=DashboardResponse, status_code=status.HTTP_201_CREATED)
async def create_dashboard(
    data: DashboardCreate,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_admin) # Solo Admin o Superuser
):
    dashboard = Dashboard(
        name=data.name,
        description=data.description,
        layout=data.layout,
        auto_refresh=data.auto_refresh,
        refresh_interval=data.refresh_interval,
        visibility=data.visibility,
        created_by=current_user.id
    )
    db.add(dashboard)
    await db.commit()
    await db.refresh(dashboard)
    return dashboard

@router.get("/{dashboard_id}", response_model=DashboardWithWidgetsResponse)
async def get_dashboard(
    dashboard_id: int,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    result = await db.execute(select(Dashboard).where(Dashboard.id == dashboard_id))
    dashboard = result.scalar_one_or_none()

    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard non trovata")

    # Controllo visibilità per utenti normali
    if current_user.role not in ["superuser", "admin"] and dashboard.visibility != "public":
        # Verifica assegnazione esplicita
        access_result = await db.execute(
            select(UserDashboardAccess).where(
                UserDashboardAccess.dashboard_id == dashboard_id,
                UserDashboardAccess.user_id == current_user.id
            )
        )
        if not access_result.scalar_one_or_none():
            raise HTTPException(status_code=403, detail="Accesso negato")

    # Carica i widget della dashboard
    widgets_result = await db.execute(
        select(DashboardWidget).where(DashboardWidget.dashboard_id == dashboard_id)
    )
    widgets = widgets_result.scalars().all()

    # Combina dashboard con widgets
    return DashboardWithWidgetsResponse(
        id=dashboard.id,
        name=dashboard.name,
        description=dashboard.description,
        layout=dashboard.layout,
        auto_refresh=dashboard.auto_refresh,
        refresh_interval=dashboard.refresh_interval,
        visibility=dashboard.visibility,
        created_by=dashboard.created_by,
        widgets=[WidgetResponse(
            id=w.id,
            report_id=w.report_id,
            widget_type=w.widget_type,
            title=w.title,
            config=w.config or {},
            position=w.position or {}
        ) for w in widgets]
    )

@router.put("/{dashboard_id}", response_model=DashboardResponse)
async def update_dashboard(
    dashboard_id: int,
    data: DashboardUpdate,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_admin)
):
    result = await db.execute(select(Dashboard).where(Dashboard.id == dashboard_id))
    dashboard = result.scalar_one_or_none()
    
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard non trovata")
        
    # Permessi: Admin può modificare solo le sue, Superuser tutte
    if current_user.role == "admin" and dashboard.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Gli admin possono modificare solo le proprie dashboard")

    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(dashboard, key, value)
        
    await db.commit()
    await db.refresh(dashboard)
    return dashboard

@router.delete("/{dashboard_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dashboard(
    dashboard_id: int,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_admin)
):
    result = await db.execute(select(Dashboard).where(Dashboard.id == dashboard_id))
    dashboard = result.scalar_one_or_none()
    
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard non trovata")
        
    # Permessi: Admin può eliminare solo le sue
    if current_user.role == "admin" and dashboard.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Gli admin possono eliminare solo le proprie dashboard")
        
    await db.delete(dashboard)
    await db.commit()

@router.post("/{dashboard_id}/widgets", response_model=WidgetResponse)
async def add_widget(
    dashboard_id: int,
    widget_data: DashboardWidgetCreate,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_admin)
):
    # Verifica esistenza dashboard e permessi
    result = await db.execute(select(Dashboard).where(Dashboard.id == dashboard_id))
    dashboard = result.scalar_one_or_none()
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard non trovata")

    if current_user.role == "admin" and dashboard.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Accesso negato")

    widget = DashboardWidget(
        dashboard_id=dashboard_id,
        report_id=widget_data.report_id,
        widget_type=widget_data.widget_type,
        title=widget_data.title,
        config=widget_data.config,
        position=widget_data.position
    )
    db.add(widget)
    await db.commit()
    await db.refresh(widget)

    return WidgetResponse(
        id=widget.id,
        report_id=widget.report_id,
        widget_type=widget.widget_type,
        title=widget.title,
        config=widget.config or {},
        position=widget.position or {}
    )


class WidgetUpdate(BaseModel):
    title: Optional[str] = None
    config: Optional[Dict[str, Any]] = None
    position: Optional[Dict[str, Any]] = None


@router.put("/{dashboard_id}/widgets/{widget_id}", response_model=WidgetResponse)
async def update_widget(
    dashboard_id: int,
    widget_id: int,
    widget_data: WidgetUpdate,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_admin)
):
    # Verifica esistenza dashboard e permessi
    result = await db.execute(select(Dashboard).where(Dashboard.id == dashboard_id))
    dashboard = result.scalar_one_or_none()
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard non trovata")

    if current_user.role == "admin" and dashboard.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Accesso negato")

    # Trova il widget
    widget_result = await db.execute(
        select(DashboardWidget).where(
            DashboardWidget.id == widget_id,
            DashboardWidget.dashboard_id == dashboard_id
        )
    )
    widget = widget_result.scalar_one_or_none()
    if not widget:
        raise HTTPException(status_code=404, detail="Widget non trovato")

    # Aggiorna solo i campi forniti
    if widget_data.title is not None:
        widget.title = widget_data.title
    if widget_data.config is not None:
        widget.config = widget_data.config
    if widget_data.position is not None:
        widget.position = widget_data.position

    await db.commit()
    await db.refresh(widget)

    return WidgetResponse(
        id=widget.id,
        report_id=widget.report_id,
        widget_type=widget.widget_type,
        title=widget.title,
        config=widget.config or {},
        position=widget.position or {}
    )


@router.delete("/{dashboard_id}/widgets/{widget_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_widget(
    dashboard_id: int,
    widget_id: int,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_admin)
):
    # Verifica esistenza dashboard e permessi
    result = await db.execute(select(Dashboard).where(Dashboard.id == dashboard_id))
    dashboard = result.scalar_one_or_none()
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard non trovata")

    if current_user.role == "admin" and dashboard.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Accesso negato")

    # Trova e elimina il widget
    widget_result = await db.execute(
        select(DashboardWidget).where(
            DashboardWidget.id == widget_id,
            DashboardWidget.dashboard_id == dashboard_id
        )
    )
    widget = widget_result.scalar_one_or_none()
    if not widget:
        raise HTTPException(status_code=404, detail="Widget non trovato")

    await db.delete(widget)
    await db.commit()