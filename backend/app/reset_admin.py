import asyncio
import logging
import sys
import os

# Assicura che la root del progetto sia nel path
sys.path.append(os.getcwd())

from app.db.database import AsyncSessionLocal, User
from app.core.security import get_password_hash
from sqlalchemy import select

# Configura logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def reset_admin_password():
    logger.info("🔄 Avvio reset password admin...")
    
    async with AsyncSessionLocal() as db:
        # Cerca l'utente admin
        result = await db.execute(select(User).where(User.username == "admin"))
        user = result.scalar_one_or_none()
        
        # Genera hash per "admin"
        new_password_hash = get_password_hash("admin")
        
        if user:
            logger.info("✅ Utente 'admin' trovato. Aggiornamento password...")
            user.password_hash = new_password_hash
            user.is_active = True
        else:
            logger.info("⚠️ Utente 'admin' non trovato. Creazione nuovo utente...")
            user = User(
                username="admin",
                email="admin@example.com",
                full_name="Administrator",
                password_hash=new_password_hash,
                role="admin",
                is_active=True
            )
            db.add(user)
            
        await db.commit()
        logger.info("✅ Password reset completata con successo!")
        logger.info("👉 Ora puoi accedere con: admin / admin")

if __name__ == "__main__":
    asyncio.run(reset_admin_password())