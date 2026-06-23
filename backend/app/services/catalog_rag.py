"""
Chatbot sul catalogo (RAG leggero, senza vector DB).

Costruisce un corpus dai metadati (report + semantic layer), recupera i
documenti più pertinenti con uno scoring per termini e lascia rispondere
l'LLM SOLO su quel contesto (riduce le allucinazioni). Risponde a domande
tipo "quali report parlano di vendite?", "che misure ho?", "cosa è X?".
"""
import logging
import re
from typing import Any, Dict, List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import Report, ColumnMetadata
from app.services.llm.base import ResilientLLM

logger = logging.getLogger(__name__)

# stopword minime IT/EN per non sporcare lo scoring
_STOP = {
    "che", "chi", "cosa", "come", "quali", "quale", "dove", "per", "con", "del", "della",
    "dei", "delle", "una", "uno", "gli", "the", "and", "for", "what", "which", "are", "is",
    "di", "da", "in", "su", "il", "lo", "la", "le", "un", "mi", "ho", "sono", "c'è",
}

_SYSTEM = (
    "Sei un assistente che risponde a domande sul CATALOGO DATI (report, colonne, misure). "
    "Usa SOLO il contesto fornito; se l'informazione non c'è, dillo chiaramente. "
    "Cita i report pertinenti per nome. Rispondi in italiano, in modo conciso."
)


def _tokens(text: str) -> List[str]:
    return [t for t in re.split(r"[^0-9a-zàèéìòù]+", (text or "").lower()) if len(t) > 2 and t not in _STOP]


async def build_corpus(db: AsyncSession) -> List[Dict[str, Any]]:
    """Un documento per report: nome, descrizione e colonne (con metadati semantici)."""
    reports = list((await db.execute(select(Report).order_by(Report.id))).scalars().all())
    metas = list((await db.execute(select(ColumnMetadata))).scalars().all())
    by_report: Dict[int, List[ColumnMetadata]] = {}
    for m in metas:
        by_report.setdefault(m.report_id, []).append(m)

    corpus = []
    for r in reports:
        parts = [r.name or "", r.description or ""]
        for m in by_report.get(r.id, []):
            parts.append(" ".join(filter(None, [
                m.business_name, m.column_name, m.role, m.unit, m.description,
            ])))
        text = ". ".join(p for p in parts if p)
        corpus.append({"report_id": r.id, "name": r.name, "text": text, "tokens": set(_tokens(text))})
    return corpus


def retrieve(corpus: List[Dict[str, Any]], question: str, k: int = 5) -> List[Dict[str, Any]]:
    """Top-k documenti per numero di termini della domanda presenti nel documento."""
    q = set(_tokens(question))
    if not q:
        return []
    scored = []
    for doc in corpus:
        score = len(q & doc["tokens"])
        if score > 0:
            scored.append({**doc, "score": score})
    scored.sort(key=lambda d: (d["score"], -d["report_id"]), reverse=True)
    return scored[:k]


async def answer(db: AsyncSession, llm: ResilientLLM, question: str) -> Dict[str, Any]:
    """Risponde alla domanda usando i documenti di catalogo recuperati."""
    corpus = await build_corpus(db)
    hits = retrieve(corpus, question, k=5)

    if hits:
        context = "\n\n".join(f"Report «{h['name']}» (id {h['report_id']}):\n{h['text']}" for h in hits)
    else:
        context = "(nessun elemento di catalogo pertinente alla domanda)"

    res = await llm.generate(
        system=_SYSTEM,
        messages=[{"role": "user", "content": f"Domanda: {question}\n\nContesto catalogo:\n{context}"}],
        max_tokens=600,
        temperature=0.2,
    )
    return {
        "answer": (res.text or "").strip(),
        "sources": [{"report_id": h["report_id"], "name": h["name"], "score": h["score"]} for h in hits],
    }
