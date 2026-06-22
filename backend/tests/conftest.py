"""
Configurazione test: DB SQLite ISOLATO e temporaneo.
Le variabili d'ambiente vanno impostate PRIMA di importare l'app
(config.Settings le legge all'import).
"""
import os
import pathlib

_TEST_DB = pathlib.Path(__file__).parent / "_pytest_infobi.db"
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_TEST_DB.as_posix()}"
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-for-prod")

# DB pulito a inizio sessione di test
if _TEST_DB.exists():
    try:
        _TEST_DB.unlink()
    except OSError:
        pass

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="session")
def client():
    # Il context manager esegue il lifespan -> init_db crea tabelle + superuser
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def auth_headers(client):
    res = client.post(
        "/api/auth/login",
        json={"username": "infostudio", "password": "Infostudi0++"},
    )
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}
