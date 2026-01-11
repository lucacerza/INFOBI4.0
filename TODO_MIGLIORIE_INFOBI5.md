# 📋 TODO - Migliorie INFOBI 5.0

**Ultimo aggiornamento:** 8 Gennaio 2026  
**Obiettivo:** Rendere INFOBI 5.0 il meglio del meglio, performante con 1M+ righe  
**Stato:** 🔴 Da iniziare

---

## 📊 Requisiti Chiave
- ✅ Dataset fino a **1.000.000+ righe**
- ✅ Dashboard con **filtri cross-widget** importanti
- ✅ **Skeleton Loading** (righe ghost) invece di spinner
- ✅ Prendere il meglio di INFOBI 4.0 (BiGrid, Query Engine)

---

## 🚨 PRIORITÀ CRITICA (Performance 1M+ righe)

### [ ] 1. Virtualizzazione Avanzata
**Status:** 🔴 Da fare  
**Impatto:** Dataset 1M+ righe impossibili senza questo

**Cosa fare:**
- [ ] Implementare `@tanstack/react-virtual` per righe
- [ ] Implementare virtualizzazione orizzontale per colonne
- [ ] Renderizzare solo ~50 righe visibili alla volta
- [ ] Overscan di 10-20 righe per scroll fluido
- [ ] Buffer intelligente per scroll veloce

**Tecnica:** Windowing/Virtual Scrolling
```
Invece di: <div>{milleRighe.map(r => <Row />)}</div>
Fare: <VirtualList items={milleRighe} renderItem={Row} />
```

---

### [ ] 2. Lazy Loading Gerarchico con Paginazione Server-Side
**Status:** 🔴 Da fare  
**Impatto:** Riduce payload iniziale del 99%

**Cosa fare:**
- [ ] Caricare solo livello root (es. 50 categorie)
- [ ] Espansione on-demand per ogni nodo
- [ ] Grand Total come query separata
- [ ] Paginazione server-side per livelli piatti (100 righe per chunk)
- [ ] Infinite scroll per dati non gerarchici

**Flusso:**
```
1. Utente apre report → Carica 50 categorie top-level
2. Clicca su "Elettronica" → Carica 30 sottocategorie
3. Clicca su "Smartphone" → Carica 100 prodotti (paginati)
4. Scrolla → Carica altri 100 prodotti
```

---

### [ ] 3. Skeleton Loading (Righe Ghost)
**Status:** 🔴 Da fare  
**Impatto:** UX professionale, niente più spinner bloccanti

**Cosa fare:**
- [ ] Creare componente `SkeletonRow`
- [ ] Shimmer effect animato (pulse CSS)
- [ ] Mostrare N righe skeleton durante caricamento
- [ ] Transizione smooth da skeleton a dati reali
- [ ] Skeleton per header colonne durante resize

**Esempio visivo:**
```
Durante caricamento:
┌────────────────────────────────────┐
│ ████████████  │ ██████ │ ████████ │  ← shimmer animato
│ ██████████    │ ████   │ ██████   │
│ ████████████  │ ██████ │ ████████ │
└────────────────────────────────────┘

Dopo caricamento:
┌────────────────────────────────────┐
│ Elettronica   │ 45.000 │ 12.5%    │
│ Abbigliamento │ 32.000 │ 8.9%     │
│ Casa          │ 28.000 │ 7.8%     │
└────────────────────────────────────┘
```

---

## 🔥 PRIORITÀ ALTA (Funzionalità Core)

### [ ] 4. Dashboard Store con Filtri Cross-Widget
**Status:** 🔴 Da fare  
**Impatto:** Dashboard interattive stile Power BI

**Cosa fare:**
- [ ] Store Zustand centralizzato per filtri
- [ ] Click su riga pivot → filtra tutti i widget
- [ ] Breadcrumb dei filtri attivi
- [ ] Pulsante "Reset filtri"
- [ ] Persistenza filtri in URL (deep linking)

**Interazione:**
```
Utente clicca "Italia" nel Pivot A
    ↓
dashboardStore.setFilter('Paese', 'Italia')
    ↓
Pivot B, Chart C, KPI D si aggiornano automaticamente
```

---

### [ ] 5. Portare BiGrid da 4.0 a 5.0
**Status:** 🔴 Da fare  
**Impatto:** Componente pivot superiore

**Cosa fare:**
- [ ] Copiare `BiGrid.tsx` e `BiGrid.css`
- [ ] Adattare alle API di 5.0
- [ ] Integrare virtualizzazione
- [ ] Integrare skeleton loading
- [ ] Mantenere multi-level column hierarchy

