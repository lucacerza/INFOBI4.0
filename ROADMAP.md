# INFOBI 4.0 - Roadmap Ufficiale

> **Versione:** 2.0
> **Data:** 28 Gennaio 2026
> **Obiettivo:** BI pratica, efficiente, self-hosted

---

## Vision

**"La BI semplice e veloce per chi non vuole complessità."**

- Self-hosted (dati tuoi)
- Nessun costo per utente
- SQL-first (se sai SQL, sai usare INFOBI)
- Performance enterprise (Arrow + Polars + Cache)

---

## Stato Attuale

### Funzionante
- [x] Autenticazione JWT + Ruoli (Superuser/Admin/User)
- [x] Multi-database (MSSQL, PostgreSQL, MySQL)
- [x] Connection pooling con warm-up
- [x] TreeDataGrid con virtualizzazione e drill-down gerarchico
- [x] BiChart con ECharts (bar, line, pie, area, kpi, horizontal-bar)
- [x] BiGridConfig per configurazione pivot drag & drop
- [x] Caching Redis/Dragonfly
- [x] Export Excel/CSV
- [x] Dashboard con widget multipli

### Problemi Identificati (da Analisi Codice)
- [ ] SQL Injection in `pivot.py` linee 254-259 (CRITICO)
- [ ] 45 console.log in produzione (performance)
- [ ] Drill-down è solo un alert placeholder
- [ ] Widget type toggle non persistito
- [ ] Error handling silenzioso (no feedback utente)
- [ ] Valori hardcoded sparsi nel codice
- [ ] Feature Delta disabilitata

---

## FASE 0: Bug Fix & Stabilizzazione
> **Priorità:** CRITICA
> **Durata:** 1 settimana
> **Obiettivo:** Codice stabile e sicuro

### 0.1 Fix SQL Injection (URGENTE)
**File:** `backend/app/api/pivot.py` linee 254-259

```python
# PROBLEMA ATTUALE:
if filter_def.get('type') == 'contains':
    conditions.append(f"{col} LIKE '%{filter_def['value']}%'")  # PERICOLOSO!

# SOLUZIONE:
if filter_def.get('type') == 'contains':
    param_name = f"filter_{len(params)}"
    conditions.append(f"{col} LIKE :{param_name}")
    params[param_name] = f"%{filter_def['value']}%"
```

| Task | File | Effort |
|------|------|--------|
| Sanitizzare filtri in pivot.py | `backend/app/api/pivot.py` | 2h |
| Sanitizzare filtri in query_engine.py | `backend/app/services/query_engine.py` | 4h |
| Test regressione query esistenti | - | 2h |

### 0.2 Rimuovere Console.log Produzione
**File:** Multipli frontend

| Task | File | Effort |
|------|------|--------|
| Rimuovere/condizionare 45 console.log | `BiChart.tsx`, `BiGrid.tsx`, `ReportEditorPage.tsx`, `ReportPivotPage.tsx` | 1h |
| Aggiungere utility logger condizionale | `frontend/src/utils/logger.ts` (nuovo) | 30min |

```typescript
// frontend/src/utils/logger.ts
export const logger = {
  debug: (...args: any[]) => {
    if (import.meta.env.DEV) console.log(...args);
  },
  error: console.error  // sempre attivo
};
```

### 0.3 Error Handling con Feedback Utente
**File:** `DashboardViewerPage.tsx` e altri

| Task | File | Effort |
|------|------|--------|
| Aggiungere toast/snackbar component | `frontend/src/components/Toast.tsx` (nuovo) | 2h |
| Sostituire console.error con toast | `DashboardViewerPage.tsx`, `BiChart.tsx` | 1h |

### 0.4 Costanti e Configurazione
**File:** Nuovo file

| Task | File | Effort |
|------|------|--------|
| Creare file costanti | `frontend/src/constants.ts` | 1h |
| Spostare valori hardcoded | Multipli | 1h |

```typescript
// frontend/src/constants.ts
export const CONFIG = {
  AUTH_TOKEN_KEY: 'infobi_token',
  DEFAULT_CHART_HEIGHT: 400,
  DEFAULT_TOP_N: 50,
  CHART_ROTATE_THRESHOLD: 5,
  CHART_ZOOM_THRESHOLD: 8,
  LABEL_MAX_LENGTH: 10,
};
```

**Totale Fase 0:** ~2 giorni

