"""Fase 8.8 — Chatbot RAG sul catalogo."""
import sqlite3

import pytest

from app.services.catalog_rag import retrieve
from app.services.llm.base import ResilientLLM, LLMResponse
from app.services.llm.mock_provider import MockLLM


# ---------- Unit: retrieval ----------
def _doc(rid, name, tokens):
    return {"report_id": rid, "name": name, "text": " ".join(tokens), "tokens": set(tokens)}


def test_retrieve_ranks_relevant_doc():
    corpus = [
        _doc(1, "Vendite", ["vendite", "fatturato", "regione"]),
        _doc(2, "Magazzino", ["giacenza", "prodotto"]),
    ]
    hits = retrieve(corpus, "qual è il fatturato per regione")
    assert hits[0]["report_id"] == 1
    assert all(h["report_id"] != 2 for h in hits)   # nessun termine in comune


def test_retrieve_empty_on_no_terms():
    corpus = [_doc(1, "X", ["alpha", "beta"])]
    assert retrieve(corpus, "che cosa?") == []        # solo stopword


# ---------- E2E ----------
def _make_source(tmp_path, name, ddl, rows):
    src = tmp_path / f"{name}.db"
    conn = sqlite3.connect(str(src))
    conn.execute(ddl)
    table = ddl.split()[2]
    conn.executemany(f"INSERT INTO {table} VALUES ({','.join('?' * len(rows[0]))})", rows)
    conn.commit()
    conn.close()
    return src


def _setup(client, auth_headers, src, name, query):
    cid = client.post("/api/connections", headers=auth_headers, json={
        "name": f"src-{name}", "db_type": "sqlite", "host": "localhost", "port": 0,
        "database": str(src), "username": "x", "password": "x",
    }).json()["id"]
    rid = client.post("/api/reports", headers=auth_headers, json={
        "name": name, "connection_id": cid, "query": query,
    }).json()["id"]
    client.post(f"/api/semantic/reports/{rid}/autodetect", headers=auth_headers)
    return rid


def _patch_llm(monkeypatch, text):
    resp = LLMResponse(text=text)
    monkeypatch.setattr("app.services.llm.get_llm", lambda *a, **k: ResilientLLM(MockLLM(responses=[resp])))


def test_catalog_chat(client, auth_headers, tmp_path, monkeypatch):
    # token unici (la suite condivide il DB di sessione: evitiamo collisioni
    # con altri report che usano "fatturato"/"regione")
    s1 = _make_source(tmp_path, "vend", "CREATE TABLE vendite (zonaxq TEXT, ricavospeciale REAL)",
                      [("Nord", 100.0)])
    r1 = _setup(client, auth_headers, s1, "Report Ricavi Speciali",
                "SELECT zonaxq, ricavospeciale FROM vendite")

    _patch_llm(monkeypatch, "Il report contiene la misura ricavospeciale.")
    res = client.post("/api/ai/catalog/chat", headers=auth_headers,
                      json={"question": "dove trovo ricavospeciale per zonaxq?"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["answer"] == "Il report contiene la misura ricavospeciale."
    # solo il nostro report usa quei token -> è in cima alle fonti
    assert body["sources"][0]["report_id"] == r1


def test_catalog_chat_empty_question(client, auth_headers):
    res = client.post("/api/ai/catalog/chat", headers=auth_headers, json={"question": "  "})
    assert res.status_code == 400
