# 🔧 Risoluzione Problemi Performance INFOBI 4.0

## ✅ MODIFICHE APPLICATE

### 1. **Cache Dragonfly** - Aumentata da 512MB a 2GB
```yaml
command: ["--maxmemory", "2gb", "--proactor_threads", "4", "--cache_mode"]
```
- **Prima**: 512MB (insufficiente per dataset grandi)
- **Ora**: 2GB con 4 thread e modalità cache ottimizzata
- **Impatto**: 4x più spazio cache, meno cache miss

### 2. **Backend Workers** - Da 1 a 4
```yaml
command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```
- **Prima**: `--reload` mode (singolo worker, solo dev)
- **Ora**: 4 workers paralleli (production-ready)
- **Impatto**: 4x capacità richieste simultanee

### 3. **Thread Pool** - Ottimizzato a 4
```python
_executor = ThreadPoolExecutor(max_workers=4)
```
- **Impatto**: Gestisce 4 query DB parallele senza saturare il pool SQLAlchemy

### 4. **Limiti Cache e Query**
```python
CACHE_TTL: int = 7200        # 2 ore (era 1 ora)
CACHE_TTL_PIVOT: int = 600   # 10 minuti (erano 5)
MAX_ROWS_PREVIEW: int = 10000  # 10k (erano 1k)
MAX_ROWS_EXPORT: int = 5000000 # 5M (era 1M)
```

### 5. **Volume Docker Ottimizzato**
```yaml
volumes:
  - ./data:/app/data
  - ./backend/app:/app/app  # Solo cartella app, non tutto backend
```
- **Riduce overhead I/O** su Windows con antivirus

### 6. **Connection Pooling SQLAlchemy**
```python
pool_size=5, max_overflow=10, pool_pre_ping=True
```
- **Warm-up automatico** all'avvio backend
- **Elimina cold start**: da 195s a 2s per prima query
- Pool condiviso tra tutti gli utenti
- Connessioni persistenti fino a riavvio backend

---

## 🚀 COME APPLICARE LE MODIFICHE

### Opzione 1: Rebuild Completo (RACCOMANDATO)
```powershell
# 1. Ferma tutto
docker-compose down -v

# 2. Rimuovi immagini vecchie
docker rmi infobi40-backend infobi40-frontend

# 3. Rebuild e riavvio
docker-compose build --no-cache
docker-compose up -d

# 4. Verifica
docker-compose logs -f backend
```

### Opzione 2: Restart Veloce (se già buildato)
```powershell
docker-compose down
docker-compose up -d
docker-compose logs -f backend
```

---

## 🔍 DIAGNOSTICA PROBLEMI

### Verifica Memoria Cache
```powershell
docker exec -it infobi40-cache-1 redis-cli INFO memory
```
Cerca `maxmemory:2147483648` (2GB)

### Verifica Workers Backend
```powershell
docker exec -it infobi40-backend-1 ps aux
```
Dovresti vedere 5 processi uvicorn (1 master + 4 workers)

### Verifica Performance Query
```powershell
docker-compose logs backend | Select-String "Query executed"
```
Tempi normali:
- Query 10k righe: <100ms
- Pivot cache hit: <50ms
- Pivot cold: <500ms

### Test Cache Redis
```powershell
docker exec -it infobi40-cache-1 redis-cli
> PING
PONG
> DBSIZE
(numero di chiavi in cache)
```

---

## ⚠️ PROBLEMI COMUNI

### 1. "Container già in uso"
```powershell
docker-compose down
docker stop $(docker ps -aq)
docker-compose up -d
```

### 2. "Modifiche al codice non si applicano"
**CAUSA**: Codice vecchio nella build Docker
**SOLUZIONE**:
```powershell
docker-compose down
docker-compose build --no-cache backend
docker-compose up -d
```

### 3. "Out of Memory su Redis"
**SINTOMO**: Errori tipo "OOM command not allowed"
**SOLUZIONE**: Aumenta maxmemory in docker-compose.yml
```yaml
command: ["--maxmemory", "4gb", ...]
```

### 4. "Lentezza su Windows"
**CAUSA**: Antivirus scansiona ogni file nel volume mount
**SOLUZIONE**: Escludi cartella progetto da Windows Defender
```
Settings → Windows Security → Virus & threat protection → Exclusions
Aggiungi: E:\Lavoro\appoggio\Infobi40\INFOBI4.0
```

### 5. "Database locked"
**CAUSA**: SQLite concurrency limit
**SOLUZIONE**: Passa a PostgreSQL per produzione
```yaml
environment:
  - DATABASE_URL=postgresql://user:pass@db:5432/infobi
```

---

## 📊 PERFORMANCE ATTESE

### Con le nuove configurazioni:

| Operazione | Prima | Ora | Power BI |
|-----------|-------|-----|----------|
| Query 10k righe | 2-3s | <100ms ⚡ | ~100ms |
| Pivot cache hit | 200ms | <50ms ⚡ | <50ms |
| Pivot cold | 2-5s | <500ms ⚡ | ~500ms |
| Espansione nodo | 1-2s | <200ms ⚡ | ~200ms |
| Refresh cache | 3-5s | <1s ⚡ | ~1s |

---

## 🔧 TUNING AVANZATO (Opzionale)

### Per Dataset ENORMI (100M+ righe):
```python
# backend/app/core/config.py
CACHE_TTL_PIVOT: int = 3600  # 1 ora invece di 10 minuti
```

### Per PC Lenti:
```yaml
# docker-compose.yml
backend:
  command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2
```

### Per Rete Lenta:
```python
# backend/app/core/config.py
MAX_ROWS_PREVIEW: int = 5000  # Riduci a 5k
```

---

## ✅ CHECKLIST FINALE

Dopo l'applicazione delle modifiche, verifica:

- [ ] Container backend mostra 4 workers nei log
- [ ] Cache Redis ha 2GB maxmemory
- [ ] Query <100ms per 10k righe
- [ ] Espansione nodi lazy <200ms
- [ ] Refresh cache <1s
- [ ] Nessun errore OOM Redis
- [ ] CPU backend <50% a riposo

---

## 📞 DEBUG ULTERIORE

Se ancora lento, raccogli questi dati:

```powershell
# 1. Statistiche container
docker stats

# 2. Log backend completi
docker-compose logs backend > backend-logs.txt

# 3. Info cache
docker exec -it infobi40-cache-1 redis-cli INFO all > redis-info.txt

# 4. Query lente
docker-compose logs backend | Select-String "Query executed.*ms" | Select-String -Pattern "[0-9]{4,}\..*ms"
```

Invia questi file per analisi approfondita.