---

## FASE 1: Completare Feature Esistenti
> **Priorità:** ALTA
> **Durata:** 1-2 settimane
> **Obiettivo:** Tutto quello che c'è deve funzionare al 100%

### 1.1 Drill-Down Funzionante
**File:** `DashboardViewerPage.tsx` linea 398

**Attuale:**
```typescript
// TODO: Implement proper drill-down (filter or navigate)
alert(`Drill-down: ${category}\n${seriesName}: ${value.toLocaleString('it-IT')}`);
```

**Implementazione:**
```typescript
onDrillDown={(category, value, seriesName) => {
  // Opzione A: Filtra lo stesso report
  const newFilters = { ...currentFilters, [groupByField]: category };
  setWidgetFilters(widget.id, newFilters);

  // Opzione B: Mostra dettaglio in modal
  setDetailModal({ category, reportId: widget.report_id });
}}
```

| Task | Descrizione | Effort |
|------|-------------|--------|
| Aggiungere stato filtri per widget | `dashboardStore.ts` | 2h |
| Implementare filtro su click | `DashboardViewerPage.tsx` | 3h |
| TreeDataGrid riceve filtri esterni | `TreeDataGrid.tsx` | 2h |
| BiChart riceve filtri esterni | `BiChart.tsx` | 1h |

### 1.2 Persistere Widget Type Toggle
**File:** `DashboardViewerPage.tsx` linee 209-219

| Task | Descrizione | Effort |
|------|-------------|--------|
| Endpoint PUT /widgets/{id} per type | `backend/app/api/dashboards.py` | 1h |
| Chiamare endpoint su toggle | `DashboardViewerPage.tsx` | 30min |

### 1.3 Decidere Feature Delta
**File:** `backend/app/api/pivot.py` linee 359-390

La feature è implementata ma disabilitata (`if False and ...`).

**Decisione necessaria:**
- [ ] Abilitare e testare
- [ ] Rimuovere codice morto

| Task | Descrizione | Effort |
|------|-------------|--------|
| Testare feature Delta | - | 2h |
| Abilitare o rimuovere | `pivot.py` | 1h |

### 1.4 Type Safety
**File:** `DashboardViewerPage.tsx` e altri

| Task | Descrizione | Effort |
|------|-------------|--------|
| Definire interface Widget, Report | `frontend/src/types/index.ts` | 1h |
| Sostituire `any` con tipi corretti | Multipli | 2h |

**Totale Fase 1:** ~5-7 giorni

---

## FASE 2: Slicers e Filtri Dashboard
> **Priorità:** ALTA
> **Durata:** 2 settimane
> **Obiettivo:** Filtri visivi per report singoli

### 2.1 Componenti Slicer

**Nuovi componenti da creare:**

#### DateRangeSlicer
```
┌─────────────────────────────────────┐
│ 📅 Periodo                          │
│ [01/01/2025] - [31/12/2025]         │
│ [Oggi] [Settimana] [Mese] [Anno]    │
└─────────────────────────────────────┘
```

| Task | File | Effort |
|------|------|--------|
| Componente DateRangeSlicer | `frontend/src/components/slicers/DateRangeSlicer.tsx` | 4h |
| Integrazione con date picker | - | 2h |

#### ListSlicer
```
┌─────────────────────────────────────┐
│ ☑ Regioni                           │
│ [Cerca...]                          │
│ ☑ Nord                              │
│ ☑ Sud                               │
│ ☐ Est                               │
│ ☐ Ovest                             │
│ [Seleziona tutti] [Deseleziona]     │
└─────────────────────────────────────┘
```

| Task | File | Effort |
|------|------|--------|
| Componente ListSlicer | `frontend/src/components/slicers/ListSlicer.tsx` | 4h |
| Ricerca e selezione multipla | - | 2h |

#### DropdownSlicer
```
┌─────────────────────────────────────┐
│ 🔽 Categoria                        │
│ [Elettronica              ▼]        │
└─────────────────────────────────────┘
```

| Task | File | Effort |
|------|------|--------|
| Componente DropdownSlicer | `frontend/src/components/slicers/DropdownSlicer.tsx` | 2h |

### 2.2 Backend: Valori Distinti per Slicer

