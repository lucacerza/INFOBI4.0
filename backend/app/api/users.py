"""
Users API - User Management and Permissions

Endpoints:
- GET /users - List all users (admin only)
- POST /users - Create user (admin only)
- GET /users/{id} - Get user details
- PUT /users/{id} - Update user
- DELETE /users/{id} - Delete user
- POST /users/{id}/reports - Assign reports to user
- POST /users/{id}/dashboards - Assign dashboards to user
"""
import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from pydantic import BaseModel, EmailStr
from app.db.database import get_db, User, UserReportAccess, UserDashboardAccess, Report, Dashboard
from app.core.deps import get_current_user, require_admin
from app.core.security import get_password_hash

logger = logging.getLogger(__name__)
router = APIRouter()

# ============================================
# SCHEMAS
# ============================================
class UserCreate(BaseModel):
    username: str
    email: Optional[str] = None
    password: str
    full_name: Optional[str] = None
    role: str = "viewer"  # admin, editor, viewer

class UserUpdate(BaseModel):
    email: Optional[str] = None
    full_name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None

class UserResponse(BaseModel):
    id: int
    username: str
    email: Optional[str]
    full_name: Optional[str]
    role: str
    is_active: bool
    
    class Config:
        from_attributes = True

class UserWithAccess(UserResponse):
    report_ids: List[int] = []
    dashboard_ids: List[int] = []

class AssignReportsRequest(BaseModel):
    report_ids: List[int]
    can_edit: bool = False

class AssignDashboardsRequest(BaseModel):
    dashboard_ids: List[int]
    can_edit: bool = False

# ============================================
# ENDPOINTS
# ============================================
@router.get("", response_model=List[UserResponse])
async def list_users(
    db: AsyncSession = Depends(get_db),
    current_user = Depends(require_admin)
):
    """List all users (admin only)"""
    result = await db.execute(select(User).order_by(User.username))
    users = result.scalars().all()
    return users

@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    user_data: UserCreate,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(require_admin)
):
    """Create a new user (admin only)"""
    # Check if username exists
    result = await db.execute(select(User).where(User.username == user_data.username))
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username già esistente"
        )
    
    # Check if email exists (if provided)
    if user_data.email:
        result = await db.execute(select(User).where(User.email == user_data.email))
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email già esistente"
            )
    
    # Validate role
    if user_data.role not in ["admin", "editor", "viewer"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ruolo non valido. Usa: admin, editor, viewer"
        )
    
    user = User(
        username=user_data.username,
        email=user_data.email,
        full_name=user_data.full_name,
        password_hash=get_password_hash(user_data.password),
        role=user_data.role
    )
    
    db.add(user)
    await db.commit()
    await db.refresh(user)
    
    logger.info(f"Created user: {user.username} with role {user.role}")
    return user

@router.get("/{user_id}", response_model=UserWithAccess)
async def get_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(require_admin)
):
    """Get user details with assigned reports/dashboards"""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="Utente non trovato")
    
    # Get assigned reports
    result = await db.execute(
        select(UserReportAccess.report_id)
        .where(UserReportAccess.user_id == user_id)
    )
    report_ids = [r[0] for r in result.fetchall()]
    
    # Get assigned dashboards
    result = await db.execute(
        select(UserDashboardAccess.dashboard_id)
        .where(UserDashboardAccess.user_id == user_id)
    )
    dashboard_ids = [d[0] for d in result.fetchall()]
    
    return UserWithAccess(
        id=user.id,
        username=user.username,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        is_active=user.is_active,
        report_ids=report_ids,
        dashboard_ids=dashboard_ids
    )

