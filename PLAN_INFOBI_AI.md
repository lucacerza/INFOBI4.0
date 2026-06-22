# INFOBI_AI — Piano di lavoro

> Contratto operativo. Si lavora **un passo alla volta**, con verifica e commit a fine di ogni step.
> Non si aggiungono voci non presenti in questa scaletta senza accordo esplicito.
> Branch: `infobi-ai` · Backup pristino: `INFOBI4.0_BACKUP_2026-06-22`

## Fase 0 — Messa in sicurezza
- [x] Backup completo del progetto (esclusi node_modules/venv/__pycache__)
- [x] Branch di lavoro `infobi-ai`
- [x] Rimozione codice morto iniziale (connection_pool.py, BiGrid, VirtualizedBiGrid, SkeletonLoader, constants.ts, force_credentials.py)
- [ ] Rename cartella → `INFOBI_AI` (a fine lavori, fuori sessione)

## Fase 1 — Stabilità: bug confermati (FONDAMENTA, prima di tutto)
- [x] `connections.py`: import mancante di `settings` (crash test connessione)
- [x] `query_engine.py`: variabile `start` non definita nel ramo flat-table (crash pivot)
- [x] SQLi: chiusa l'intera classe (grid, havingModel, distinct search, identificatori pivot) + whitelist aggregazioni
- [x] Unificare formato filtri `FilterValue` vs `filterModel` (fix slicer: checkbox + "Seleziona tutti" + DropdownSlicer) — accessor unico `selectedValuesOf`/`getSelectedValues` + test vitest
- [x] Persistere `widget_type` (backend `WidgetUpdate` + toggle) — + test d'integrazione (harness DB isolato)

