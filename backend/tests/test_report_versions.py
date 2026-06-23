"""Test versioning report (Fase 2.7b)."""
from types import SimpleNamespace

from app.services.report_versions import snapshot_of, apply_snapshot, SNAPSHOT_FIELDS


def test_snapshot_of_captures_fields():
    report = SimpleNamespace(name="R", description="d", query="SELECT 1",
                             columns_config=[], perspective_config={},
                             default_group_by=[], default_metrics=[], available_metrics=[],
                             column_labels={}, extra="ignorato")
    snap = snapshot_of(report)
    assert set(snap.keys()) == set(SNAPSHOT_FIELDS)
    assert snap["query"] == "SELECT 1"
    assert "extra" not in snap


def test_apply_snapshot_sets_only_known_fields():
    report = SimpleNamespace(query="OLD", name="N", description=None,
                             columns_config=None, perspective_config=None,
                             default_group_by=None, default_metrics=None,
                             available_metrics=None, column_labels=None)
    apply_snapshot(report, {"query": "NEW", "sconosciuto": "x"})
    assert report.query == "NEW"
    assert not hasattr(report, "sconosciuto")


def _create_connection(client, headers):
    res = client.post("/api/connections", json={
        "name": "conn-test", "db_type": "postgresql", "host": "localhost",
        "port": 5432, "database": "db", "username": "u", "password": "p", "ssl_enabled": False,
    }, headers=headers)
    assert res.status_code in (200, 201), res.text
    return res.json()["id"]


def test_report_versioning_flow(client, auth_headers):
    conn_id = _create_connection(client, auth_headers)

    # Crea report
    res = client.post("/api/reports", json={
        "name": "Report v", "connection_id": conn_id, "query": "SELECT 1 AS a",
    }, headers=auth_headers)
    assert res.status_code in (200, 201), res.text
    rid = res.json()["id"]

    # Aggiorna la query -> versiona lo stato OLD
    res = client.put(f"/api/reports/{rid}", json={"query": "SELECT 2 AS b"}, headers=auth_headers)
    assert res.status_code == 200, res.text
    assert res.json()["query"] == "SELECT 2 AS b"

    # Elenco versioni: deve contenere lo stato precedente
    res = client.get(f"/api/reports/{rid}/versions", headers=auth_headers)
    assert res.status_code == 200, res.text
    versions = res.json()
    assert len(versions) >= 1
    old = versions[0]
    assert old["snapshot"]["query"] == "SELECT 1 AS a"

    # Ripristino: la query torna a quella vecchia
    res = client.post(f"/api/reports/{rid}/versions/{old['id']}/restore", headers=auth_headers)
    assert res.status_code == 200, res.text
    assert res.json()["query"] == "SELECT 1 AS a"
