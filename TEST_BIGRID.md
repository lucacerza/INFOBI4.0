# Guida Rapida - Test BiGrid Multi-Level Pivot

## 🚀 Setup Rapido

### 1. Avvia il Backend (se non già avviato)

```bash
cd c:\Lavoro\bi40\infobi\backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Backend disponibile su: http://localhost:8000

### 2. Avvia il Frontend

```bash
cd c:\Lavoro\bi40\infobi\frontend
npm install  # Solo la prima volta
npm run dev
```

Frontend disponibile su: http://localhost:5173

## 📋 Test Step-by-Step

### Step 1: Accedi all'Applicazione

1. Apri http://localhost:5173
2. Fai login con le tue credenziali
3. Vai alla sezione "Report"

### Step 2: Apri un Report Esistente

1. Clicca su un report dalla lista
2. Vedrai il visualizzatore normale (Perspective.js)
3. **Clicca sul pulsante "Pivot Avanzato"** (blu/viola in alto a destra)

### Step 3: Configura il Pivot Multi-Livello

Ora sei nella nuova pagina BiGrid! 🎉

**Pannello Configurazione (sinistra):**

1. **Righe (Rows):**
   - Trascina uno o più campi (es. "Cliente", "Prodotto")
   - Questi creano la gerarchia verticale espandibile

2. **Colonne (Columns) - LA NOVITÀ!:**
   - Trascina **MULTIPLI** campi (es. "Categoria", "Anno")
   - L'ordine conta: primo = livello superiore
   - Esempio: Categoria → Anno crea:
     ```
     Electronics        | Furniture
     2023 | 2024 | 2025 | 2023 | 2024
     ```

3. **Valori (Values):**
   - Trascina campi numerici (es. "Venduto", "Quantità")
   - Scegli aggregazione (SUM, AVG, COUNT, MIN, MAX)

### Step 4: Verifica Funzionalità

✅ **Test 1: Single Level (come prima)**
```
Righe: Cliente
Colonne: Anno
Valori: Venduto (SUM)
```
Risultato: Tabella normale con anni come colonne

✅ **Test 2: Multi-Level (NUOVO!)**
```
Righe: Cliente
Colonne: Categoria, Anno  ← DUE LIVELLI!
Valori: Venduto (SUM)
```
Risultato: Colonne gerarchiche!
```
Cliente | Electronics      | Furniture       | Clothing
        | 2023 | 2024 | 2025 | 2023 | 2024 | 2025 | ...
```

✅ **Test 3: Three Levels (AVANZATO!)**
```
Righe: Cliente, Prodotto
Colonne: Regione, Categoria, Anno  ← TRE LIVELLI!
Valori: Venduto (SUM)
```

### Step 5: Verifica Alignment

**IMPORTANTE:** Questo era il problema principale con Tabulator!

1. Apri DevTools (F12)
2. Ispeziona le celle della tabella
3. Verifica che header e dati abbiano **STESSO width**:
   - Header cell: `flex: 0 0 120px`
   - Data cell: `flex: 0 0 120px`
4. Ridimensiona finestra → alignment rimane perfetto ✓

### Step 6: Test Expand/Collapse

Se hai configurato le righe con gerarchia:
1. Clicca sul pulsante ▶ per espandere
2. Clicca sul pulsante ▼ per chiudere
3. Verifica che i valori aggregati siano corretti

## 🐛 Troubleshooting

### Problema: "Cannot read properties of undefined"

**Causa:** Backend non restituisce dati Arrow IPC corretti

**Soluzione:**
1. Verifica backend su http://localhost:8000/docs
2. Testa endpoint `/api/pivot/{report_id}` manualmente
3. Verifica che `split_by` sia array: `["Anno"]` non `"Anno"`

### Problema: Colonne non allineate

**Causa:** CSS non caricato

**Soluzione:**
1. Verifica che `BiGrid.css` sia importato
2. Controlla browser console per errori CSS
3. Hard refresh (Ctrl+F5)

### Problema: Nessuna gerarchia visibile

**Causa:** Backend restituisce solo singolo livello

**Debug:**
1. Apri DevTools → Network
2. Guarda richiesta POST `/api/pivot/{id}`
3. Verifica request body:
   ```json
   {
     "group_by": ["Cliente"],
     "split_by": ["Categoria", "Anno"],  ← Deve essere array!
     "metrics": [...]
   }
   ```
4. Verifica response: colonne devono essere tipo `Electronics|2023`

### Problema: BiGrid non si carica

**Causa:** Dipendenze mancanti

**Soluzione:**
```bash
cd c:\Lavoro\bi40\infobi\frontend
npm install apache-arrow lodash.debounce
npm run dev
```

## 📊 Esempi di Configurazioni

### Esempio 1: Analisi Vendite per Categoria e Anno
```
Righe: Cliente, Prodotto
Colonne: Categoria, Anno
Valori: Venduto (SUM), Quantità (SUM)
```

### Esempio 2: Confronto Regionale Multi-Anno
```
Righe: Prodotto
Colonne: Regione, Anno
Valori: Venduto (SUM)
```

### Esempio 3: Drill-Down Completo
```
Righe: Cliente, Categoria, Prodotto
Colonne: Anno, Trimestre
Valori: Venduto (SUM), Margine (CALC)
```

## 🎯 Checklist Funzionalità

Prima di considerare il test completo, verifica:

- [ ] Backend accetta `split_by` come array
- [ ] Frontend invia `split_by` come array
- [ ] Colonne gerarchiche renderizzate correttamente
- [ ] Header e celle perfettamente allineati
- [ ] Expand/collapse funziona
- [ ] Aggregazioni corrette
- [ ] Ridimensionamento finestra OK
- [ ] Nessun errore in console
- [ ] Performance accettabile (<500ms per pivot)

## 🔍 Debug Avanzato

### Verifica Struttura Dati Backend

Apri console browser e esegui dopo il caricamento:

```javascript
// Nella console del browser
const table = window.latestTable; // Se esponi la table globalmente
console.log('Columns:', table.schema.fields.map(f => f.name));
console.log('Sample row:', table.get(0));
```

### Verifica Column Hierarchy Frontend

Nella console React DevTools:

```javascript
// Trova il componente BiGrid
// Verifica props.pivotResult.columns
// Deve avere struttura:
{
  header: "Electronics",
  columns: [
    { header: "2023", accessorKey: "Electronics|2023_sales" },
    { header: "2024", accessorKey: "Electronics|2024_sales" }
  ]
}
```

## ✨ Prossimi Passi dopo Test OK

1. **Salva configurazioni pivot**
   - Aggiungi endpoint backend per salvare config
   - Aggiungi UI per caricare config salvate

2. **Export avanzato**
   - CSV con headers gerarchici
   - Excel con formattazione

3. **Performance**
   - Virtual scrolling per >5000 righe
   - Lazy loading per grandi dataset

4. **UX**
   - Reorder colonne con drag&drop
   - Resize colonne
   - Sort multi-level

## 📞 Hai Problemi?

Se incontri errori:

1. **Controlla console browser** (F12)
2. **Controlla backend logs** (terminale uvicorn)
3. **Confronta con newpivot** (`c:\Lavoro\newpivot\`) che funziona
4. **Verifica Arrow IPC** - usa `tableFromIPC()` correttamente

## 🎉 Success Criteria

Il test è SUPERATO quando:

✅ Puoi creare pivot con 3+ livelli di colonne
✅ Le colonne sono perfettamente allineate
✅ Expand/collapse funziona smooth
✅ Performance < 500ms per pivot tipico
✅ Nessun errore in console
✅ L'UI è responsive

Buon test! 🚀
