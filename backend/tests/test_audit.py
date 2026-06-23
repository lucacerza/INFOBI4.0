"""Test d'integrazione dell'audit log (Fase 2.3b)."""


def _audit_entries(client, auth_headers):
    res = client.get("/api/audit?limit=200", headers=auth_headers)
    assert res.status_code == 200, res.text
    return res.json()


def test_login_success_is_audited(client, auth_headers):
    res = client.post("/api/auth/login", json={"username": "infostudio", "password": "Infostudi0++"})
    assert res.status_code == 200
    entries = _audit_entries(client, auth_headers)
    assert any(e["action"] == "login" and e["success"] and e["username"] == "infostudio" for e in entries)


def test_login_failure_is_audited(client, auth_headers):
    res = client.post("/api/auth/login", json={"username": "infostudio", "password": "WRONG-PASSWORD"})
    assert res.status_code == 401
    entries = _audit_entries(client, auth_headers)
    assert any(e["action"] == "login" and e["success"] is False and e["username"] == "infostudio" for e in entries)


def test_mutation_is_audited_by_middleware(client, auth_headers):
    res = client.post("/api/dashboards", json={"name": "Audit test", "description": ""}, headers=auth_headers)
    assert res.status_code in (200, 201)
    entries = _audit_entries(client, auth_headers)
    assert any(e["path"] == "/api/dashboards" and e["method"] == "POST" and e["username"] == "infostudio" for e in entries)


def test_audit_endpoint_requires_auth(client):
    res = client.get("/api/audit")
    assert res.status_code in (401, 403)
