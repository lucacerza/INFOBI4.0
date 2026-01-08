"""
Redis/Dragonfly Cache Service
- Caches query results as Arrow IPC
- Caches pivot aggregations
- Sub-millisecond retrieval
"""
import hashlib
import logging
from typing import Optional
import redis.asyncio as redis
from app.core.config import settings

logger = logging.getLogger(__name__)

class CacheService:
    def __init__(self):
        self.redis: Optional[redis.Redis] = None
    
    async def connect(self):
        """Connect to Redis/Dragonfly"""
        if not self.redis:
            self.redis = redis.from_url(
                settings.REDIS_URL,
                encoding="utf-8",
                decode_responses=False,  # We store binary Arrow data
            )
            logger.info(f"✅ Connected to cache: {settings.REDIS_URL}")
    
    async def disconnect(self):
        """Close connection"""
        if self.redis:
            await self.redis.close()
    
    @staticmethod
    def make_key(prefix: str, *args) -> str:
        """Create cache key from components"""
        content = ":".join(str(a) for a in args)
        hash_val = hashlib.md5(content.encode()).hexdigest()[:12]
        return f"infobi:{prefix}:{hash_val}"
    
    async def get(self, key: str) -> Optional[bytes]:
        """Get cached value"""
        await self.connect()
        try:
            data = await self.redis.get(key)
            if data:
                logger.debug(f"Cache HIT: {key}")
            return data
        except Exception as e:
            logger.warning(f"Cache GET error: {e}")
            return None
    
    async def set(self, key: str, value: bytes, ttl: int = None):
        """Set cached value with TTL"""
        await self.connect()
        try:
            ttl = ttl or settings.CACHE_TTL
            await self.redis.setex(key, ttl, value)
            logger.debug(f"Cache SET: {key} (TTL: {ttl}s)")
        except Exception as e:
            logger.warning(f"Cache SET error: {e}")
    
    async def delete(self, pattern: str):
        """Delete keys matching pattern"""
        await self.connect()
        try:
            keys = await self.redis.keys(f"infobi:{pattern}:*")
            if keys:
                await self.redis.delete(*keys)
                logger.info(f"Cache DELETE: {len(keys)} keys matching {pattern}")
        except Exception as e:
            logger.warning(f"Cache DELETE error: {e}")
    
    async def get_pivot(self, report_id: int, config_hash: str) -> Optional[bytes]:
        """Get cached pivot result"""
        key = self.make_key("pivot", report_id, config_hash)
        return await self.get(key)
    
    async def set_pivot(self, report_id: int, config_hash: str, data: bytes):
        """Cache pivot result (shorter TTL)"""
        key = self.make_key("pivot", report_id, config_hash)
        await self.set(key, data, settings.CACHE_TTL_PIVOT)
    
    async def get_query(self, report_id: int, query_hash: str) -> Optional[bytes]:
        """Get cached query result"""
        key = self.make_key("query", report_id, query_hash)
        return await self.get(key)
    
    async def set_query(self, report_id: int, query_hash: str, data: bytes):
        """Cache query result"""
        key = self.make_key("query", report_id, query_hash)
        await self.set(key, data, settings.CACHE_TTL)
    
    async def invalidate_report(self, report_id: int):
        """Invalidate all caches for a report"""
        await self.delete(f"*:{report_id}:*")

# Singleton instance
cache = CacheService()
