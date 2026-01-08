# 🐳 Docker Quick Start - INFOBI 4.0 con BiGrid

## 🚀 Lancio Rapido (1 Comando!)

```bash
cd c:\Lavoro\bi40\infobi
docker-compose up --build
```

Poi apri: **http://localhost:3000**

## 📦 Cosa Include

Il setup Docker lancia 3 servizi:

1. **Dragonfly Cache** (porta 6379)
   - Cache Redis-compatible
   - 25x più veloce di Redis
   - Usato per query cache

2. **Backend Python** (porta 8001)
   - FastAPI con uvicorn
   - 4 workers per performance
   - ConnectorX + Polars + Arrow
   - **BiGrid multi-level pivot** ✨

3. **Frontend React** (porta 3000)
   - Build production con Vite
   - Servito da nginx
   - **Nuova pagina Pivot Avanzato** ✨

## 🎯 Test BiGrid in Docker

### Step 1: Avvia i Container

```bash
cd c:\Lavoro\bi40\infobi
docker-compose up --build
```

Attendi che vedi:
```
frontend_1  | ... nginx started
backend_1   | ... Uvicorn running on http://0.0.0.0:8000
cache_1     | ... Dragonfly ready to accept connections
```

### Step 2: Accedi all'Applicazione

Apri browser: **http://localhost:3000**

### Step 3: Testa Pivot Multi-Livello

1. Login con le tue credenziali
2. Vai a "Reports"
3. Apri un report
4. **Clicca "Pivot Avanzato"** (pulsante blu/viola)
5. Configura:
   - **Righe:** Cliente, Prodotto
   - **Colonne:** Categoria, Anno (← 2 LIVELLI!)
   - **Valori:** Venduto

## 🔧 Comandi Docker Utili

### Avvio Container
```bash
# Build e start
docker-compose up --build

# Start in background
docker-compose up -d

# Solo rebuild
docker-compose build
```

### Stop Container
```bash
# Stop gracefully
docker-compose down

# Stop e rimuovi volumi (reset completo)
docker-compose down -v
```

### Logs
```bash
# Tutti i servizi
docker-compose logs -f

# Solo backend
docker-compose logs -f backend

# Solo frontend
docker-compose logs -f frontend

# Ultimi 100 righe
docker-compose logs --tail=100 -f
```

### Shell nei Container
```bash
# Backend shell
docker-compose exec backend bash

# Frontend shell (nginx)
docker-compose exec frontend sh

# Cache shell (redis-cli)
docker-compose exec cache redis-cli
```

### Restart Singolo Servizio
```bash
# Restart solo backend
docker-compose restart backend

# Rebuild e restart backend
docker-compose up -d --build backend
```

## 🐛 Troubleshooting Docker

### Problema: Port già in uso

**Errore:**
```
Error: bind: address already in use
```

**Soluzione 1:** Cambia porte in docker-compose.yml
```yaml
backend:
  ports:
    - "8002:8000"  # Cambia 8001 → 8002

frontend:
  ports:
    - "3001:80"    # Cambia 3000 → 3001
```

**Soluzione 2:** Ferma servizio che usa la porta
```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Verifica porte libere
netstat -ano | findstr :3000
netstat -ano | findstr :8001
```

### Problema: Build fallisce

**Errore:**
```
ERROR: failed to solve...
```

**Soluzione:**
```bash
# Pulisci tutto e riprova
docker-compose down -v
docker system prune -a
docker-compose up --build
```

### Problema: Frontend non si connette al backend

**Causa:** Frontend usa hardcoded localhost:8000

**Soluzione:** Verifica nginx.conf

```bash
# Controlla nginx config
docker-compose exec frontend cat /etc/nginx/nginx.conf
```

Se necessario, aggiorna [frontend/nginx.conf](c:\Lavoro\bi40\infobi\frontend\nginx.conf):
```nginx
location /api {
    proxy_pass http://backend:8000;
    # ...
}
```

### Problema: Cache non funziona

**Debug:**
```bash
# Verifica Dragonfly
docker-compose exec cache redis-cli ping
# Risposta: PONG

# Controlla connessione backend
docker-compose logs backend | grep -i cache
docker-compose logs backend | grep -i dragonfly
```

## 📊 Variabili d'Ambiente

### File .env (opzionale)

Crea `c:\Lavoro\bi40\infobi\.env`:

