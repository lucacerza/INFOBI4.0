"""Configuration with environment variables"""
import os
from typing import List, Optional
from pydantic_settings import BaseSettings

# Valore di default insicuro: usato solo per sviluppo, va sovrascritto in prod.
DEFAULT_SECRET = "super-secret-key-change-in-production"

class Settings(BaseSettings):
    # Security
    SECRET_KEY: str = DEFAULT_SECRET
    # Chiavi dedicate e separate. Se vuote -> fallback a SECRET_KEY (backward compatible:
    # i token e le password gia' cifrate restano validi finche' non si impostano chiavi proprie).
    JWT_SECRET: str = ""            # firma dei JWT
    DATA_ENCRYPTION_KEY: str = ""   # cifratura Fernet delle password delle connessioni
    ENVIRONMENT: str = "development"  # 'production' -> validazione stringente all'avvio
    LOG_LEVEL: str = "INFO"           # DEBUG/INFO/WARNING/ERROR
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours
    
    # Database - must use aiosqlite for async
    DATABASE_URL: str = "sqlite+aiosqlite:///./data/infobi.db"
    
    # Redis/Dragonfly cache
    REDIS_URL: str = "redis://localhost:6379"
    CACHE_TTL: int = 7200  # 2 hours default
    CACHE_TTL_PIVOT: int = 600  # 10 minutes for pivot results
    
    # CORS
    CORS_ORIGINS: List[str] = ["http://localhost:3000", "http://localhost:5173", "http://localhost:8001"]
    
    # Query limits
    MAX_ROWS_PREVIEW: int = 10000  # Increased for better UX
    MAX_ROWS_EXPORT: int = 5000000  # 5M rows max
    QUERY_TIMEOUT: int = 300  # 5 minutes
    CONNECTION_TIMEOUT: int = 180  # 3 minutes for connection test with warm-up

    # Rate limiting (per utente/IP, finestra scorrevole in memoria)
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_RPM: int = 120              # richieste max per finestra
    RATE_LIMIT_WINDOW_SECONDS: int = 60

    # Datawarehouse (DuckDB)
    WAREHOUSE_DIR: str = "./data/warehouse"
    # Sync automatico dei dataset warehouse (ETL incrementale schedulato). Opt-in.
    WAREHOUSE_SYNC_ENABLED: bool = False
    WAREHOUSE_SYNC_INTERVAL_HOURS: int = 6

    # Semantic layer: parole-indizio per riconoscere le colonne temporali
    # nell'autodetect. È solo un SUGGERIMENTO (ogni colonna resta correggibile
    # a mano); esternalizzato qui per estenderlo senza toccare il codice.
    # Override via .env con JSON: SEMANTIC_TIME_HINTS=["date","anno","fiscal_year"]
    SEMANTIC_TIME_HINTS: List[str] = [
        "date", "data", "anno", "year", "mese", "month",
        "giorno", "day", "periodo", "trimestre", "quarter", "settimana", "week",
    ]

    # AI / LLM. Provider-agnostico con resilienza al sovraccarico (HTTP 529).
    # LLM_PROVIDER: auto (anthropic se c'è la key, altrimenti mock) | anthropic | mock
    # LLM_BASE_URL: override per gateway compatibili (LiteLLM/Ollama) — predisposto.
    LLM_PROVIDER: str = "auto"
    LLM_MODEL: str = "claude-opus-4-8"
    LLM_API_KEY: str = ""
    LLM_BASE_URL: str = ""
    LLM_FALLBACK_MODEL: str = ""        # modello di ripiego (stesso provider)
    LLM_MAX_RETRIES: int = 3            # ritenta gli errori transitori (429/529/5xx)
    LLM_RETRY_BASE_DELAY: float = 0.5   # backoff esponenziale: base * 2**tentativo
    LLM_TIMEOUT: int = 60
    # Governance: se True l'AI può usare SOLO le colonne certificate (is_certified)
    AI_CERTIFIED_ONLY: bool = False

    # Backup automatico del DB applicativo (SQLite)
    BACKUP_ENABLED: bool = True
    BACKUP_DIR: str = "./data/backups"
    BACKUP_INTERVAL_HOURS: int = 24
    BACKUP_KEEP: int = 7  # quanti backup conservare (rotazione)

    class Config:
        env_file = ".env"

    @property
    def jwt_secret(self) -> str:
        """Chiave effettiva per i JWT (dedicata o fallback a SECRET_KEY)."""
        return self.JWT_SECRET or self.SECRET_KEY

    @property
    def data_encryption_secret(self) -> str:
        """Chiave effettiva per la cifratura dati (dedicata o fallback a SECRET_KEY)."""
        return self.DATA_ENCRYPTION_KEY or self.SECRET_KEY

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT.lower() in ("production", "prod")

settings = Settings()


def security_warnings(s: Optional[Settings] = None) -> List[str]:
    """Elenca i problemi di sicurezza nella configurazione delle chiavi."""
    s = s or settings
    issues: List[str] = []
    if s.jwt_secret == DEFAULT_SECRET:
        issues.append("JWT_SECRET/SECRET_KEY è al valore di default insicuro")
    if s.data_encryption_secret == DEFAULT_SECRET:
        issues.append("DATA_ENCRYPTION_KEY/SECRET_KEY è al valore di default insicuro")
    return issues
