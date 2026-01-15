import urllib.parse
import hashlib
from typing import Dict, Any
from sqlalchemy import create_engine, Engine
from sqlalchemy.pool import QueuePool

# Singleton globale per mantenere i pool attivi in memoria
_engines: Dict[str, Engine] = {}

def get_engine(db_type: str, config: Dict[str, Any]) -> Engine:
    """
    Restituisce un Engine SQLAlchemy con Connection Pooling configurato.
    Se l'engine esiste già per questa configurazione, lo riutilizza.
    """
    # Chiave univoca per identificare la connessione (senza password in chiaro per sicurezza log)
    key_data = f"{db_type}://{config['username']}@{config['host']}:{config['port']}/{config['database']}"
    # Aggiungi hash della password per unicità senza esporla
    pwd_hash = hashlib.sha256(config['password'].encode()).hexdigest()[:16]
    key = f"{key_data}#{pwd_hash}"
    
    if key in _engines:
        return _engines[key]

    # Costruzione URL SQLAlchemy
    url = _build_sqlalchemy_url(db_type, config)
    
    # Configurazione ottimizzata per evitare il Cold Start
    engine = create_engine(
        url,
        poolclass=QueuePool,
        pool_size=5,          # Mantiene 5 connessioni sempre aperte
        max_overflow=10,      # Accetta picchi fino a 15
        pool_timeout=30,      # Timeout attesa connessione libera
        pool_recycle=3600,    # Ricicla connessioni ogni ora per evitare stale connections
        pool_pre_ping=True,   # Verifica che la connessione sia viva prima di usarla
        echo=False
    )
    
    _engines[key] = engine
    return engine

def _build_sqlalchemy_url(db_type: str, config: Dict[str, Any]) -> str:
    user = urllib.parse.quote_plus(config['username'])
    password = urllib.parse.quote_plus(config['password'])
    host = config['host']
    port = config['port']
    db = urllib.parse.quote_plus(config['database'])
    
    if db_type == 'mssql':
        # Usa driver ODBC standard per SQL Server
        # Driver 18 è lo standard nelle immagini recenti e richiede TrustServerCertificate per default
        ssl_enabled = config.get('ssl_enabled', False)
        encrypt = "yes" if ssl_enabled else "no"
        return f"mssql+pyodbc://{user}:{password}@{host}:{port}/{db}?driver=ODBC+Driver+18+for+SQL+Server&TrustServerCertificate=yes&Encrypt={encrypt}"
    
    elif db_type == 'postgresql':
        return f"postgresql://{user}:{password}@{host}:{port}/{db}"
    
    elif db_type == 'mysql':
        return f"mysql+pymysql://{user}:{password}@{host}:{port}/{db}"
        
    else:
        raise ValueError(f"Database type {db_type} non supportato")

def close_all_pools():
    """Chiude tutte le connessioni (utile per shutdown pulito)"""
    for engine in _engines.values():
        engine.dispose()
    _engines.clear()

def get_pool_status() -> Dict[str, Dict[str, Any]]:
    """Restituisce lo stato di tutti i pool attivi (per monitoraggio admin)"""
    status = {}
    for key, engine in _engines.items():
        pool = engine.pool
        status[key] = {
            "size": pool.size(),
            "checked_out": pool.checkedout(),
            "overflow": pool.overflow(),
            "checked_in": pool.checkedin(),
        }
    return status