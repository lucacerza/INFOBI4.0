"""Dashboards API"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List
from app.db.database import get_db, Dashboard, DashboardWidget
from app.core.deps import get_current_user, get_current_admin
from app.models.schemas import DashboardCreate, DashboardResponse, WidgetCreate

router = APIRouter()

@router.get("", response_model=List[DashboardResponse])
async def list_dashboards(
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    """List all dashboards"""
    result = await db.execute(select(Dashboard).order_by(Dashboard.name))
    dashboards = result.scalars().all()
    
    # Load widgets for each dashboard
    response = []
    for d in dashboards:
        widgets_result = await db.execute(
            select(DashboardWidget).where(DashboardWidget.dashboard_id == d.id)
        )
        widgets = widgets_result.scalars().all()
        
        response.append({
            **d.__dict__,
            "widgets": [w.__dict__ for w in widgets]
        })
    
    return response

@router.post("", response_model=DashboardResponse, status_code=status.HTTP_201_CREATED)
async def create_dashboard(
    data: DashboardCreate,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_admin)
):
    """Create a new dashboard"""
    dashboard = Dashboard(
        name=data.name,
        description=data.description,
        auto_refresh=data.auto_refresh,
        refresh_interval=data.refresh_interval,
        created_by=user.id
    )
    db.add(dashboard)
    await db.commit()
    await db.refresh(dashboard)
    return {**dashboard.__dict__, "widgets": []}

@router.get("/{dashboard_id}", response_model=DashboardResponse)
async def get_dashboard(
    dashboard_id: int,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    """Get dashboard with widgets"""
    result = await db.execute(select(Dashboard).where(Dashboard.id == dashboard_id))
    dashboard = result.scalar_one_or_none()
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    
    widgets_result = await db.execute(
        select(DashboardWidget).where(DashboardWidget.dashboard_id == dashboard_id)
    )
    widgets = widgets_result.scalars().all()
    
    return {**dashboard.__dict__, "widgets": [w.__dict__ for w in widgets]}

@router.delete("/{dashboard_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dashboard(
    dashboard_id: int,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_admin)
):
    """Delete dashboard"""
    result = await db.execute(select(Dashboard).where(Dashboard.id == dashboard_id))
    dashboard = result.scalar_one_or_none()
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    
    await db.delete(dashboard)
    await db.commit()

@router.post("/{dashboard_id}/widgets", status_code=status.HTTP_201_CREATED)
async def add_widget(
    dashboard_id: int,
    data: WidgetCreate,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_admin)
):
    """Add widget to dashboard"""
    result = await db.execute(select(Dashboard).where(Dashboard.id == dashboard_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Dashboard not found")
    
    widget = DashboardWidget(
        dashboard_id=dashboard_id,
        report_id=data.report_id,
        widget_type=data.widget_type,
        title=data.title,
        config=data.config,
        position=data.position.model_dump()
    )
    db.add(widget)
    await db.commit()
    await db.refresh(widget)
    return widget.__dict__

@router.delete("/{dashboard_id}/widgets/{widget_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_widget(
    dashboard_id: int,
    widget_id: int,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_admin)
):
    """Remove widget from dashboard"""
    result = await db.execute(
        select(DashboardWidget)
        .where(DashboardWidget.id == widget_id)
        .where(DashboardWidget.dashboard_id == dashboard_id)
    )
    widget = result.scalar_one_or_none()
    if not widget:
        raise HTTPException(status_code=404, detail="Widget not found")
    
    await db.delete(widget)
    await db.commit()
