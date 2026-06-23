"""FastAPI dependencies"""
from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.database import get_db, User
from app.core.security import decode_token

security = HTTPBearer()

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db)
) -> User:
    """Get current authenticated user"""
    token = credentials.credentials
    payload = decode_token(token)
    
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token"
        )
    
    username = payload.get("sub")
    if not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload"
        )
    
    result = await db.execute(select(User).where(User.username == username))
    user = result.scalar_one_or_none()
    
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive"
        )
    
    return user

async def get_current_superuser(user: User = Depends(get_current_user)) -> User:
    """
    Require SUPERUSER role.

    Solo superuser può:
    - Gestire connessioni database
    - Gestire report/query
    - Gestire tutti gli utenti (inclusi admin)
    """
    if user.role != "superuser":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Superuser access required"
        )
    return user


async def get_current_admin(user: User = Depends(get_current_user)) -> User:
    """
    Require ADMIN role or higher.

    Admin può:
    - Creare/gestire dashboard
    - Gestire utenti con ruolo USER
    - NON può vedere/gestire connessioni o report
    """
    if user.role not in ("admin", "superuser"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )
    return user


async def get_current_steward(user: User = Depends(get_current_user)) -> User:
    """
    Require DATA_STEWARD role or SUPERUSER.

    Il data steward governa il SIGNIFICATO dei dati (semantic layer):
    - certifica colonne/misure, modifica i metadati semantici
    - consulta il catalogo schema
    - NON gestisce connessioni (credenziali) né utenti
    """
    if user.role not in ("data_steward", "superuser"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Data steward access required"
        )
    return user


async def get_current_report_viewer(user: User = Depends(get_current_user)) -> User:
    """Chi può consultare la lista dei report: superuser, admin, data steward."""
    if user.role not in ("superuser", "admin", "data_steward"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Report access required"
        )
    return user
