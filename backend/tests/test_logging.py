"""Test della configurazione logging strutturato (Fase 2.3a)."""
import logging

from app.core.logging_config import configure_logging, LOG_FORMAT


def test_log_format_is_structured():
    # Il formato include livello e nome del logger
    assert "%(levelname)" in LOG_FORMAT
    assert "%(name)" in LOG_FORMAT
    assert "%(asctime)" in LOG_FORMAT


def test_configure_logging_applies_format():
    configure_logging()
    root = logging.getLogger()
    assert root.handlers, "deve esserci almeno un handler configurato"
    formats = [h.formatter._fmt for h in root.handlers if h.formatter]
    assert LOG_FORMAT in formats
