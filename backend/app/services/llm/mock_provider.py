"""
Provider mock: per sviluppo offline (nessuna API key) e per i test.
Può restituire risposte predefinite e/o simulare errori (es. 529) per
verificare retry e fallback senza rete.
"""
from typing import List, Optional

from .base import LLMProvider, LLMResponse, ToolSpec, LLMError, LLMTransientError


class MockLLM(LLMProvider):
    name = "mock"

    def __init__(
        self,
        responses: Optional[List[LLMResponse]] = None,
        *,
        fail_times: int = 0,
        error: Optional[LLMError] = None,
    ):
        # risposte da restituire in sequenza (l'ultima si ripete)
        self._responses = list(responses or [])
        # quante volte fallire prima di rispondere (simula sovraccarico)
        self._fail_times = fail_times
        self._error = error or LLMTransientError("overloaded (mock HTTP 529)")
        self.calls = 0

    async def generate(self, **kwargs) -> LLMResponse:
        self.calls += 1
        if self._fail_times > 0:
            self._fail_times -= 1
            raise self._error
        if len(self._responses) > 1:
            return self._responses.pop(0)
        if self._responses:
            return self._responses[0]
        return LLMResponse(text="", stop_reason="end_turn", model="mock")
