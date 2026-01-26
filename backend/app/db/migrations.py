"""Database migrations for schema updates

Questo modulo gestisce le migrazioni del database SQLite.
SQLAlchemy create_all() non aggiunge colonne a tabelle esistenti,
quindi dobbiamo gestire manualmente le migrazioni.
"""
import logging
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


async def run_migrations(session: AsyncSession):
    """Esegue tutte le migrazioni necessarie"""

    migrations = [
        migrate_add_user_permission_columns,
        migrate_fix_infostudio_system_account,
    ]

    for migration in migrations:
        try:
            await migration(session)
        except Exception as e:
            logger.warning(f"Migration {migration.__name__}: {e}")


async def migrate_add_user_permission_columns(session: AsyncSession):
    """Aggiunge le colonne is_system_account e created_by alla tabella users"""

    # Check if columns exist
    result = await session.execute(text("PRAGMA table_info(users)"))
    columns = {row[1] for row in result.fetchall()}

    # Add is_system_account if missing
    if "is_system_account" not in columns:
        await session.execute(text(
            "ALTER TABLE users ADD COLUMN is_system_account BOOLEAN DEFAULT 0"
        ))
        logger.info("✅ Added column: users.is_system_account")

    # Add created_by if missing
    if "created_by" not in columns:
        await session.execute(text(
            "ALTER TABLE users ADD COLUMN created_by INTEGER"
        ))
        logger.info("✅ Added column: users.created_by")

    await session.commit()


async def migrate_fix_infostudio_system_account(session: AsyncSession):
    """Assicura che infostudio abbia is_system_account=1"""

    # Imposta is_system_account=1 per infostudio (se esiste)
    result = await session.execute(text(
        "UPDATE users SET is_system_account = 1 WHERE username = 'infostudio'"
    ))
    if result.rowcount > 0:
        logger.info("✅ Fixed infostudio: is_system_account = 1")

    # Assicura che nessun altro utente abbia is_system_account=1
    await session.execute(text(
        "UPDATE users SET is_system_account = 0 WHERE username != 'infostudio' AND is_system_account = 1"
    ))

    await session.commit()
