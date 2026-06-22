"""
Test separazione chiavi (Fase 2.2): JWT_SECRET / DATA_ENCRYPTION_KEY
con fallback a SECRET_KEY, e validazione sicurezza.
"""
from app.core.config import Settings, DEFAULT_SECRET, security_warnings
from app.core.security import encrypt_password, decrypt_password


def test_fallback_a_secret_key_quando_chiavi_dedicate_vuote():
    s = Settings(SECRET_KEY="abc123", JWT_SECRET="", DATA_ENCRYPTION_KEY="")
    assert s.jwt_secret == "abc123"
    assert s.data_encryption_secret == "abc123"


def test_chiavi_dedicate_hanno_precedenza():
    s = Settings(SECRET_KEY="abc123", JWT_SECRET="jwt-key", DATA_ENCRYPTION_KEY="enc-key")
    assert s.jwt_secret == "jwt-key"
    assert s.data_encryption_secret == "enc-key"


def test_security_warnings_segnala_default():
    s = Settings(SECRET_KEY=DEFAULT_SECRET, JWT_SECRET="", DATA_ENCRYPTION_KEY="")
    issues = security_warnings(s)
    assert len(issues) == 2  # JWT + encryption entrambi al default


def test_security_warnings_silente_con_chiavi_personalizzate():
    s = Settings(SECRET_KEY="una-chiave-robusta", JWT_SECRET="", DATA_ENCRYPTION_KEY="")
    assert security_warnings(s) == []


def test_is_production_flag():
    assert Settings(ENVIRONMENT="production").is_production is True
    assert Settings(ENVIRONMENT="development").is_production is False


def test_encrypt_decrypt_roundtrip():
    # Round-trip con la chiave effettiva corrente (backward compatible)
    plain = "p@ssw0rd-Connessione!"
    assert decrypt_password(encrypt_password(plain)) == plain