**Nuovo endpoint:**
```python
# backend/app/api/pivot.py

@router.get("/{report_id}/distinct/{column}")
async def get_distinct_values(
    report_id: int,
    column: str,
    limit: int = 1000,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    """Restituisce valori distinti di una colonna per popolare slicer"""
    # SELECT DISTINCT {column} FROM ({base_query}) LIMIT {limit}
    pass
```

| Task | File | Effort |
|------|------|--------|
| Endpoint distinct values | `backend/app/api/pivot.py` | 3h |
| Caching valori distinti | `backend/app/services/cache.py` | 1h |

### 2.3 Integrazione Dashboard

| Task | File | Effort |
|------|------|--------|
| Widget type "slicer" nel DB | `backend/app/db/database.py` | 30min |
| Rendering slicer in dashboard | `DashboardViewerPage.tsx` | 3h |
| Slicers filtrano widget stesso report | `dashboardStore.ts` | 2h |

### 2.4 Logica Filtri per Report

```typescript
// stores/dashboardStore.ts

interface DashboardState {
  // Filtri organizzati per report_id
  filtersByReport: Record<number, Record<string, FilterValue>>;

  setFilter: (reportId: number, field: string, value: FilterValue) => void;
  getFiltersForReport: (reportId: number) => Record<string, FilterValue>;
  clearFiltersForReport: (reportId: number) => void;
}
```

**Widget dello stesso report condividono i filtri. Widget di report diversi sono indipendenti.**

| Task | File | Effort |
|------|------|--------|
| Refactor dashboardStore per filtri per report | `dashboardStore.ts` | 3h |
| Widget passano reportId ai filtri | `DashboardViewerPage.tsx` | 2h |

**Totale Fase 2:** ~10-12 giorni

---

## FASE 3: Layout Dashboard Flessibile
> **Priorità:** MEDIA
> **Durata:** 1-2 settimane
> **Obiettivo:** Drag & drop e resize widget

### 3.1 Installazione react-grid-layout

```bash
cd frontend
npm install react-grid-layout
npm install @types/react-grid-layout --save-dev
```

### 3.2 Integrazione Layout

| Task | File | Effort |
|------|------|--------|
| Wrappare widget in GridLayout | `DashboardViewerPage.tsx` | 4h |
| Salvare layout su drag/resize | `DashboardViewerPage.tsx` | 2h |
| Endpoint salvataggio layout | `backend/app/api/dashboards.py` | 2h |
| Caricare layout salvato | `DashboardViewerPage.tsx` | 1h |

### 3.3 Modello Dati Layout

Il modello `DashboardWidget` ha già `position` (JSON). Usare per x, y, w, h:

```python
# Già esiste, verificare struttura
class DashboardWidget(Base):
    position = Column(JSON)  # {"x": 0, "y": 0, "w": 6, "h": 4}
```

### 3.4 UI Controlli

| Task | File | Effort |
|------|------|--------|
| Bottone "Modifica Layout" | `DashboardViewerPage.tsx` | 1h |
| Bottone "Blocca Layout" | `DashboardViewerPage.tsx` | 30min |
| Resize handles visibili in edit mode | CSS | 1h |

**Totale Fase 3:** ~7-10 giorni

---

## FASE 4: Drill-Through tra Report
> **Priorità:** MEDIA
> **Durata:** 1-2 settimane
> **Obiettivo:** Navigazione da riepilogo a dettaglio

### 4.1 Configurazione Drill-Through

**Nuovo campo nel Report:**
```python
# backend/app/db/database.py

class Report(Base):
    # ... campi esistenti ...
    drillthrough_config = Column(JSON)
    # Esempio: [{"targetReportId": 5, "label": "Vai a dettaglio", "mappings": {"agente": "agente"}}]
```

### 4.2 UI Configurazione

| Task | File | Effort |
|------|------|--------|
| Sezione drill-through in ReportEditorPage | `ReportEditorPage.tsx` | 4h |
| Selezione report target | - | 2h |
| Mapping campi (source → target) | - | 3h |

### 4.3 Context Menu

| Task | File | Effort |
|------|------|--------|
| Context menu su TreeDataGrid | `TreeDataGrid.tsx` | 3h |
| Context menu su BiChart | `BiChart.tsx` | 2h |
| Opzione "Vai a {report target}" | - | 1h |

### 4.4 Navigazione con Filtri

| Task | File | Effort |
|------|------|--------|
| Navigare a report con query params | `DashboardViewerPage.tsx` | 2h |
| Report target legge filtri da URL | `ReportPivotPage.tsx` | 2h |
| Breadcrumb navigazione | `components/Breadcrumb.tsx` (nuovo) | 2h |

