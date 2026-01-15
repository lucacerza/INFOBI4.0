"""Configuration with environment variables"""
import os
from typing import List
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # Security
    SECRET_KEY: str = "super-secret-key-change-in-production"
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
    
    class Config:
        env_file = ".env"

settings = Settings()
