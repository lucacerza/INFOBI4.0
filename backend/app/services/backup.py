"""
Backup automatico del DB applicativo SQLite.
Usa la backup API di sqlite3 (consistente anche con accessi concorrenti)
e mantiene una rotazione degli ultimi N backup.
"""
import logging
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Optional

from app.core.config import settings

logger = logging.getLogger(__name__)


def sqlite_path_from_url(url: str) -> Optional[Path]:
    """Estrae il path del file dal DATABASE_URL SQLite (None se non è SQLite su file)."""
    if "sqlite" not in url:
        return None
    idx = url.find(":///")
    if idx == -1:
        return None
    raw = url[idx + 4:]
    if not raw or raw == ":memory:":
        return None
    return Path(raw)


def _rotate(backup_dir: Path, keep: int) -> None:
    """Elimina i backup più vecchi oltre i 'keep' da conservare."""
    backups = sorted(backup_dir.glob("infobi_*.db"))
    excess = len(backups) - max(0, keep)
    for old in backups[:max(0, excess)]:
        try:
            old.unlink()
        except OSError:
            logger.warning("Impossibile rimuovere il backup %s", old)


def backup_database(timestamp: Optional[str] = None) -> Optional[Path]:
    """Crea un backup del DB SQLite e applica la rotazione. Ritorna il path creato o None."""
    src = sqlite_path_from_url(settings.DATABASE_URL)
    if not src or not src.exists():
        logger.warning("Backup saltato: DB SQLite non trovato (%s)", src)
        return None

    backup_dir = Path(settings.BACKUP_DIR)
    backup_dir.mkdir(parents=True, exist_ok=True)

    ts = timestamp or datetime.now().strftime("%Y%m%d_%H%M%S")
    dest = backup_dir / f"infobi_{ts}.db"

    src_conn = sqlite3.connect(str(src))
    dst_conn = sqlite3.connect(str(dest))
    try:
        src_conn.backup(dst_conn)  # backup API consistente
    finally:
        dst_conn.close()
        src_conn.close()

    logger.info("✅ Backup DB creato: %s", dest)
    _rotate(backup_dir, settings.BACKUP_KEEP)
    return dest
