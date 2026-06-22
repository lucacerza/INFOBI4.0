"""
Smoke test: l'applicazione si avvia e gli endpoint di base rispondono.
Garantisce che import, routing e lifespan non siano rotti.
"""
from fastapi.testclient import TestClient

from app.main import app


def test_health_endpoint():
    with TestClient(app) as client:
        res = client.get("/health")
        assert res.status_code == 200
        assert res.json()["status"] == "healthy"


def test_root_endpoint():
    with TestClient(app) as client:
        res = client.get("/")
        assert res.status_code == 200
        assert "INFOBI" in res.json()["message"]


def test_protected_endpoint_requires_auth():
    """Un endpoint protetto senza token deve rifiutare (401/403)."""
    with TestClient(app) as client:
        res = client.get("/api/connections")
        assert res.status_code in (401, 403)
