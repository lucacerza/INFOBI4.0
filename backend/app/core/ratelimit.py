"""Rate limiter in memoria a finestra scorrevole (per singola istanza)."""
import time
from collections import defaultdict, deque
from threading import Lock
from typing import Optional


class RateLimiter:
    def __init__(self, max_per_window: int, window_seconds: int = 60):
        self.max_per_window = max_per_window
        self.window_seconds = window_seconds
        self._hits = defaultdict(deque)
        self._lock = Lock()

    def allow(self, key: str, now: Optional[float] = None) -> bool:
        """True se la richiesta è consentita; registra l'hit. now iniettabile per i test."""
        now = time.monotonic() if now is None else now
        with self._lock:
            dq = self._hits[key]
            cutoff = now - self.window_seconds
            while dq and dq[0] <= cutoff:
                dq.popleft()
            if len(dq) >= self.max_per_window:
                return False
            dq.append(now)
            return True
