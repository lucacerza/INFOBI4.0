"""Ruolo data_steward: governa il semantic layer senza accesso a connessioni/utenti."""
import sqlite3

import pytest


def _create_user(client, auth_headers, username, role):
    """Crea l'utente se non esiste (il DB di test è condiviso nella sessione)."""
    res = client.post("/api/users", headers=auth_headers, json={
        "username": username, "password": "Stew0rd++pwd", "role": role,
    })
    assert res.status_code in (200, 201, 400), res.text  # 400 = già esistente
    return res


def _login(client, username, password="Stew0rd++pwd"):
    res = client.post("/api/auth/login", json={"username": username, "password": password})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


@pytest.fixture
def steward_headers(client, auth_headers):
    _create_user(client, auth_headers, "steward_user", "data_steward")
    return _login(client, "steward_user")


@pytest.fixture
def report_ctx(client, auth_headers, tmp_path):
    src = tmp_path / "ds.db"
    conn = sqlite3.connect(str(src))
    conn.execute("CREATE TABLE vendite (regione TEXT, fatturato REAL)")
    conn.execute("INSERT INTO vendite VALUES ('Nord', 100.0)")
    conn.commit()
    conn.close()
    cid = client.post("/api/connections", headers=auth_headers, json={
        "name": "src-ds", "db_type": "sqlite", "host": "localhost", "port": 0,
        "database": str(src), "username": "x", "password": "x",
    }).json()["id"]
    rid = client.post("/api/reports", headers=auth_headers, json={
        "name": "Vendite DS", "connection_id": cid,
        "query": "SELECT regione, fatturato FROM vendite",
    }).json()["id"]
    return {"conn_id": cid, "report_id": rid}


def test_steward_can_govern_semantics(client, steward_headers, report_ctx):
    rid = report_ctx["report_id"]
    # autodetect + edit + certify
    auto = client.post(f"/api/semantic/reports/{rid}/autodetect", headers=steward_headers)
    assert auto.status_code == 200, auto.text
    upd = client.put(f"/api/semantic/reports/{rid}/columns/fatturato",
                     headers=steward_headers, json={"is_certified": True, "unit": "€"})
    assert upd.status_code == 200
    assert upd.json()["is_certified"] is True


def test_steward_can_list_reports_and_catalog(client, steward_headers, report_ctx):
    assert client.get("/api/reports", headers=steward_headers).status_code == 200
    cid = report_ctx["conn_id"]
    assert client.get(f"/api/catalog/connections/{cid}/tables", headers=steward_headers).status_code == 200


def test_steward_cannot_manage_connections_or_warehouse(client, steward_headers, report_ctx):
    # niente connessioni (credenziali)
    res = client.post("/api/connections", headers=steward_headers, json={
        "name": "x", "db_type": "sqlite", "host": "h", "port": 0,
        "database": "d", "username": "u", "password": "p",
    })
    assert res.status_code == 403
    # niente gestione warehouse (operazioni)
    wh = client.post("/api/warehouse/from-report", headers=steward_headers,
                     json={"report_id": report_ctx["report_id"]})
    assert wh.status_code == 403


def test_plain_user_cannot_edit_semantics(client, auth_headers, report_ctx):
    _create_user(client, auth_headers, "plain_user", "user")
    uh = _login(client, "plain_user")
    res = client.post(f"/api/semantic/reports/{report_ctx['report_id']}/autodetect", headers=uh)
    assert res.status_code == 403


def test_admin_cannot_create_steward(client, auth_headers):
    # crea un admin, poi l'admin prova a creare un data_steward -> 403
    _create_user(client, auth_headers, "admin_user", "admin")
    ah = _login(client, "admin_user")
    res = client.post("/api/users", headers=ah, json={
        "username": "steward_by_admin", "password": "Stew0rd++pwd", "role": "data_steward",
    })
    assert res.status_code == 403
