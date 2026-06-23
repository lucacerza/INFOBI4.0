"""Configurazione centralizzata del logging (strutturato, livello configurabile)."""
import logging
from app.core.config import settings

LOG_FORMAT = "%(asctime)s %(levelname)-8s [%(name)s] %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


def configure_logging() -> None:
    """Imposta formato e livello del logging dalla configurazione (LOG_LEVEL)."""
    level = getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO)
    logging.basicConfig(level=level, format=LOG_FORMAT, datefmt=DATE_FORMAT, force=True)
