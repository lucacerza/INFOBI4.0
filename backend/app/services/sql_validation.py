"""
Validazione statica delle query dei report: sono ammesse solo SELECT (o CTE WITH)
di sola lettura. Blocca DDL/DML e statement multipli. Guard conservativo
(non sostituisce i permessi del DB, ma previene errori e usi impropri).
"""
import re

# Parole chiave non consentite in una query di sola lettura
FORBIDDEN_KEYWORDS = {
    "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "TRUNCATE",
    "EXEC", "EXECUTE", "MERGE", "GRANT", "REVOKE", "INTO", "REPLACE",
    "ATTACH", "DETACH", "PRAGMA", "CALL",
}


def _strip_comments(sql: str) -> str:
    """Rimuove i commenti SQL (-- ... e /* ... */) per evitare aggiramenti."""
    sql = re.sub(r"--[^\n]*", " ", sql)
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.S)
    return sql


def validate_select_query(query: str) -> None:
    """
    Solleva ValueError con messaggio chiaro se la query non è una SELECT/CTE
    sicura di sola lettura. Non ritorna nulla se è valida.
    """
    if not query or not query.strip():
        raise ValueError("La query è vuota")

    clean = _strip_comments(query).strip()

    # Niente statement multipli (un solo ';' finale è tollerato)
    body = clean.rstrip().rstrip(";").rstrip()
    if ";" in body:
        raise ValueError("Statement multipli non consentiti: usa una sola query SELECT")

    upper = body.upper()
    if not (upper.startswith("SELECT") or upper.startswith("WITH")):
        raise ValueError("Sono consentite solo query SELECT (o WITH ... SELECT)")

    # Parole chiave vietate (confine di parola; lo snake_case resta unito)
    tokens = set(re.findall(r"[A-Za-z_]+", upper))
    found = tokens & FORBIDDEN_KEYWORDS
    if found:
        raise ValueError(f"Parole chiave non consentite nella query: {', '.join(sorted(found))}")
