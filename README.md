# INFOBI 4.0 - Business Intelligence per Industria 4.0

## 🚀 Caratteristiche Principali

- **Performance Estrema**: Pivot server-side con cache Redis/Dragonfly
- **Calcoli Corretti**: Margini calcolati con ROLLUP (totali corretti!)
- **Mobile-First**: PWA responsive, touch-optimized
- **Real-Time Ready**: Architettura per WebSocket e push notifications

## 📊 Architettura

```
Frontend (React + Perspective.js)
       │
       │  Arrow IPC (binary, streaming)
       ▼
Backend (Python + FastAPI)
       │
       │  ConnectorX (10x faster)
       ▼
Database (SQL Server, PostgreSQL, MySQL)
```

## 🏃 Quick Start

```bash
# 1. Avvia i servizi
docker-compose up -d

# 2. Accedi
http://localhost:3000
Username: admin
Password: admin
```

## 🛠️ Sviluppo

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload

# Frontend
cd frontend
npm install
npm run dev
```

## 📁 Struttura

```
infobi/
├── backend/           # Python FastAPI
│   └── app/
│       ├── api/       # Endpoints
│       ├── services/  # Query engine, cache
│       └── db/        # Database models
├── frontend/          # React + Perspective.js
│   └── src/
│       ├── components/
│       ├── pages/
│       └── services/
└── docker-compose.yml
```

## 🔑 Concetti Chiave

### Pivot Server-Side
Quando l'utente cambia configurazione pivot:
1. Frontend invia config a `/api/pivot/{id}`
2. Backend esegue query con `GROUP BY ROLLUP`
3. Margini calcolati CORRETTAMENTE su ogni livello
4. Risultato in Arrow IPC (velocissimo)
5. Perspective.js visualizza (zero calcoli)

### Cache
- **Dragonfly** (compatibile Redis, 25x più veloce)
- Cache per query e pivot
- TTL configurabile per report
- Invalidazione automatica su modifica

## 📈 Performance Target

| Metrica | Target |
|---------|--------|
| Caricamento 10k righe | <100ms |
| Pivot con cache | <50ms |
| Pivot senza cache | <500ms |
| Scroll 60fps | ✓ |

## 🔒 Sicurezza

- JWT Authentication
- Password criptate (bcrypt)
- Credenziali DB criptate (Fernet)
- Ruoli: admin, editor, viewer