```env
# Security
SECRET_KEY=your-super-secret-key-change-this

# Cache
REDIS_URL=redis://cache:6379

# Database (SQLite in volume)
DATABASE_URL=sqlite+aiosqlite:///./data/infobi.db

# Performance
UVICORN_WORKERS=4
```

Poi:
```bash
docker-compose --env-file .env up
```

## 🔍 Health Checks

Verifica stato servizi:

```bash
# Backend health
curl http://localhost:8001/health

# Frontend
curl http://localhost:3000

# Cache
docker-compose exec cache redis-cli ping
```

## 📈 Performance in Docker

### Monitoraggio Risorse

```bash
# Stats real-time
docker stats

# Solo INFOBI containers
docker stats infobi_backend_1 infobi_frontend_1 infobi_cache_1
```

### Ottimizzazione

**Backend - Aumenta Workers:**
```yaml
# docker-compose.yml
backend:
  command: ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "8"]
```

**Cache - Aumenta Memoria:**
```yaml
cache:
  command: ["--maxmemory", "1gb", "--proactor_threads", "4"]
```

## 🚢 Deploy Production

### Build per Produzione

```bash
# Build immagini
docker-compose build

# Tag per registry
docker tag infobi_backend:latest your-registry.com/infobi-backend:v1.0
docker tag infobi_frontend:latest your-registry.com/infobi-frontend:v1.0

# Push
docker push your-registry.com/infobi-backend:v1.0
docker push your-registry.com/infobi-frontend:v1.0
```

### docker-compose.prod.yml

Crea versione production:

```yaml
version: '3.8'

services:
  cache:
    image: docker.dragonflydb.io/dragonflydb/dragonfly
    command: ["--maxmemory", "2gb", "--proactor_threads", "4"]
    restart: always

  backend:
    image: your-registry.com/infobi-backend:v1.0
    environment:
      - SECRET_KEY=${SECRET_KEY}
      - REDIS_URL=redis://cache:6379
      - DATABASE_URL=${DATABASE_URL}
    restart: always

  frontend:
    image: your-registry.com/infobi-frontend:v1.0
    ports:
      - "80:80"
    restart: always
```

Lancio:
```bash
docker-compose -f docker-compose.prod.yml up -d
```

## 🎯 Sviluppo con Docker

### Hot Reload Backend

Usa volumes per sviluppo:

```yaml
# docker-compose.dev.yml
backend:
  volumes:
    - ./backend/app:/app/app
  command: ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
```

```bash
docker-compose -f docker-compose.dev.yml up
```

### Hot Reload Frontend

Usa Vite dev server invece di build:

```yaml
# docker-compose.dev.yml
frontend:
  build:
    context: ./frontend
    dockerfile: Dockerfile.dev
  ports:
    - "5173:5173"
  volumes:
    - ./frontend/src:/app/src
  command: npm run dev -- --host
```

## 🔐 Security Best Practices

1. **Non usare SECRET_KEY di default in production!**
   ```bash
   # Genera key sicura
   python -c "import secrets; print(secrets.token_urlsafe(32))"
   ```

2. **Usa .env file (git-ignored)**
   ```bash
   echo ".env" >> .gitignore
   ```

3. **Limita esposizione porte**
   ```yaml
   # Solo frontend esposto
   backend:
     expose:
       - "8000"  # Non ports:
   ```

4. **Network isolation**
   ```yaml
   networks:
     frontend:
     backend:

   services:
     frontend:
       networks: [frontend, backend]
     backend:
       networks: [backend]
   ```

## ✅ Quick Test Checklist

Dopo `docker-compose up`, verifica:

- [ ] http://localhost:3000 → Login page ✓
- [ ] http://localhost:8001/docs → FastAPI docs ✓
- [ ] `docker ps` → 3 containers running ✓
- [ ] Login funziona ✓
- [ ] Reports list carica ✓
- [ ] Report viewer funziona ✓
- [ ] **Pivot Avanzato** funziona ✓
- [ ] Multi-level columns rendering ✓
- [ ] Nessun errore in logs ✓

## 🎉 Tutto Pronto!

Il tuo stack INFOBI 4.0 con BiGrid multi-level è ora containerizzato e pronto per:

✅ Sviluppo locale
✅ Testing
✅ Staging
✅ Production deploy

Un solo comando per lanciare tutto:
```bash
docker-compose up --build
```

🚀 Buon lavoro!
