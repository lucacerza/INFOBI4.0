# 🚀 GUIDA RAPIDA INSTALLAZIONE - INFOBI 4.0 Ultimate

## 📦 Installazione Dipendenze

### Backend

```bash
cd backend
pip install -r requirements.txt
```

**Dipendenze aggiunte:**
- `duckdb==0.9.2` - Database in-memory ad alte prestazioni

### Frontend

```bash
cd frontend
npm install
```

**Dipendenze aggiunte:**
- `@tanstack/react-virtual@^3.13.17` - Virtualizzazione righe

## ⚡ Avvio Rapido

### Con Docker (Consigliato)

```bash
# 1. Avvia tutti i servizi
docker-compose up -d

# 2. Accedi
http://localhost:3000
Username: admin
Password: admin
```

### Sviluppo Locale

**Backend:**
```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend
npm run dev
```

## 🧪 Test delle Nuove Funzionalità

### 1. Test Virtualizzazione

Apri un report con molte righe e verifica:
- ✅ Scroll fluido a 60fps
- ✅ Memory usage basso (~50MB per 100k righe)
- ✅ Rendering istantaneo

### 2. Test Skeleton Loading

Ricaricare una pagina e verificare:
- ✅ Shimmer animation durante caricamento
- ✅ Nessuno spinner bloccante
- ✅ Transizione fluida a dati reali

### 3. Test Cross-Filtering

In una dashboard con più widget:
- ✅ Click su riga pivot A
- ✅ Pivot B e Chart C si aggiornano automaticamente
- ✅ Breadcrumb mostra filtri attivi

### 4. Test Lazy Loading API

```bash
# Test endpoint lazy loading
curl -X POST http://localhost:8000/api/pivot/1/lazy \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "depth": 0,
    "group_by": ["Category", "SubCategory"],
    "metrics": [{"field": "Venduto", "aggregation": "SUM"}],
    "filters": {}
  }'

# Test grand total
curl -X POST http://localhost:8000/api/pivot/1/grand-total \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "metrics": [{"field": "Venduto", "aggregation": "SUM"}],
    "filters": {"anno": 2024}
  }'
```

## 🔧 Risoluzione Problemi Comuni

### Errore: Module 'duckdb' not found
```bash
pip install duckdb==0.9.2
```

### Errore: Cannot find module '@tanstack/react-virtual'
```bash
cd frontend
npm install @tanstack/react-virtual@^3.13.17
```

### Animazione shimmer non funziona
```bash
cd frontend
# Ricompila Tailwind
npm run dev
```

### Port già in uso
```bash
# Backend (cambia porta)
uvicorn app.main:app --reload --port 8001

# Frontend (cambia porta)
vite --port 3001
```

## 📊 Verifica Installazione

### Checklist Backend
- [ ] `pip list | grep duckdb` → mostra versione 0.9.2
- [ ] Server avvia senza errori
- [ ] Endpoint `/health` risponde OK
- [ ] Endpoint `/api/pivot/{id}/lazy` disponibile

### Checklist Frontend
- [ ] `npm list @tanstack/react-virtual` → mostra versione ^3.13.17
- [ ] Build completa senza errori
- [ ] SkeletonLoader.tsx presente
- [ ] VirtualizedBiGrid.tsx presente
- [ ] dashboardStore.ts funzionante

## 🎯 Next Steps

Dopo l'installazione:

1. **Leggi:** [MIGLIORIE_IMPLEMENTATE.md](MIGLIORIE_IMPLEMENTATE.md)
2. **Integra:** VirtualizedBiGrid in BiGrid.tsx
3. **Testa:** Con dataset 100k+ righe
4. **Implementa:** Lazy loading nei componenti

## 📞 Support

Per problemi o domande:
- Verifica log backend: `docker logs infobi-backend`
- Verifica log frontend: Console browser (F12)
- Controlla [MIGLIORIE_IMPLEMENTATE.md](MIGLIORIE_IMPLEMENTATE.md) sezione Troubleshooting

---

**Tempo totale installazione:** ~5 minuti  
**Compatibilità:** Python 3.9+, Node 18+, Docker 20+
