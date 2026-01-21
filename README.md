# INFOBI 4.0 - Business Intelligence Platform

Sistema di Business Intelligence self-hosted per analisi dati con pivot table avanzate, dashboard interattive e supporto multi-database.

---

## Indice

- [Quick Start](#quick-start)
- [Funzionalità](#funzionalità)
- [Architettura](#architettura)
- [Struttura Progetto](#struttura-progetto)
- [API Reference](#api-reference)
- [Configurazione Pivot Table](#configurazione-pivot-table)
- [Database Supportati](#database-supportati)
- [Cache e Performance](#cache-e-performance)
- [Sicurezza](#sicurezza)
- [Sviluppo Locale](#sviluppo-locale)
- [Variabili Ambiente](#variabili-ambiente)
- [Troubleshooting](#troubleshooting)

---

## Quick Start

### Requisiti
- Docker e Docker Compose
- 4GB RAM minimo (8GB consigliati)

### Avvio

```bash
# 1. Clona il repository
git clone <repository-url>
cd INFOBI4.0

# 2. Avvia i servizi
docker-compose up -d

# 3. Accedi all'applicazione
# URL: http://localhost:3000
# Username: admin
# Password: admin
```

### Servizi Esposti

| Servizio | Porta | Descrizione |
|----------|-------|-------------|
| Frontend | 3000 | Applicazione React |
| Backend API | 8001 | FastAPI REST API |
| Cache | 6379 | Dragonfly (Redis-compatible) |

---

## Funzionalità

### Gestione Connessioni Database
- Supporto **SQL Server**, **PostgreSQL**, **MySQL**
- Connection pooling con pre-warming automatico
- Test connessione prima del salvataggio
- Credenziali criptate (Fernet encryption)
- Monitoraggio stato pool connessioni

### Report e Query
- Editor SQL con syntax highlighting
- Test query prima del salvataggio
- Configurazione metadati colonne
- Cache risultati configurabile (TTL personalizzabile)
- Export XLSX e CSV

### Pivot Table (BiGrid)

La funzionalità principale di INFOBI 4.0 è il pivot table avanzato con:

#### Sezioni Configurazione (Drag & Drop)

| Sezione | Descrizione |
|---------|-------------|
| **Group By** | Raggruppamento righe (supporta multi-livello gerarchico) |
| **Split By** | Pivoting colonne (supporta multi-livello) |
| **Columns** | Metriche/valori da visualizzare con aggregazione |
| **Order By** | Ordinamento risultati (ASC/DESC) |
| **Filter By** | Filtri WHERE sui dati raw |
| **Having By** | Filtri su valori aggregati (clausola HAVING SQL) |

#### Aggregazioni Supportate

| Tipo Campo | Aggregazioni Disponibili |
|------------|-------------------------|
| Numerico | SUM, AVG, COUNT, MIN, MAX |
| Testo/Data | COUNT, MIN, MAX |

Le aggregazioni vengono filtrate automaticamente in base al tipo di campo.

#### Features Avanzate
- **Espansione/Collasso** righe raggruppate
- **Virtualizzazione** per dataset con milioni di righe
- **Calcolo margini** corretti a ogni livello (SQL ROLLUP)
- **Filtri multipli** sullo stesso campo
- **Auto-scroll** quando si aggiungono filtri

### Dashboard
- Layout widget drag & drop
- Multipli report per dashboard
- Auto-refresh configurabile
- Widget ridimensionabili e posizionabili

### Gestione Utenti
- Ruoli: `admin`, `editor`, `viewer`
- Assegnazione report/dashboard per utente
- Tracking ultimo accesso

---

## Architettura

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend                                 │
│                    React + TypeScript                           │
│              BiGrid (Custom Pivot Component)                    │
│                    Zustand State Management                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Arrow IPC (binary, zero-copy)
                              │ REST API (JSON)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Backend                                  │
│                    FastAPI + Python                             │
│              Polars (fast data processing)                      │
│              SQLAlchemy (connection pooling)                    │
└─────────────────────────────────────────────────────────────────┘
           │                              │
           │                              │
           ▼                              ▼
┌─────────────────────┐      ┌─────────────────────────────────────┐
│   Dragonfly Cache   │      │      External Databases             │
│  (Redis-compatible) │      │  SQL Server / PostgreSQL / MySQL    │
│     25x faster      │      │                                     │
└─────────────────────┘      └─────────────────────────────────────┘
```

### Flusso Dati Pivot

1. Utente configura pivot tramite drag & drop
2. Frontend invia configurazione a `/api/pivot/{id}`
3. Backend verifica cache (hash della configurazione)
4. Se cache miss:
   - Costruisce query SQL con GROUP BY / ROLLUP
   - Esegue via Polars (performance ottimale)
   - Applica pivoting colonne (split_by)
   - Serializza in Apache Arrow IPC
   - Salva in cache
5. Risposta al frontend con buffer Arrow binario
6. Frontend renderizza con virtualizzazione

---

## Struttura Progetto

```
INFOBI4.0/
├── backend/
│   ├── app/
│   │   ├── main.py                 # Entry point FastAPI
│   │   ├── api/
│   │   │   ├── auth.py             # Login, JWT
│   │   │   ├── connections.py      # CRUD connessioni DB
│   │   │   ├── reports.py          # CRUD report + grid/pivot
│   │   │   ├── pivot.py            # Aggregazioni pivot avanzate
│   │   │   ├── dashboards.py       # Gestione dashboard
│   │   │   ├── users.py            # User management
│   │   │   └── export.py           # Export XLSX/CSV
│   │   ├── core/
│   │   │   ├── config.py           # Settings applicazione
│   │   │   ├── security.py         # JWT, hashing, encryption
│   │   │   ├── deps.py             # Dipendenze FastAPI
│   │   │   └── engine_pool.py      # Connection pooling
│   │   ├── db/
│   │   │   └── database.py         # Modelli SQLAlchemy ORM
│   │   ├── models/
│   │   │   └── schemas.py          # Pydantic validation
│   │   └── services/
│   │       ├── query_engine.py     # Esecuzione query Polars/Arrow
│   │       └── cache.py            # Cache service Dragonfly
│   ├── requirements.txt
│   └── Dockerfile
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx                 # Router principale
│   │   ├── pages/
│   │   │   ├── LoginPage.tsx
│   │   │   ├── ConnectionsPage.tsx
│   │   │   ├── ReportsPage.tsx
│   │   │   ├── ReportEditorPage.tsx
│   │   │   ├── ReportViewerPage.tsx
│   │   │   ├── ReportPivotPage.tsx
│   │   │   ├── DashboardsPage.tsx
│   │   │   ├── DashboardViewerPage.tsx
│   │   │   └── UsersPage.tsx
│   │   ├── components/
│   │   │   ├── Layout.tsx          # Layout con sidebar
│   │   │   ├── BiGrid.tsx          # Pivot table component
│   │   │   ├── BiGridConfig.tsx    # Drag-drop configuratore
│   │   │   ├── TreeDataGrid.tsx    # Griglia gerarchica
│   │   │   └── VirtualizedBiGrid.tsx
│   │   ├── stores/
│   │   │   ├── authStore.ts        # Zustand auth state
│   │   │   └── dashboardStore.ts
│   │   └── services/
│   │       └── api.ts              # API client Axios
│   ├── package.json
│   └── Dockerfile
│
├── data/                           # SQLite database (auto-created)
├── docker-compose.yml
├── .env.example
├── README.md
└── ANALISI_FUNZIONALITA.md        # Analisi features future
```

---

## API Reference

### Autenticazione

| Endpoint | Metodo | Descrizione |
|----------|--------|-------------|
| `/api/auth/login` | POST | Login, ritorna JWT token |
| `/api/auth/me` | GET | Info utente corrente |

### Connessioni

| Endpoint | Metodo | Descrizione | Auth |
|----------|--------|-------------|------|
| `/api/connections` | GET | Lista connessioni | User |
| `/api/connections` | POST | Crea connessione | Admin |
| `/api/connections/{id}` | GET/PUT/DELETE | CRUD singola | Admin |
| `/api/connections/test-new` | POST | Test prima di salvare | User |
| `/api/connections/{id}/test` | POST | Test connessione salvata | User |
| `/api/connections/pool-status` | GET | Status pool connessioni | Admin |

### Report

| Endpoint | Metodo | Descrizione | Auth |
|----------|--------|-------------|------|
| `/api/reports` | GET | Lista report | User |
| `/api/reports` | POST | Crea report | Admin |
| `/api/reports/{id}` | GET/PUT/DELETE | CRUD singolo | Admin |
| `/api/reports/test-query` | POST | Test query SQL | User |
| `/api/reports/{id}/data` | GET | Raw data (Arrow IPC) | User |
| `/api/reports/{id}/grid` | POST | Grid con pagination | User |
| `/api/reports/{id}/pivot-drill` | POST | Pivot con drill-down | User |

### Pivot

| Endpoint | Metodo | Descrizione | Auth |
|----------|--------|-------------|------|
| `/api/pivot/{id}` | POST | Esegui pivot aggregation | User |
| `/api/pivot/{id}/schema` | GET | Schema colonne per builder | User |
| `/api/pivot/{id}/config` | GET/POST | Load/Save configurazione | User |

**Payload Pivot Request:**
```json
{
  "group_by": ["Anno", "Mese"],
  "split_by": ["Regione"],
  "metrics": [
    {"name": "Venduto", "field": "venduto", "aggregation": "SUM"},
    {"name": "Quantità", "field": "qta", "aggregation": "SUM"}
  ],
  "filters": {"anno": 2024},
  "sortModel": [{"colId": "Venduto", "sort": "desc"}],
  "havingModel": [
    {"field": "venduto", "aggregation": "sum", "type": "greaterThan", "value": 1000}
  ],
  "limit": 10000
}
```

### Dashboard

| Endpoint | Metodo | Descrizione | Auth |
|----------|--------|-------------|------|
| `/api/dashboards` | GET | Lista dashboard | User |
| `/api/dashboards` | POST | Crea dashboard | Admin |
| `/api/dashboards/{id}` | GET/DELETE | CRUD singola | Admin |
| `/api/dashboards/{id}/widgets` | POST | Aggiungi widget | Admin |

### Utenti

| Endpoint | Metodo | Descrizione | Auth |
|----------|--------|-------------|------|
| `/api/users` | GET | Lista utenti | Admin |
| `/api/users` | POST | Crea utente | Admin |
| `/api/users/{id}` | GET/PUT/DELETE | CRUD singolo | Admin |
| `/api/users/{id}/reports` | POST | Assegna report | Admin |
| `/api/users/me/reports` | GET | Miei report accessibili | User |

### Export

| Endpoint | Metodo | Descrizione |
|----------|--------|-------------|
| `/api/export/{id}/xlsx` | GET | Download Excel |
| `/api/export/{id}/csv` | GET | Download CSV |

---

## Configurazione Pivot Table

### BiGridConfig - Aree Drag & Drop

```
┌─────────────────────────────────────────┐
│ GROUP BY (Raggruppamento righe)         │
│ ┌─────────────────────────────────────┐ │
│ │ [Anno]  [Mese]  [Articolo]          │ │
│ └─────────────────────────────────────┘ │
├─────────────────────────────────────────┤
│ SPLIT BY (Pivoting colonne)             │
│ ┌─────────────────────────────────────┐ │
│ │ [Regione]                           │ │
│ └─────────────────────────────────────┘ │
├─────────────────────────────────────────┤
│ COLUMNS (Metriche)                      │
│ ┌─────────────────────────────────────┐ │
│ │ [Venduto] [SUM ▼]                   │ │
│ │ [Costo]   [SUM ▼]                   │ │
│ └─────────────────────────────────────┘ │
├─────────────────────────────────────────┤
│ ORDER BY (Ordinamento)                  │
│ ┌─────────────────────────────────────┐ │
│ │ [Venduto] [DESC]                    │ │
│ └─────────────────────────────────────┘ │
├─────────────────────────────────────────┤
│ FILTER BY (Filtri WHERE)                │
│ ┌─────────────────────────────────────┐ │
│ │ [Anno] [=] [2024]                   │ │
│ │ [Regione] [Contiene] [Nord]         │ │
│ └─────────────────────────────────────┘ │
├─────────────────────────────────────────┤
│ HAVING BY (Filtri su aggregati)         │
│ ┌─────────────────────────────────────┐ │
│ │ [Venduto] [SUM] [>] [1000]          │ │
│ └─────────────────────────────────────┘ │
├─────────────────────────────────────────┤
│ ALL COLUMNS (Colonne disponibili)       │
│ ┌─────────────────────────────────────┐ │
│ │ campo1  campo2  campo3  ...         │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### Operatori Filtro Disponibili

| Operatore | Simbolo | Descrizione |
|-----------|---------|-------------|
| contains | Contiene | Testo contiene valore |
| equals | = | Uguale |
| notEqual | ≠ | Diverso |
| greaterThan | > | Maggiore |
| greaterThanOrEqual | ≥ | Maggiore o uguale |
| lessThan | < | Minore |
| lessThanOrEqual | ≤ | Minore o uguale |
| startsWith | Inizia | Testo inizia con |
| endsWith | Finisce | Testo finisce con |

---

## Database Supportati

### SQL Server (mssql)
```json
{
  "db_type": "mssql",
  "host": "server.example.com",
  "port": 1433,
  "database": "MyDatabase",
  "username": "sa",
  "password": "password"
}
```

### PostgreSQL
```json
{
  "db_type": "postgresql",
  "host": "server.example.com",
  "port": 5432,
  "database": "mydb",
  "username": "postgres",
  "password": "password"
}
```

### MySQL
```json
{
  "db_type": "mysql",
  "host": "server.example.com",
  "port": 3306,
  "database": "mydb",
  "username": "root",
  "password": "password"
}
```

### Connection Pooling

Ogni connessione usa SQLAlchemy QueuePool:
- **pool_size**: 5 connessioni persistenti
- **max_overflow**: 10 connessioni aggiuntive
- **pool_recycle**: 3600s (riciclo per evitare timeout)
- **pool_pre_ping**: Test connessione prima dell'uso

---

## Cache e Performance

### Dragonfly Cache

INFOBI usa Dragonfly come cache backend (compatibile Redis, 25x più veloce):

```yaml
# docker-compose.yml
cache:
  image: docker.dragonflydb.io/dragonflydb/dragonfly
  command: ["--maxmemory", "2gb", "--proactor_threads", "4", "--cache_mode"]
```

### TTL (Time To Live)

| Tipo | TTL Default | Configurabile |
|------|-------------|---------------|
| Query result | 2 ore (7200s) | CACHE_TTL |
| Pivot result | 10 minuti (600s) | CACHE_TTL_PIVOT |

### Headers Risposta Performance

```
X-Query-Time: 145ms
X-Cache-Hit: true
X-Row-Count: 50000
```

### Strategie Performance

1. **Connection Pre-Warming**: Pool connessioni pre-riscaldato all'avvio
2. **Arrow IPC**: Serializzazione binaria zero-copy
3. **Polars**: Elaborazione dati in-memory veloce
4. **Row Virtualization**: Rendering solo righe visibili (supporta 1M+ righe)
5. **Gzip Compression**: Compressione risposte HTTP

### Performance Target

| Metrica | Target |
|---------|--------|
| Caricamento 10k righe | <100ms |
| Pivot con cache | <50ms |
| Pivot senza cache | <500ms |
| Scroll | 60fps |

---

## Sicurezza

### Autenticazione
- **JWT Bearer Token** con scadenza 24 ore
- **bcrypt** per hashing password
- Token refresh automatico

### Encryption
- **Fernet** encryption per credenziali database
- Password mai salvate in chiaro

### Ruoli e Permessi

| Ruolo | Permessi |
|-------|----------|
| **admin** | Tutto: CRUD connessioni, report, dashboard, utenti |
| **editor** | Visualizza e modifica report assegnati |
| **viewer** | Solo visualizzazione report/dashboard assegnati |

### SQL Injection Protection
- Query parametrizzate via SQLAlchemy
- Validazione input Pydantic
- Sanitizzazione nomi campi

---

## Sviluppo Locale

### Backend (senza Docker)

```bash
cd backend

# Crea virtual environment
python -m venv venv
source venv/bin/activate  # Linux/Mac
venv\Scripts\activate     # Windows

# Installa dipendenze
pip install -r requirements.txt

# Avvia server sviluppo
uvicorn app.main:app --reload --port 8000
```

### Frontend (senza Docker)

```bash
cd frontend

# Installa dipendenze
npm install

# Avvia dev server
npm run dev
```

### Build Produzione

```bash
# Frontend
cd frontend
npm run build

# Docker
docker-compose build
docker-compose up -d
```

---

## Variabili Ambiente

Crea file `.env` nella root del progetto:

```env
# Security (CAMBIARE IN PRODUZIONE!)
SECRET_KEY=your-super-secret-key-change-this-in-production

# Database interno (SQLite)
DATABASE_URL=sqlite+aiosqlite:///./data/infobi.db

# Cache Dragonfly/Redis
REDIS_URL=redis://cache:6379

# CORS Origins
CORS_ORIGINS=["http://localhost:3000","http://localhost:5173"]

# Performance
MAX_ROWS_PREVIEW=10000
MAX_ROWS_EXPORT=5000000
QUERY_TIMEOUT=300
CONNECTION_TIMEOUT=180

# Cache TTL (secondi)
CACHE_TTL=7200
CACHE_TTL_PIVOT=600

# JWT
ACCESS_TOKEN_EXPIRE_MINUTES=1440
```

---

## Troubleshooting

### Errore connessione database

```
Connection failed: Login timeout expired
```

**Soluzione**: Verificare firewall, porta, credenziali. Usare il bottone "Test" prima di salvare.

### Cache non funziona

```
Redis connection refused
```

**Soluzione**: Verificare che il container `cache` sia running:
```bash
docker-compose ps
docker-compose logs cache
```

### Pivot lento

**Cause possibili**:
1. Query base troppo complessa → semplificare
2. Troppi livelli GROUP BY → ridurre
3. Cache disabilitata → abilitare

**Diagnosi**: Controllare header `X-Query-Time` e `X-Cache-Hit`

### Frontend non carica

**Soluzione**:
```bash
# Rebuild frontend
docker-compose build frontend
docker-compose up -d frontend
```

### Reset password admin

```bash
docker-compose exec backend python -c "
from app.db.database import SessionLocal, User
from app.core.security import get_password_hash
db = SessionLocal()
user = db.query(User).filter(User.username == 'admin').first()
user.password_hash = get_password_hash('admin')
db.commit()
print('Password reset to: admin')
"
```

---

## Changelog

### v4.0.0 (Gennaio 2026)
- BiGrid: Pivot table custom con supporto multi-level
- Having By: Filtri su valori aggregati
- Aggregazioni filtrate per tipo campo
- Connection pooling con pre-warming
- Dragonfly cache (25x faster than Redis)
- Arrow IPC serialization
- Row virtualization

---

## Licenza

Proprietario - Tutti i diritti riservati

---

## Supporto

Per problemi o richieste:
- Aprire issue su repository
- Contattare il team di sviluppo
