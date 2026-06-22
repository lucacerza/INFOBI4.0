"""
Test della classe "SQL injection" — verificano che i valori utente non
vengano MAI interpolati nella stringa SQL ma passati come bound params,
e che i nomi colonna vengano sanitizzati.

I test eseguono anche un payload di injection reale contro un DB SQLite
in-memory per dimostrare che viene trattato come dato letterale.
"""
import sqlalchemy as sa

from app.services.query_engine import _sanitize_column_name, _build_safe_filter_clause


INJECTION = "alice'); DROP TABLE t;--"


def test_sanitize_column_name_strips_dangerous_chars():
    out = _sanitize_column_name("col); DROP TABLE t;--")
    for ch in ['(', ')', ';', '-', "'", '"', '*', '=']:
        assert ch not in out, f"il carattere {ch!r} non deve sopravvivere alla sanitizzazione"


def test_equals_value_is_parameterized_not_interpolated():
    where_sql, params = _build_safe_filter_clause(
        {"name": {"type": "equals", "value": INJECTION}}, is_mssql=False
    )
    assert ":p0" in where_sql
    assert "DROP TABLE" not in where_sql          # il valore NON è nella SQL
    assert params["p0"] == INJECTION              # il valore è un bound param


def test_contains_uses_like_with_param():
    where_sql, params = _build_safe_filter_clause(
        {"name": {"type": "contains", "value": "abc"}}, is_mssql=False
    )
    assert "LIKE :p0" in where_sql
    assert params["p0"] == "%abc%"


def test_in_filter_all_values_parameterized():
    where_sql, params = _build_safe_filter_clause(
        {"cat": {"type": "in", "values": ["a", "b", "c"]}}, is_mssql=False
    )
    assert where_sql.count(":p") == 3
    assert set(params.values()) == {"a", "b", "c"}


def test_column_name_is_quoted_and_sanitized():
    where_sql, _ = _build_safe_filter_clause(
        {"na;me": {"type": "equals", "value": "x"}}, is_mssql=False
    )
    assert ";" not in where_sql                   # nome colonna sanitizzato


def test_injection_payload_is_neutralized_against_sqlite():
    """Prova end-to-end: il payload di injection deve essere un dato, non codice."""
    engine = sa.create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(sa.text("CREATE TABLE t (name TEXT)"))
        conn.execute(sa.text("INSERT INTO t (name) VALUES ('alice'), ('bob')"))

    where_sql, params = _build_safe_filter_clause(
        {"name": {"type": "equals", "value": INJECTION}}, is_mssql=False
    )
    query = f'SELECT * FROM t {where_sql}'

    with engine.connect() as conn:
        rows = conn.execute(sa.text(query), params).fetchall()
        # il payload non corrisponde a nessuna riga: trattato come stringa letterale
        assert rows == []
        # e soprattutto: la tabella esiste ancora (nessun DROP eseguito)
        count = conn.execute(sa.text("SELECT COUNT(*) FROM t")).scalar()
        assert count == 2
