"""Test validazione query report (Fase 2.7a)."""
import pytest

from app.services.sql_validation import validate_select_query


def test_valid_select_passes():
    validate_select_query("SELECT a, b FROM tabella WHERE a > 0")


def test_cte_with_passes():
    validate_select_query("WITH x AS (SELECT 1 AS n) SELECT n FROM x")


def test_trailing_semicolon_allowed():
    validate_select_query("SELECT 1;")


def test_comment_hidden_statement_is_inert():
    # Il DDL è dentro un commento -> rimosso -> query valida
    validate_select_query("SELECT 1 -- DROP TABLE x")


@pytest.mark.parametrize("q", [
    "INSERT INTO t VALUES (1)",
    "UPDATE t SET a=1",
    "DELETE FROM t",
    "DROP TABLE t",
    "ALTER TABLE t ADD c INT",
    "SELECT * INTO new_t FROM t",
])
def test_forbidden_statements_raise(q):
    with pytest.raises(ValueError):
        validate_select_query(q)


def test_multiple_statements_raise():
    with pytest.raises(ValueError):
        validate_select_query("SELECT 1; DROP TABLE t")


def test_empty_raises():
    with pytest.raises(ValueError):
        validate_select_query("   ")


# --- Integrazione: la validazione gira PRIMA del controllo connessione ---

def test_create_report_rejects_forbidden_query(client, auth_headers):
    res = client.post("/api/reports", json={
        "name": "Cattivo", "connection_id": 999,
        "query": "DROP TABLE clienti",
    }, headers=auth_headers)
    assert res.status_code == 400
    # respinto dalla VALIDAZIONE (prima del controllo connessione)
    assert "connection" not in res.json()["detail"].lower()


def test_create_report_valid_query_reaches_connection_check(client, auth_headers):
    res = client.post("/api/reports", json={
        "name": "Buono", "connection_id": 999,  # connessione inesistente
        "query": "SELECT 1 AS n",
    }, headers=auth_headers)
    # query valida -> passa la validazione -> fallisce sul controllo connessione
    assert res.status_code == 400
    assert "connection" in res.json()["detail"].lower()
