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


async def get_current_admin_or_superuser(user: User = Depends(get_current_user)) -> User:
    """Alias for get_current_admin (accepts both admin and superuser)"""
    return await get_current_admin(user)


# Aliases for clarity
require_superuser = get_current_superuser
require_admin = get_current_admin


def require_role(*roles: str):
    """Factory for role-based access"""
    async def check_role(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Required role: {', '.join(roles)}"
            )
        return user
    return check_role