**Totale Fase 4:** ~8-10 giorni

---

## FASE 5: AI Assistant
> **Priorità:** MEDIA
> **Durata:** 2 settimane
> **Obiettivo:** Query in linguaggio naturale

### 5.1 Backend AI

**Nuovo file:** `backend/app/api/ai.py`

```python
from anthropic import Anthropic

router = APIRouter(prefix="/ai", tags=["ai"])

class AIRequest(BaseModel):
    question: str
    report_id: int

class AIResponse(BaseModel):
    pivot_config: dict
    explanation: str
    sql_hint: Optional[str]

@router.post("/ask", response_model=AIResponse)
async def ai_ask(
    request: AIRequest,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_user)
):
    # 1. Carica schema report
    schema = await get_report_schema(request.report_id)

    # 2. Chiedi a Claude
    client = Anthropic()
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system="""Sei un assistente BI. Dato lo schema delle colonne,
        genera una configurazione pivot JSON valida.
        Rispondi SOLO con JSON valido, nessun testo extra.""",
        messages=[{
            "role": "user",
            "content": f"Schema colonne: {schema}\n\nDomanda utente: {request.question}"
        }]
    )

    # 3. Parsa risposta
    config = json.loads(response.content[0].text)

    return AIResponse(
        pivot_config=config,
        explanation=f"Ho configurato: {config.get('rows', [])} per righe, {config.get('values', [])} per valori",
        sql_hint=None
    )
```

| Task | File | Effort |
|------|------|--------|
| Installare anthropic SDK | `backend/requirements.txt` | 10min |
| Endpoint /ai/ask | `backend/app/api/ai.py` | 4h |
| Prompt engineering | - | 4h |
| Gestione errori API | - | 2h |

### 5.2 Frontend Chat

**Nuovo componente:** `frontend/src/components/AIChat.tsx`

```
┌─────────────────────────────────────┐
│ 🤖 Assistente BI                    │
├─────────────────────────────────────┤
│                                     │
│ Tu: Mostrami vendite per regione    │
│                                     │
│ AI: Ho configurato il pivot con:    │
│     • Righe: regione                │
│     • Valori: SUM(venduto)          │
│                                     │
│     [Applica]  [Modifica]           │
│                                     │
├─────────────────────────────────────┤
│ [Scrivi una domanda...]      [Invia]│
└─────────────────────────────────────┘
```

| Task | File | Effort |
|------|------|--------|
| Componente AIChat | `frontend/src/components/AIChat.tsx` | 6h |
| Integrazione in ReportPivotPage | `ReportPivotPage.tsx` | 2h |
| Bottone "Applica configurazione" | - | 2h |
| Suggerimenti domande frequenti | - | 1h |

### 5.3 Prompt Engineering

Esempi da gestire:

| Input Utente | Output Atteso |
|--------------|---------------|
| "Vendite per regione" | `{rows: ["regione"], values: [{field: "venduto", agg: "SUM"}]}` |
| "Top 10 clienti per fatturato" | `{rows: ["cliente"], values: [{field: "fatturato", agg: "SUM"}], orderBy: [{field: "fatturato", dir: "desc"}], limit: 10}` |
| "Margine per prodotto" | `{rows: ["prodotto"], values: [{field: "margine", type: "margin"}]}` |
| "Confronta 2024 vs 2025" | `{rows: ["cliente"], columns: ["anno"], values: [...]}` |

| Task | Effort |
|------|--------|
| Definire 20+ esempi di prompt | 4h |
| Testare e raffinare | 4h |

**Totale Fase 5:** ~10-12 giorni

---

## FASE 6: Rifinitura e Performance
> **Priorità:** BASSA
> **Durata:** 1 settimana
> **Obiettivo:** Polish finale

### 6.1 UI/UX Miglioramenti

| Task | Effort |
|------|--------|
| Loading skeleton migliorati | 2h |
| Animazioni transizione | 2h |
| Empty states informativi | 2h |
| Tooltip contestuali | 2h |

### 6.2 Performance

| Task | Effort |
|------|--------|
| Lazy loading componenti pesanti | 3h |
| Memoizzazione render costosi | 2h |
| Bundle size optimization | 2h |

### 6.3 Dark Mode (Opzionale)

