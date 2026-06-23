"""
Backup automatico del DB applicativo SQLite e del warehouse DuckDB.
Usa la backup API di sqlite3 (consistente) per il DB app e una copia di file
(con CHECKPOINT) per il warehouse. Mantiene una rotazione degli ultimi N backup.
"""
import logging
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import List, Optional

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


def _rotate(backup_dir: Path, keep: int, pattern: str = "infobi_*.db") -> None:
    """Elimina i backup più vecchi (per pattern) oltre i 'keep' da conservare."""
    backups = sorted(backup_dir.glob(pattern))
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
    _rotate(backup_dir, settings.BACKUP_KEEP, "infobi_*.db")
    return dest


def backup_warehouse(timestamp: Optional[str] = None) -> Optional[Path]:
    """
    Crea un backup del file warehouse DuckDB (copia con CHECKPOINT) e ruota.
    Ritorna il path creato, o None se il warehouse non esiste ancora.
    """
    from app.services.warehouse import warehouse_path  # import locale: evita import duckdb all'avvio

    src = warehouse_path()
    if not src.exists():
        logger.info("Backup warehouse saltato: file non ancora creato (%s)", src)
        return None

    backup_dir = Path(settings.BACKUP_DIR)
    backup_dir.mkdir(parents=True, exist_ok=True)

    ts = timestamp or datetime.now().strftime("%Y%m%d_%H%M%S")
    dest = backup_dir / f"warehouse_{ts}.duckdb"

    # CHECKPOINT best-effort per consolidare il WAL prima della copia
    try:
        import duckdb
        con = duckdb.connect(str(src))
        con.execute("CHECKPOINT")
        con.close()
    except Exception as e:
        logger.warning("CHECKPOINT warehouse non riuscito (procedo con la copia): %s", e)

    shutil.copy2(src, dest)
    logger.info("✅ Backup warehouse creato: %s", dest)
    _rotate(backup_dir, settings.BACKUP_KEEP, "warehouse_*.duckdb")
    return dest


def run_backups(timestamp: Optional[str] = None) -> List[Path]:
    """Esegue tutti i backup (DB app + warehouse). Non solleva: logga e prosegue."""
    created: List[Path] = []
    for fn in (backup_database, backup_warehouse):
        try:
            dest = fn(timestamp)
            if dest:
                created.append(dest)
        except Exception:
            logger.exception("Backup fallito: %s", fn.__name__)
    return created
