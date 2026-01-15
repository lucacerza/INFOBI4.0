import asyncio
import sys
import os
from sqlalchemy import text, select

# Aggiunge la root al path per permettere gli import
sys.path.append(os.getcwd())

from app.db.database import AsyncSessionLocal, Connection
from app.core.security import decrypt_password
from app.core.engine_pool import get_engine

async def check_databases():
    print("\n🔍 DIAGNOSTICA SQL SERVER")
    print("==========================")
    
    async with AsyncSessionLocal() as db:
        # Recupera le connessioni MSSQL salvate
        result = await db.execute(select(Connection).where(Connection.db_type == 'mssql'))
        connections = result.scalars().all()
        
        if not connections:
            print("❌ Nessuna connessione SQL Server trovata nel database di configurazione.")
            return

        for conn in connections:
            print(f"\n📡 Connessione: {conn.name}")
            print(f"   Host: {conn.host}")
            print(f"   User: {conn.username}")
            print(f"   DB Cercato: {conn.database}")
            
            # 1. Tenta connessione a 'master' per elencare i DB
            print(f"   [1/2] Test connessione a 'master'...")
            try:
                config = {
                    "host": conn.host,
                    "port": conn.port,
                    "database": "master", # Forziamo master che esiste sempre
                    "username": conn.username,
                    "password": decrypt_password(conn.password_encrypted),
                    "ssl_enabled": conn.ssl_enabled
                }
                
                engine = get_engine('mssql', config)
                with engine.connect() as connection:
                    print("   ✅ Connessione a 'master' RIUSCITA!")
                    
                    # Elenca i database
                    result = connection.execute(text("SELECT name FROM sys.databases ORDER BY name"))
                    dbs = [row[0] for row in result.fetchall()]
                    
                    print(f"\n   📂 Database Disponibili sul server ({len(dbs)}):")
                    found = False
                    for db_name in dbs:
                        marker = " ⬅️  QUESTO È QUELLO CHE CERCHI?" if db_name.lower() == conn.database.lower() else ""
                        if db_name == conn.database:
                            marker = " ✅ TROVATO!"
                            found = True
                        print(f"      - {db_name}{marker}")
                        
                    if not found:
                        print(f"\n   ❌ ERRORE: Il database '{conn.database}' NON ESISTE su questo server.")
                        print(f"      Scegli uno dei nomi dalla lista sopra e aggiorna la configurazione.")

            except Exception as e:
                print(f"   ❌ Fallita connessione a master: {e}")

if __name__ == "__main__":
    asyncio.run(check_databases())