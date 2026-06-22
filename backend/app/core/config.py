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
