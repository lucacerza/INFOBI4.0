"""Provider Anthropic (Claude) via API Messages, con classificazione errori."""
import logging
from typing import Any, Dict, List, Optional

import httpx

from .base import (
    LLMProvider, LLMResponse, ToolCall, ToolSpec,
    LLMError, LLMTransientError, LLMConfigError,
)

logger = logging.getLogger(__name__)

ANTHROPIC_VERSION = "2023-06-01"


class AnthropicLLM(LLMProvider):
    name = "anthropic"

    def __init__(self, api_key: str, model: str, base_url: str = "", timeout: int = 60):
        if not api_key:
            raise LLMConfigError("LLM_API_KEY mancante per il provider Anthropic")
        self.api_key = api_key
        self.model = model
        self.timeout = timeout
        root = (base_url or "https://api.anthropic.com").rstrip("/")
        self.url = f"{root}/v1/messages"

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
        payload: Dict[str, Any] = {
            "model": self.model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": messages,
        }
        if system:
            payload["system"] = system
        if tools:
            payload["tools"] = [
                {"name": t.name, "description": t.description, "input_schema": t.input_schema}
                for t in tools
            ]
            if tool_choice:
                payload["tool_choice"] = tool_choice

        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                r = await client.post(self.url, json=payload, headers=headers)
        except (httpx.TimeoutException, httpx.TransportError) as e:
            raise LLMTransientError(f"errore di rete: {e}")

        # 429 (rate limit), 529 (overloaded), 5xx -> transitori e ritentabili
        if r.status_code in (429, 529) or r.status_code >= 500:
            raise LLMTransientError(f"HTTP {r.status_code}: {r.text[:200]}")
        if r.status_code >= 400:
            raise LLMError(f"HTTP {r.status_code}: {r.text[:200]}")

        data = r.json()
        text_parts: List[str] = []
        tool_calls: List[ToolCall] = []
        for block in data.get("content", []):
            btype = block.get("type")
            if btype == "text":
                text_parts.append(block.get("text", ""))
            elif btype == "tool_use":
                tool_calls.append(ToolCall(name=block.get("name", ""), arguments=block.get("input", {}) or {}))

        return LLMResponse(
            text="".join(text_parts) or None,
            tool_calls=tool_calls,
            stop_reason=data.get("stop_reason"),
            model=data.get("model"),
        )
