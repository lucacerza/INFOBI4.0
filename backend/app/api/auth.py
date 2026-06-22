"""Authentication API"""
import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.database import get_db, User
from app.core.security import verify_password, create_access_token
from app.core.deps import get_current_user
from app.services.audit import record_audit
from app.models.schemas import LoginRequest, TokenResponse, UserResponse

logger = logging.getLogger(__name__)
router = APIRouter()


async def _audit_login(username: str, success: bool, http_req: Request, detail: str = None):
    await record_audit(
        username=username,
        action="login",
        method="POST",
        path="/api/auth/login",
        status_code=200 if success else 401,
        success=success,
        ip_address=http_req.client.host if http_req.client else None,
        detail=detail,
    )


@router.post("/login", response_model=TokenResponse)
async def login(request: LoginRequest, http_req: Request, db: AsyncSession = Depends(get_db)):
    """Authenticate user and return JWT token"""
    result = await db.execute(select(User).where(User.username == request.username))
    user = result.scalar_one_or_none()

    if not user:
        logger.warning(f"Login failed: User {request.username} not found")
        await _audit_login(request.username, False, http_req, "user not found")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password"
        )

    if not verify_password(request.password, user.password_hash):
        logger.warning(f"Login failed: Password mismatch for {request.username}")
        await _audit_login(request.username, False, http_req, "bad password")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password"
        )

    if not user.is_active:
        await _audit_login(request.username, False, http_req, "account disabled")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is disabled"
        )

    # Update last login
    user.last_login = datetime.utcnow()
    await db.commit()
    await _audit_login(user.username, True, http_req)

    # Create token
    token = create_access_token({"sub": user.username})
    
    return TokenResponse(
        access_token=token,
        user={
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "role": user.role
        }
    )

@router.get("/me", response_model=UserResponse)
async def get_me(user: User = Depends(get_current_user)):
    """Get current user info"""
    return user