## Fase 2 — Sicurezza & pulizia
- [x] Separare `SECRET_KEY` → `JWT_SECRET` + `DATA_ENCRYPTION_KEY` (fallback backward-compatible); validazione `.env` all'avvio (rifiuto default in prod) + test
- [x] Rimuovere script orfani/backdoor: `reset_admin.py`, `check_db.py`, `fix_db.py`
- [x] Rimuovere dead code residuo: blocco Delta `if False` (pivot.py), alias inutili `deps.py`, `_execute_df_sync`/`get_column_values` (query_engine), schemi morti `schemas.py` (PivotRequest + Dashboard/Widget). NB: la 2ª `formatNumber` di BiChart era in realtà USATA (KPI) → mantenuta.
- [x] 2.8a: Client API unico `apiClient` (token + 401 + parsing errori) + `api.ts` riscritto su di esso (via fetch, niente axios) + test
- [ ] 2.8b: Migrare le ~28 `fetch()` grezze nei componenti su `apiClient`
- [x] Restringere gli `except Exception` larghi (loggare l'errore reale con traceback, no `except:` nudi) + logging strutturato (LOG_LEVEL) — Step 2.3a
- [x] Backup automatico di `data/infobi.db` — sqlite3 backup API + rotazione + scheduler APScheduler (configurabile) + test
- [x] Audit log — Step 2.3b: tabella `audit_log` + middleware (auto-audit di tutte le mutazioni CRUD) + login (successo/fallimento) + endpoint sola lettura superuser + test
- [x] Rate limiting (middleware in-memory, configurabile) + query cost guard (cap righe configurabile `MAX_ROWS_PREVIEW`, rimosso hardcoded 10000) + test
- [x] RLS 2.6a: infrastruttura (tabella `rls_rules` + servizio + CRUD superuser) + wiring sul path pivot principale (filtri parametrizzati, inclusi nella cache key) + test
- [x] RLS 2.6b: agganciati tutti i path dati (pivot-drill, grid, export, distinct-values) — copertura completa, filtri parametrizzati
- [x] 2.7a: Validazione SQL prima del salvataggio report (solo SELECT/CTE, blocco DDL/DML + statement multipli) + test
- [x] 2.7b: Versioning definizioni report — tabella `report_versions`, snapshot ad ogni update, endpoint list/restore (superuser) + test e2e

## Fase 3 — Test & CI (per rendere sicuri i passi successivi)
> Anticipata: i test si scrivono e si eseguono ad **ogni** step, non solo qui.
- [x] pytest backend — harness avviato (backend/tests/, `pytest.ini`, `requirements-dev.txt`); test SQL-safety + smoke. Da estendere per ogni nuova funzione.
- [x] vitest frontend — harness avviato (`npm test`); test dello store filtri. Da estendere per ogni nuova logica.
- [ ] CI minimale (GitHub Actions): `tsc --noEmit` + `pytest`

## Fase 4 — Design system / UI (qualità estetica)
- [ ] Design tokens (palette, scala tipografica, spacing) coerenti
- [ ] Dark mode reale (oggi solo sidebar)
- [ ] Responsive mobile vero (tabelle incluse)
- [ ] Componenti UI coerenti / rifiniti

## Fase 5 — Dashboard potenziate
- [ ] Layout vero con `react-grid-layout` (drag + resize) e persistenza (campo `layout`)
- [ ] Widget KPI Card (numero grande + delta + sparkline)
- [ ] Auto-refresh (campo `auto_refresh`/`refresh_interval` già esistente) + indicatore freschezza
- [ ] Filtro globale di dashboard cross-report + mapping campo→colonna per report
- [ ] Date range / time intelligence globale (relativo: ultimi 30gg, YTD, 2024 vs 2023)
- [ ] Batching/condivisione query tra widget dello stesso report
- [ ] Drill-down con breadcrumb visibile (risalita livelli)
- [ ] Cross-filtering bidirezionale (click widget → filtra altri)
- [ ] Snapshot/Export dashboard (PDF/PNG) + delivery schedulata (APScheduler)
- [ ] Export aggregato/pivot (oggi solo dati raw)
- [ ] Viste/preferiti personali per utente

## Fase 6 — Funzioni analitiche
- [ ] Colonne calcolate (espressioni utente → Polars: row-level, aggregate, window)
- [ ] Colonne Delta / Confronto (2024 vs 2023, %, running total) — reimplementare pulito (non il blocco `if False`)

## Fase 7 — Datawarehouse
- [ ] Catalogo schema per connessione (introspezione tabelle/colonne/tipi/relazioni) — base conoscitiva per l'AI
- [ ] Metadati semantici su report/colonne (nome business, descrizione, unità, formato, misura/dimensione, aggregazione default)
- [ ] DuckDB + Parquet, architettura medallion (bronze/silver/gold)
- [ ] ETL incrementale schedulato (APScheduler, watermark `updated_at`)
- [ ] Semantic layer (misure/dimensioni riusabili)
- [ ] Report/Dashboard "warehouse-backed" (interrogano DuckDB, non l'OLTP)
- [ ] Data lineage / freschezza per widget

## Fase 8 — AI (Claude)
- [ ] Guardrail & governance AI: whitelist metriche/colonne certificate; logging traduzioni NL→query; feedback loop utente (blocca allucinazioni e SQLi by-design)
- [ ] NL → Pivot (tool-use, config validata, non SQL grezzo)
- [ ] NL → generazione Dashboard (JSON widget)
- [ ] Auto-insight / narrazione su dati aggregati
- [ ] Anomaly detection + alert
- [ ] Forecasting (time-series)
- [ ] Chatbot sul catalogo (RAG sui metadati)

---

## Regole anti-sbandata
1. **Un solo step alla volta**, ben delimitato, con criterio di "done".
2. **Verifica dopo ogni step**: `tsc --noEmit` + import backend (+ test da Fase 3 in poi) + avvio app.
3. **Commit per step** sul branch `infobi-ai` (mai su `main`). Backup mai toccato.
4. **Niente refactor paralleli**: si rispetta l'ordine per dipendenze (bug → sicurezza → test → UI → dashboard → warehouse → AI).
5. **Questo file è il contratto**: nuove voci solo previo accordo.
6. **DB**: migrazioni reversibili; mai operazioni distruttive senza backup dello stato.
