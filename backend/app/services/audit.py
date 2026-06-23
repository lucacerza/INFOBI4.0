"""Servizio di audit log: scrittura resiliente di eventi sensibili."""
import logging
from typing import Optional

from app.db.database import AsyncSessionLocal, AuditLog

logger = logging.getLogger(__name__)


async def record_audit(
    *,
    username: Optional[str] = None,
    action: str = "",
    method: str = "",
    path: str = "",
    status_code: Optional[int] = None,
    success: bool = True,
    ip_address: Optional[str] = None,
    detail: Optional[str] = None,
) -> None:
    """
    Registra una voce di audit. Usa una sessione DB propria e non solleva mai:
    un errore di audit non deve interrompere la richiesta dell'utente.
    """
    try:
        async with AsyncSessionLocal() as session:
            session.add(AuditLog(
                username=username,
                action=action,
                method=method,
                path=path,
                status_code=status_code,
                success=success,
                ip_address=ip_address,
                detail=detail,
            ))
            await session.commit()
    except Exception:
        logger.exception("Audit log write failed")
