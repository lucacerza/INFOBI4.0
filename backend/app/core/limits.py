"""Cost guard: limita il numero di righe restituite da una query."""
from typing import Optional

from app.core.config import settings


def clamp_rows(requested: Optional[int]) -> int:
    """
    Ritorna un limite di righe sicuro: mai oltre MAX_ROWS_PREVIEW (cap configurabile).
    Se non richiesto (o non valido), usa il cap come default.
    """
    cap = settings.MAX_ROWS_PREVIEW
    if not requested or int(requested) <= 0:
        return cap
    return min(int(requested), cap)