---

### [ ] 6. Query Engine Ottimizzato per 1M+ righe
**Status:** 🔴 Da fare  
**Impatto:** Backend deve reggere il carico

**Cosa fare:**
- [ ] Streaming Arrow IPC (non caricare tutto in memoria)
- [ ] Query con OFFSET/FETCH per paginazione
- [ ] Indici suggeriti per query frequenti
- [ ] Connection pooling ottimizzato
- [ ] Query timeout configurabile
- [ ] Cancellazione query in corso

---

## ⚡ PRIORITÀ MEDIA (Ottimizzazioni)

### [ ] 7. Warmup Service Avanzato
**Status:** 🔴 Da fare  
**Impatto:** Zero cold start

**Cosa fare:**
- [ ] Pre-scaldare connessioni all'avvio
- [ ] Pre-caricare schema delle tabelle frequenti
- [ ] Health check periodico connessioni
- [ ] Reconnect automatico se connessione persa

---

### [ ] 8. Cache Intelligente Multi-Livello
**Status:** 🔴 Da fare  
**Impatto:** Query ripetute istantanee

**Cosa fare:**
- [ ] Cache L1: In-memory (risultati ultimi 5 minuti)
- [ ] Cache L2: Redis/Dragonfly (risultati fino a 1 ora)
- [ ] Invalidazione granulare per report
- [ ] Cache key basata su hash di query + filtri
- [ ] Prefetch intelligente (predici prossima espansione)

---

### [ ] 9. PivotBuilder Drag & Drop
**Status:** 🔴 Da fare  
**Impatto:** UX configurazione intuitiva

**Cosa fare:**
- [ ] Implementare con `@dnd-kit/core`
- [ ] Zone: Disponibili, Righe, Colonne, Valori
- [ ] Riordinamento drag dentro ogni zona
- [ ] Preview live durante drag
- [ ] Touch support per tablet

---

### [ ] 10. Export Ottimizzato per Grandi Dataset
**Status:** 🔴 Da fare  
**Impatto:** Export 1M righe senza crash

**Cosa fare:**
- [ ] Export streaming (non caricare tutto in RAM)
- [ ] Progress bar durante export
- [ ] Export in background con notifica
- [ ] Formati: XLSX, CSV, Parquet
- [ ] Limite configurabile per export

---

## 📱 PRIORITÀ BASSA (Nice to Have)

### [ ] 11. Ottimizzazioni Mobile/Touch
**Status:** 🔴 Da fare

- [ ] TouchSensor per drag & drop
- [ ] Gesture swipe per navigazione
- [ ] Layout responsive per tablet
- [ ] Pinch-to-zoom su pivot

---

### [ ] 12. Accessibilità (A11y)
**Status:** 🔴 Da fare

- [ ] Keyboard navigation completa
- [ ] Screen reader support
- [ ] Focus management
- [ ] Contrasto colori WCAG AA

---

### [ ] 13. Logging e Monitoring
**Status:** 🔴 Da fare

- [ ] Performance metrics (tempo query, render)
- [ ] Error tracking
- [ ] Usage analytics
- [ ] Dashboard admin con statistiche

---

## 📈 Progress Tracker

| Categoria | Completati | Totali | % |
|-----------|------------|--------|---|
| Critica | 0 | 3 | 0% |
| Alta | 0 | 3 | 0% |
| Media | 0 | 4 | 0% |
| Bassa | 0 | 3 | 0% |
| **TOTALE** | **0** | **13** | **0%** |

---

## 🎯 Piano di Implementazione Suggerito

### Sprint 1 (Settimana 1-2): Foundation
1. Virtualizzazione base
2. Skeleton Loading
3. Portare BiGrid

### Sprint 2 (Settimana 3): Data Loading
4. Lazy Loading Gerarchico
5. Query Engine ottimizzato

### Sprint 3 (Settimana 4): Interattività
6. Dashboard Store
7. Cache multi-livello

### Sprint 4 (Settimana 5): Polish
8. Warmup Service
9. PivotBuilder DnD
10. Export ottimizzato

---

## 📝 Note e Decisioni

### 8 Gennaio 2026
- Creata lista TODO iniziale
- Requisito confermato: 1M+ righe
- Dashboard cross-widget: IMPORTANTE
- Skeleton loading preferito a spinner
- Approccio: incrementale o refactoring, basta che funzioni

---

**Prossimo step:** Iniziare con Virtualizzazione + Skeleton Loading
