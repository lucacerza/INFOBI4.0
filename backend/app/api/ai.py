"""AI API. In 8.1 espone solo lo stato della configurazione LLM (no chiamate)."""
import logging

from fastapi import APIRouter, Depends

from app.core.deps import get_current_superuser
from app.services import llm

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/status")
async def ai_status(user=Depends(get_current_superuser)):
    """Stato della configurazione AI (provider, modello, fallback). SUPERUSER."""
    return llm.provider_info()