| Task | Effort |
|------|--------|
| TailwindCSS dark variant | 2h |
| ECharts tema dark | 1h |
| Persistenza preferenza | 30min |

**Totale Fase 6:** ~5 giorni

---

## FASE 7: Enterprise (Futuro)
> **Priorità:** BASSA
> **Durata:** 4+ settimane
> **Obiettivo:** Feature per deployment aziendale

### 7.1 Scheduled Refresh
- Scheduler backend (APScheduler)
- Config frequenza per report
- Log esecuzioni

### 7.2 Alerting
- Regole threshold
- Notifiche email
- Webhook (Slack/Teams)

### 7.3 Audit Log
- Log accessi
- Log modifiche
- Export per compliance

### 7.4 Multi-tenant (Se necessario)
- Isolamento dati per organizzazione
- Branding personalizzato

---

## Timeline Complessiva

```
Settimana 1:     FASE 0 - Bug Fix & Stabilizzazione
                 ████████████████████████████████████

Settimane 2-3:   FASE 1 - Completare Feature Esistenti
                 ████████████████████████████████████████████████

Settimane 4-5:   FASE 2 - Slicers e Filtri
                 ████████████████████████████████████████████████

Settimane 6-7:   FASE 3 - Layout Flessibile
                 ████████████████████████████████████████

Settimane 8-9:   FASE 4 - Drill-Through
                 ████████████████████████████████████████

Settimane 10-11: FASE 5 - AI Assistant
                 ████████████████████████████████████████████████

Settimana 12:    FASE 6 - Rifinitura
                 ████████████████████████████████████

TOTALE: ~12 settimane (3 mesi)
```

---

## Checklist Pre-Release

### Sicurezza
- [ ] SQL Injection fixato e testato
- [ ] Input validation su tutti gli endpoint
- [ ] Rate limiting su API sensibili
- [ ] CORS configurato correttamente

### Qualità Codice
- [ ] Zero console.log in produzione
- [ ] Error handling con feedback utente
- [ ] TypeScript strict mode (no `any`)
- [ ] Test unitari componenti critici

### Performance
- [ ] Lighthouse score > 80
- [ ] First Contentful Paint < 2s
- [ ] Time to Interactive < 4s
- [ ] Bundle size < 500KB (gzipped)

### Documentazione
- [ ] README aggiornato
- [ ] Guida installazione Docker
- [ ] Documentazione API (OpenAPI)
- [ ] Video demo

---

## File Modificati per Fase

| Fase | File Backend | File Frontend |
|------|--------------|---------------|
| 0 | `pivot.py`, `query_engine.py` | `BiChart.tsx`, `BiGrid.tsx`, `constants.ts` (nuovo), `Toast.tsx` (nuovo) |
| 1 | `dashboards.py` | `DashboardViewerPage.tsx`, `dashboardStore.ts`, `types/index.ts` |
| 2 | `pivot.py` | `slicers/*.tsx` (nuovi), `DashboardViewerPage.tsx`, `dashboardStore.ts` |
| 3 | `dashboards.py` | `DashboardViewerPage.tsx` |
| 4 | `database.py` | `ReportEditorPage.tsx`, `TreeDataGrid.tsx`, `BiChart.tsx`, `Breadcrumb.tsx` (nuovo) |
| 5 | `ai.py` (nuovo) | `AIChat.tsx` (nuovo), `ReportPivotPage.tsx` |
| 6 | - | Multipli |

---

## Come Iniziare

**Domani:**
1. Fix SQL Injection in `pivot.py` (2 ore)
2. Rimuovere console.log (1 ora)
3. Creare `constants.ts` (1 ora)

**Questa settimana:**
4. Completare Fase 0
5. Iniziare Fase 1 (drill-down funzionante)

---

## Note Finali

Questa roadmap è basata su:
- Analisi reale del codice esistente
- Problemi concreti identificati
- Feature che hanno senso per il modello INFOBI
- Effort realistici basati sulla complessità del codice

**Non include:**
- Cross-filtering stile Power BI (non si adatta al modello)
- Modello semantico con relazioni (troppo complesso)
- Feature che richiedono riscrittura architetturale

**Priorità chiara:**
1. Prima stabilità e sicurezza
2. Poi completare quello che c'è
3. Infine nuove feature

---

*Ultimo aggiornamento: 28 Gennaio 2026*