@router.put("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: int,
    user_data: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(require_admin)
):
    """Update user details"""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="Utente non trovato")
    
    # Don't allow modifying the main admin
    if user.username == "admin" and current_user.username != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Non puoi modificare l'utente admin principale"
        )
    
    if user_data.email is not None:
        user.email = user_data.email
    if user_data.full_name is not None:
        user.full_name = user_data.full_name
    if user_data.role is not None:
        if user_data.role not in ["admin", "editor", "viewer"]:
            raise HTTPException(status_code=400, detail="Ruolo non valido")
        user.role = user_data.role
    if user_data.is_active is not None:
        user.is_active = user_data.is_active
    if user_data.password:
        user.password_hash = get_password_hash(user_data.password)
    
    await db.commit()
    await db.refresh(user)
    
    return user

@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(require_admin)
):
    """Delete a user"""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="Utente non trovato")
    
    if user.username == "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Non puoi eliminare l'utente admin"
        )
    
    await db.delete(user)
    await db.commit()

@router.post("/{user_id}/reports")
async def assign_reports(
    user_id: int,
    request: AssignReportsRequest,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(require_admin)
):
    """Assign reports to a user"""
    # Verify user exists
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Utente non trovato")
    
    # Remove existing assignments
    await db.execute(
        delete(UserReportAccess).where(UserReportAccess.user_id == user_id)
    )
    
    # Add new assignments
    for report_id in request.report_ids:
        # Verify report exists
        result = await db.execute(select(Report).where(Report.id == report_id))
        if not result.scalar_one_or_none():
            continue
        
        access = UserReportAccess(
            user_id=user_id,
            report_id=report_id,
            can_edit=request.can_edit
        )
        db.add(access)
    
    await db.commit()
    
    return {"message": f"Assegnati {len(request.report_ids)} report all'utente"}

@router.post("/{user_id}/dashboards")
async def assign_dashboards(
    user_id: int,
    request: AssignDashboardsRequest,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(require_admin)
):
    """Assign dashboards to a user"""
    # Verify user exists
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Utente non trovato")
    
    # Remove existing assignments
    await db.execute(
        delete(UserDashboardAccess).where(UserDashboardAccess.user_id == user_id)
    )
    
    # Add new assignments
    for dashboard_id in request.dashboard_ids:
        # Verify dashboard exists
        result = await db.execute(select(Dashboard).where(Dashboard.id == dashboard_id))
        if not result.scalar_one_or_none():
            continue
        
        access = UserDashboardAccess(
            user_id=user_id,
            dashboard_id=dashboard_id,
            can_edit=request.can_edit
        )
        db.add(access)
    
    await db.commit()
    
    return {"message": f"Assegnate {len(request.dashboard_ids)} dashboard all'utente"}

@router.get("/me/reports")
async def get_my_reports(
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Get reports accessible to current user"""
    if current_user.role == "admin":
        # Admin sees all
        result = await db.execute(select(Report).order_by(Report.name))
        reports = result.scalars().all()
    else:
        # Others see only assigned + public
        result = await db.execute(
            select(Report)
            .outerjoin(UserReportAccess, 
                (UserReportAccess.report_id == Report.id) & 
                (UserReportAccess.user_id == current_user.id))
            .where(
                (Report.visibility == "public") | 
                (UserReportAccess.user_id == current_user.id)
            )
            .order_by(Report.name)
        )
        reports = result.scalars().all()
    
    return [
        {
            "id": r.id,
            "name": r.name,
            "description": r.description
        }
        for r in reports
    ]

@router.get("/me/dashboards")
async def get_my_dashboards(
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Get dashboards accessible to current user"""
    if current_user.role == "admin":
        result = await db.execute(select(Dashboard).order_by(Dashboard.name))
        dashboards = result.scalars().all()
    else:
        result = await db.execute(
            select(Dashboard)
            .outerjoin(UserDashboardAccess,
                (UserDashboardAccess.dashboard_id == Dashboard.id) &
                (UserDashboardAccess.user_id == current_user.id))
            .where(
                (Dashboard.visibility == "public") |
                (UserDashboardAccess.user_id == current_user.id)
            )
            .order_by(Dashboard.name)
        )
        dashboards = result.scalars().all()
    
    return [
        {
            "id": d.id,
            "name": d.name,
            "description": d.description
        }
        for d in dashboards
    ]
