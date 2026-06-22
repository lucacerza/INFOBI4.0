"""Test Row-Level Security (Fase 2.6)."""
import asyncio
from types import SimpleNamespace

from app.services.rls import rules_to_filters, merge_rls, get_rls_filters


def _rule(column, values):
    return SimpleNamespace(column=column, allowed_values=values)


def test_rules_to_filters_single():
    f = rules_to_filters([_rule("regione", ["Nord", "Centro"])])
    assert f == {"regione": {"type": "in", "values": ["Nord", "Centro"]}}


def test_rules_to_filters_union_same_column():
    f = rules_to_filters([_rule("regione", ["Nord"]), _rule("regione", ["Nord", "Sud"])])
    assert f["regione"]["type"] == "in"
    assert f["regione"]["values"] == ["Nord", "Sud"]  # union senza duplicati


def test_merge_rls_overrides_user_filter():
    user_filters = {"regione": {"type": "in", "values": ["Tutte"]}, "anno": {"type": "equals", "value": 2026}}
    rls = {"regione": {"type": "in", "values": ["Nord"]}}
    merged = merge_rls(user_filters, rls)
    assert merged["regione"]["values"] == ["Nord"]   # RLS obbligatorio, ha la precedenza
    assert merged["anno"]["value"] == 2026            # filtro utente non-RLS preservato


def test_superuser_bypass_no_db_access():
    user = SimpleNamespace(role="superuser", username="root")
    # Per il superuser ritorna {} senza toccare il db (db=None)
    assert asyncio.run(get_rls_filters(None, user, 1)) == {}


def test_rls_crud(client, auth_headers):
    # Crea regola
    res = client.post("/api/rls", json={
        "report_id": 1, "subject_type": "role", "subject": "user",
        "column": "regione", "allowed_values": ["Nord"],
    }, headers=auth_headers)
    assert res.status_code in (200, 201), res.text
    rule_id = res.json()["id"]

    # Lista (filtrata per report)
    res = client.get("/api/rls?report_id=1", headers=auth_headers)
    assert res.status_code == 200
    assert any(r["id"] == rule_id and r["column"] == "regione" for r in res.json())

    # Elimina
    res = client.delete(f"/api/rls/{rule_id}", headers=auth_headers)
    assert res.status_code == 200


def test_rls_requires_auth(client):
    assert client.get("/api/rls").status_code in (401, 403)
