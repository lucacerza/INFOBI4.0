# Database Connection Warm-Up System

## Panoramica

Il sistema di warm-up elimina i **195 secondi di attesa** della prima query ConnectorX inizializzando automaticamente le connessioni ai database all'avvio del backend.

## Come Funziona

### 1. Quando Parte
- ⏱️ **All'avvio del container backend** (prima di qualsiasi login utente)
- Esegue query di test `SELECT 1` su OGNI database configurato
- Accade **UNA SOLA VOLTA** quando FastAPI si avvia

### 2. Dove Esistono le Connessioni
- 🖥️ Le connessioni sono **BACKEND-SIDE** (lato server)
- NON sono legate al browser o al PC dell'utente
- **Tutti gli utenti** condividono lo stesso pool di connessioni warm

### 3. Multi-PC/Multi-Utente
✅ **Le connessioni sono globali al backend**, non per-utente:
- Se ti colleghi dal PC #1 → connessioni già warm
- Se ti colleghi dal PC #2 → connessioni già warm
- Se un collega si collega → connessioni già warm

### 4. Multi-Database
✅ **Supporta configurazioni con più database**:
- SQL Server + PostgreSQL + MySQL contemporaneamente
- Ogni database viene warmato separatamente in parallelo
- Riutilizza la stessa logica di QueryEngine

## Timeline Esempio

```
09:00 - Container backend si avvia
09:00 - 🔥 Warm-up query SQL Server → 195s (prima connessione)
09:03 - 🔥 Warm-up query PostgreSQL → 100s (prima connessione)
09:05 - ✅ Backend pronto - tutte le connessioni warm

09:30 - TU apri report SQL Server dal PC ufficio → ⚡ VELOCE (2s)
11:00 - TU apri report PostgreSQL dal PC ufficio → ⚡ VELOCE (1s)
14:00 - TU apri report SQL Server da casa → ⚡ VELOCE (2s)
15:00 - COLLEGA apre report SQL Server dal suo PC → ⚡ VELOCE (2s)
```

## Quando NON Funziona

❌ **Se riavvii il container backend** → warm-up riparte da capo
❌ **Se il backend crasha** → warm-up riparte da capo
✅ **Cambio browser/PC/utente** → connessioni RIMANGONO warm

## Log di Esempio

```
INFO:app.core.warmup:🔥 Starting database connection warm-up...
INFO:app.core.warmup:🔥 Found 2 database(s) to warm up:
INFO:app.core.warmup:   - SQL Server Produzione (mssql)
INFO:app.core.warmup:   - PostgreSQL Analytics (postgresql)
INFO:app.core.warmup:🔥 Warming up: SQL Server Produzione (mssql)...
INFO:app.core.warmup:🔥 Warming up: PostgreSQL Analytics (postgresql)...
INFO:app.core.warmup:✅ PostgreSQL Analytics: OK (85.2s)
INFO:app.core.warmup:✅ SQL Server Produzione: OK (195.4s)
INFO:app.core.warmup:✅ Warm-up complete! All 2 connection(s) ready (195.4s)
```

## Implementazione

### File Modificati

1. **`app/main.py`** - Aggiunta chiamata al warm-up nel lifespan hook
2. **`app/core/warmup.py`** - Nuovo modulo con logica di warm-up

### Funzioni Chiave

- `warm_up_connections()` - Funzione principale chiamata all'avvio
- `get_report_connections()` - Recupera tutte le connessioni uniche dai report
- `warm_up_single_connection()` - Esegue SELECT 1 su un singolo database

### Configurazione

Nessuna configurazione richiesta! Il sistema:
1. Legge automaticamente tutti i report dal database
2. Estrae le connessioni uniche
3. Warma solo i database effettivamente usati

## Benefici

### Prima del Warm-Up
```
Utente 1 (PC ufficio, 09:00): Apre report SQL Server
→ ⏱️ 195 secondi di attesa (cold start)
→ Query successiva: ⚡ 2s

Utente 2 (PC casa, 10:00): Apre report SQL Server
→ ⚡ 2s (già warm)
```

### Con Warm-Up
```
Backend avvio (09:00):
→ ⏱️ 195s warm-up in background (NESSUN utente in attesa!)

Utente 1 (PC ufficio, 09:30): Apre report SQL Server
→ ⚡ 2s (già warm)

Utente 2 (PC casa, 10:00): Apre report SQL Server
→ ⚡ 2s (già warm)
```

## Warm-Up Automatico (NEW!)

Il sistema ora warma automaticamente le connessioni in **4 scenari**:

### 1. All'Avvio Backend
✅ Già implementato - warma tutte le connessioni dei report esistenti

### 2. Test Connessione (Admin UI)
✅ Quando l'admin testa una nuova connessione prima di salvarla:
```
Admin: Test connessione → ✅ OK (195s prima volta)
Backend: 🔥 Warm-up automatico in background
Admin: Salva connessione
Admin: Crea report e testa → ⚡ VELOCE (2s)
```

### 3. Creazione Nuova Connessione
✅ Quando l'admin salva una nuova connessione:
```
Admin: Salva nuova connessione SQL Server DB3
Backend: 🔥 Warm-up automatico in background (non blocca UI)
Admin: Crea report su DB3
Utente: Apre report → ⚡ VELOCE (connessione già warm!)
```

### 4. Modifica Connessione Esistente
✅ Quando l'admin cambia host/password/porta:
```
Admin: Modifica host da 192.168.1.10 → 192.168.1.20
Backend: 🔥 Re-warm automatico con NUOVE credenziali
Utente: Apre report → ⚡ VELOCE (nessun cold start!)
```

## Warm-Up Manuale (Admin)

Nuovo endpoint per warm-up on-demand:

```bash
POST /api/connections/warmup-all
Authorization: Bearer <admin-token>
```

**Quando usarlo:**
- ⚙️ Dopo restart database server
- 🔧 Dopo manutenzione backend
- 📊 Prima di picco di utilizzo (es. lunedì mattina)

**Esempio:**
```bash
curl -X POST http://localhost:8000/api/connections/warmup-all \
  -H "Authorization: Bearer <token>"
```

Risposta:
```json
{
  "status": "started",
  "message": "Warm-up di tutte le connessioni avviato in background"
}
```

## FAQ

**Q: Se creo una nuova connessione, devo riavviare il backend?**
A: ❌ NO! Il warm-up parte automaticamente quando salvi la connessione.

**Q: Se modifico host/password, la connessione rimane warm?**
A: ✅ SÌ! Il sistema ri-warma automaticamente con le nuove credenziali.

**Q: Se ho 5 report su SQL Server e 3 su PostgreSQL, quante volte warma?**
A: 2 volte - una per SQL Server, una per PostgreSQL (connessioni uniche)

**Q: Il warm-up rallenta l'avvio del backend?**
A: Sì, ma è MOLTO meglio rallentare l'avvio (che accade 1 volta al giorno) che rallentare la prima query di ogni utente.

**Q: Posso disabilitare il warm-up?**
A: Sì, commenta le righe 27-29 in `app/main.py`

**Q: Il warm-up funziona anche con connection pooling?**
A: No, ConnectorX non usa connection pooling. Il warm-up serve proprio per questo - inizializza la connessione una volta, poi rimane warm.

**Q: Cosa succede se un database è offline durante il warm-up?**
A: Il warm-up lo segna come FAILED ma continua con gli altri database. Il backend si avvia comunque.

**Q: Il warm-up rallenta il salvataggio di una connessione?**
A: ❌ NO! Il warm-up parte in **background** (asyncio.create_task), non blocca la risposta API.
