"""
Astrazione LLM provider-agnostica.

Obiettivi:
- disaccoppiare l'app dal singolo fornitore (Claude primario; predisposto a
  gateway OpenAI-compatibili come LiteLLM/Ollama via LLM_BASE_URL);
- resilienza al sovraccarico (HTTP 529 "overloaded") e agli errori transitori
  con retry + backoff esponenziale e fallback opzionale a un secondo modello.
"""
import abc
import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# ---------- Errori ----------
class LLMError(Exception):
    """Errore LLM non recuperabile (es. 400/401/403, config errata)."""


class LLMTransientError(LLMError):
    """Errore transitorio e ritentabile (429/529/5xx, timeout di rete)."""


class LLMConfigError(LLMError):
    """Configurazione assente o non valida."""


# ---------- Tipi ----------
@dataclass
class ToolSpec:
    """Definizione di uno strumento (function-calling / tool-use)."""
    name: str
    description: str
    input_schema: Dict[str, Any]


@dataclass
class ToolCall:
    name: str
    arguments: Dict[str, Any]


@dataclass
class LLMResponse:
    text: Optional[str] = None
    tool_calls: List[ToolCall] = field(default_factory=list)
    stop_reason: Optional[str] = None
    model: Optional[str] = None


# ---------- Provider ----------
class LLMProvider(abc.ABC):
    """Interfaccia minima: una sola chiamata di generazione (con eventuali tool)."""
    name: str = "base"

    @abc.abstractmethod
    async def generate(
        self,
        *,
        system: str = "",
        messages: List[Dict[str, Any]],
        tools: Optional[List[ToolSpec]] = None,
        tool_choice: Optional[Dict[str, Any]] = None,
        max_tokens: int = 1024,
        temperature: float = 0.0,
    ) -> LLMResponse:
        ...


class ResilientLLM:
    """
    Avvolge un provider primario (e uno di fallback) aggiungendo retry con
    backoff esponenziale sugli errori transitori. Su errore permanente passa
    direttamente al fallback (se presente).
    """

    def __init__(
        self,
        primary: LLMProvider,
        fallback: Optional[LLMProvider] = None,
        max_retries: int = 3,
        base_delay: float = 0.5,
    ):
        self.primary = primary
        self.fallback = fallback
        self.max_retries = max_retries
        self.base_delay = base_delay

    @property
    def name(self) -> str:
        return self.primary.name

    async def generate(self, **kwargs) -> LLMResponse:
        providers = [self.primary] + ([self.fallback] if self.fallback else [])
        last_error: Optional[Exception] = None

        for provider in providers:
            for attempt in range(self.max_retries + 1):
                try:
                    return await provider.generate(**kwargs)
                except LLMTransientError as e:
                    last_error = e
                    if attempt < self.max_retries:
                        delay = self.base_delay * (2 ** attempt)
                        logger.warning(
                            "LLM '%s' transitorio (tentativo %d/%d): %s — retry tra %.1fs",
                            provider.name, attempt + 1, self.max_retries, e, delay,
                        )
                        if delay > 0:
                            await asyncio.sleep(delay)
                    else:
                        logger.warning("LLM '%s': retry esauriti", provider.name)
                except LLMError as e:
                    # permanente: inutile ritentare lo stesso provider
                    last_error = e
                    logger.warning("LLM '%s' errore permanente: %s", provider.name, e)
                    break

        raise last_error or LLMError("Nessun provider LLM disponibile")
