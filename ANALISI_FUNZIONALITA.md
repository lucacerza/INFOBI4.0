# INFOBI 4.0 - Analisi Funzionalità Avanzate

**Data:** 21 Gennaio 2026
**Versione:** 2.0 (Revisionata con feedback Gemini)

---

## Indice

1. [Colonne Calcolate](#1-colonne-calcolate)
2. [Confronto tra Colonne (Split Comparison)](#2-confronto-tra-colonne-split-comparison)
3. [Grafici](#3-grafici)
4. [Confronto con Power BI](#4-confronto-con-power-bi)
5. [Sistema Permessi e Ruoli](#5-sistema-permessi-e-ruoli)
6. [Row-Level Security (RLS)](#6-row-level-security-rls)
7. [Priorità e Roadmap Suggerita](#7-priorità-e-roadmap-suggerita)

---

## NOTA IMPORTANTE: Architettura Esistente

Il progetto INFOBI 4.0 utilizza già:
- **Polars** per elaborazione dati (NON Pandas)
- **Apache Arrow IPC** per serializzazione
- **Connection Pool condiviso** (`_engines` globale in `engine_pool.py`)
- **Dragonfly** come cache Redis-compatible

Tutte le implementazioni devono rispettare questa architettura per mantenere le performance.

---

## 1. Colonne Calcolate

### 1.1 Descrizione Funzionalità

Le colonne calcolate permettono di creare nuovi campi derivati da operazioni matematiche, logiche o di testo su colonne esistenti. Come in Perspective.js, l'utente potrà definire espressioni che generano nuovi valori.

### 1.2 Tipologie di Colonne Calcolate

#### A) Colonne Calcolate Semplici (Row-Level)
Operazioni su ogni singola riga prima dell'aggregazione:
```
Margine = Venduto - Costo
Margine% = (Venduto - Costo) / Venduto * 100
Prezzo_IVA = Prezzo * 1.22
Nome_Completo = CONCAT(Nome, ' ', Cognome)
```

#### B) Colonne Calcolate Aggregate (Post-Aggregation)
Operazioni sui valori già aggregati:
```
Margine_Totale = SUM(Venduto) - SUM(Costo)
Media_Ponderata = SUM(Valore * Peso) / SUM(Peso)
Variazione% = (SUM(Venduto_2024) - SUM(Venduto_2023)) / SUM(Venduto_2023) * 100
```

#### C) Colonne Window/Running
Calcoli che considerano il contesto delle altre righe:
```
Running_Total = SUM(Venduto) OVER (ORDER BY Data)
Rank = RANK() OVER (PARTITION BY Categoria ORDER BY Venduto DESC)
% del Totale = SUM(Venduto) / SUM(Venduto) OVER () * 100
```

### 1.3 Implementazione con Polars (RACCOMANDATO)

> **IMPORTANTE**: Il progetto usa già Polars. NON usare Pandas o SQL generation.

#### Perché Polars e NON SQL/Pandas:

| Approccio | Pro | Contro |
|-----------|-----|--------|
| **SQL Nativo** | Performance DB | Parser complesso per 3 DB diversi (MSSQL/Postgres/MySQL), bug-prone |
| **Pandas** | Flessibile | Single-threaded, alto consumo RAM |
| **Polars** ✅ | Multi-threaded, lazy eval, già integrato | - |

#### Backend - Implementazione Polars

```python
# services/calculated_columns.py
import polars as pl
from typing import Dict, Any

class CalculatedColumnEngine:
    """
    Motore per colonne calcolate usando Polars expressions.
    Polars è già usato nel progetto - manteniamo consistenza.
    """

    # Mapping da sintassi utente a Polars
    OPERATORS = {
        '+': lambda a, b: a + b,
        '-': lambda a, b: a - b,
        '*': lambda a, b: a * b,
        '/': lambda a, b: a / b,
        '%': lambda a, b: a % b,
    }

    FUNCTIONS = {
        'ABS': lambda col: col.abs(),
        'ROUND': lambda col, decimals=0: col.round(decimals),
        'FLOOR': lambda col: col.floor(),
        'CEIL': lambda col: col.ceil(),
        'SQRT': lambda col: col.sqrt(),
        'LOG': lambda col: col.log(),
        'UPPER': lambda col: col.str.to_uppercase(),
        'LOWER': lambda col: col.str.to_lowercase(),
        'LENGTH': lambda col: col.str.len_chars(),
        'YEAR': lambda col: col.dt.year(),
        'MONTH': lambda col: col.dt.month(),
        'DAY': lambda col: col.dt.day(),
    }

    @staticmethod
    def parse_expression(expr: str, df: pl.DataFrame) -> pl.Expr:
        """
        Converte espressione utente in Polars expression.

        Esempi:
        - "Venduto - Costo" -> pl.col("Venduto") - pl.col("Costo")
        - "Venduto * 1.22" -> pl.col("Venduto") * 1.22
        - "ABS(Margine)" -> pl.col("Margine").abs()
        """
        # Implementazione semplificata - in produzione usare parser AST
        import re

        # Sostituisci nomi colonne con pl.col()
        columns = df.columns
        result_expr = expr

        for col in sorted(columns, key=len, reverse=True):
            if col in result_expr:
                result_expr = result_expr.replace(col, f'pl.col("{col}")')

        # Valuta l'espressione in modo sicuro
        # NOTA: In produzione, usare un parser AST sicuro (es. lark-parser)
        return eval(result_expr)

    @staticmethod
    def add_calculated_column(
        df: pl.DataFrame,
        name: str,
        expression: str
    ) -> pl.DataFrame:
        """Aggiunge una colonna calcolata al DataFrame."""
        expr = CalculatedColumnEngine.parse_expression(expression, df)
        return df.with_columns(expr.alias(name))

    @staticmethod
    def add_calculated_columns_batch(
        df: pl.DataFrame,
        columns: list[Dict[str, str]]
    ) -> pl.DataFrame:
        """
        Aggiunge multiple colonne calcolate in un'unica passata.
        Più efficiente di chiamate singole.
        """
        expressions = []
        for col in columns:
            expr = CalculatedColumnEngine.parse_expression(col['expression'], df)
            expressions.append(expr.alias(col['name']))

        return df.with_columns(expressions)


# Esempio di utilizzo nel query_engine.py esistente
async def execute_pivot_with_calculated(
    db_type: str,
    config: dict,
    base_query: str,
    calculated_columns: list[Dict],
    group_by: list[str],
    metrics: list[dict],
    **kwargs
) -> tuple:
    """Esegue pivot con colonne calcolate."""

    # 1. Esegui query base
    df = await QueryEngine._execute_df_sync(db_type, config, base_query)

    # 2. Aggiungi colonne calcolate (Polars - velocissimo)
    if calculated_columns:
        df = CalculatedColumnEngine.add_calculated_columns_batch(df, calculated_columns)

    # 3. Esegui aggregazioni pivot
    # ... resto della logica esistente ...

    return result
```

#### Funzioni Supportate (Mappate a Polars)

| Categoria | Funzioni | Polars Equivalent |
|-----------|----------|-------------------|
| **Matematiche** | +, -, *, /, %, ABS, ROUND, FLOOR, CEIL, SQRT, LOG | `+`, `-`, `*`, `/`, `%`, `.abs()`, `.round()`, `.floor()`, `.ceil()`, `.sqrt()`, `.log()` |
| **Logiche** | IF, CASE | `.when().then().otherwise()` |
| **Testo** | UPPER, LOWER, LENGTH, TRIM | `.str.to_uppercase()`, `.str.to_lowercase()`, `.str.len_chars()`, `.str.strip_chars()` |
| **Data** | YEAR, MONTH, DAY | `.dt.year()`, `.dt.month()`, `.dt.day()` |
| **Aggregazione** | SUM, AVG, COUNT, MIN, MAX | `.sum()`, `.mean()`, `.count()`, `.min()`, `.max()` |
| **Window** | RANK, ROW_NUMBER, LAG, LEAD | `.rank()`, `.cum_count()`, `.shift(1)`, `.shift(-1)` |

### 1.4 Frontend - UI per Definizione Colonne

```typescript
interface CalculatedColumn {
  id: string;
  name: string;           // Nome visualizzato
  expression: string;     // Espressione (es. "Venduto - Costo")
  type: 'row' | 'aggregate' | 'window';
  resultType: 'number' | 'string' | 'date' | 'boolean';
  format?: string;        // Formato visualizzazione (es. "0.00%")
}
```

**Opzione A: Editor Testuale con Autocomplete** (RACCOMANDATO)
- Textarea con syntax highlighting
- Autocomplete per nomi colonne
- Validazione espressione in tempo reale
- Preview del risultato

**Opzione B: Builder Visuale (Drag & Drop)**
- Seleziona colonne da pannello
- Seleziona operatori (+, -, *, /, etc.)
- Costruisci formula visivamente
- Più user-friendly ma meno potente

### 1.5 Schema Database

```sql
CREATE TABLE calculated_columns (
    id SERIAL PRIMARY KEY,
    report_id INTEGER REFERENCES reports(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    expression TEXT NOT NULL,
    calc_type VARCHAR(20) NOT NULL, -- 'row', 'aggregate', 'window'
    result_type VARCHAR(20) NOT NULL, -- 'number', 'string', 'date', 'boolean'
    format VARCHAR(50),
    position INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### 1.6 Integrazione con Pivot

Le colonne calcolate dovranno:
- Apparire nella lista "All Columns" del BiGridConfig
- Essere trascinabili in Group By, Split By, Columns, Having By, etc.
- Supportare aggregazioni (se di tipo row-level)
- Essere filtrabili e ordinabili

### 1.7 Stima Effort (Rivista)

| Componente | Giorni |
|------------|--------|
| UI Editor espressioni | 3-4 |
| Parser espressioni → Polars | 2-3 |
| Integrazione query_engine | 2 |
| Integrazione BiGrid | 2 |
| Testing | 2 |
| **Totale** | **11-15 giorni** |

---

## 2. Confronto tra Colonne (Split Comparison)

### 2.1 Descrizione Funzionalità

Quando si usa Split By (es. per Anno), permettere confronti tra le colonne generate:
- Venduto 2024 vs Venduto 2023
- Variazione assoluta
- Variazione percentuale
- Ranking tra periodi

### 2.2 Tipologie di Confronto

#### A) Variazione Assoluta
```
Δ = Venduto_2024 - Venduto_2023
```

#### B) Variazione Percentuale
```
Δ% = (Venduto_2024 - Venduto_2023) / Venduto_2023 * 100
```

#### C) Rapporto
```
Ratio = Venduto_2024 / Venduto_2023
```

#### D) Confronto con Media/Totale
```
vs Media = Venduto_2024 - AVG(Venduto per tutti gli anni)
vs Totale% = Venduto_2024 / SUM(Venduto tutti gli anni) * 100
```

### 2.3 UI Proposta

Nella sezione Split By, quando c'è almeno un campo:

```
┌─────────────────────────────────────┐
│ SPLIT BY                            │
├─────────────────────────────────────┤
│ [Anno] [x]                          │
│                                     │
│ ┌─ Confronti ─────────────────────┐ │
│ │ [+] Aggiungi confronto          │ │
│ │                                 │ │
│ │ ○ Δ (2024 - 2023)      [x]     │ │
│ │ ○ Δ% ((2024-2023)/2023) [x]    │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

**Configurazione Confronto:**
```typescript
interface SplitComparison {
  id: string;
  type: 'absolute' | 'percentage' | 'ratio' | 'vs_avg' | 'vs_total';
  baseValue: string;      // es. "2024" o "current" (ultimo valore)
  compareValue: string;   // es. "2023" o "previous" (valore precedente)
  applyTo: string[];      // Metriche a cui applicare (es. ["Venduto", "Margine"])
  label?: string;         // Label custom
}
```

### 2.4 Implementazione Backend con Polars

> **NOTA**: Usare Polars per post-processing, NON SQL con Window Functions.

```python
import polars as pl

def add_split_comparisons(
    df: pl.DataFrame,
    comparisons: list[SplitComparison],
    split_column: str,
    metric_columns: list[str]
) -> pl.DataFrame:
    """
    Aggiunge colonne di confronto dopo il pivot.
    Usa Polars per operazioni vettoriali veloci.
    """

    for comp in comparisons:
        base_val = comp.baseValue
        compare_val = comp.compareValue

        for metric in comp.applyTo:
            base_col = f"{metric}_{base_val}"
            compare_col = f"{metric}_{compare_val}"

            if comp.type == 'absolute':
                # Delta assoluto
                df = df.with_columns(
                    (pl.col(base_col) - pl.col(compare_col))
                    .alias(f"Δ_{metric}_{base_val}_{compare_val}")
                )

            elif comp.type == 'percentage':
                # Delta percentuale
                df = df.with_columns(
                    ((pl.col(base_col) - pl.col(compare_col)) / pl.col(compare_col) * 100)
                    .fill_nan(0)  # Handle division by zero
                    .alias(f"Δ%_{metric}_{base_val}_{compare_val}")
                )

            elif comp.type == 'ratio':
                # Rapporto
                df = df.with_columns(
                    (pl.col(base_col) / pl.col(compare_col))
                    .fill_nan(0)
                    .alias(f"Ratio_{metric}_{base_val}_{compare_val}")
                )

            elif comp.type == 'vs_avg':
                # vs Media di tutti i periodi
                avg_val = df.select(pl.col(base_col).mean()).item()
                df = df.with_columns(
                    (pl.col(base_col) - avg_val)
                    .alias(f"vsAvg_{metric}_{base_val}")
                )

            elif comp.type == 'vs_total':
                # % del Totale
                total_val = df.select(pl.col(base_col).sum()).item()
                df = df.with_columns(
                    (pl.col(base_col) / total_val * 100)
                    .alias(f"vsTotal%_{metric}_{base_val}")
                )

    return df
```

### 2.5 Visualizzazione

Le colonne di confronto dovranno:
- Apparire dopo le colonne originali
- Avere formattazione condizionale (verde positivo, rosso negativo)
- Supportare tooltip con dettagli del calcolo

### 2.6 Stima Effort

| Componente | Giorni |
|------------|--------|
| UI configurazione confronti | 2 |
| Backend calcolo confronti (Polars) | 2 |
| Formattazione condizionale | 1-2 |
| Integrazione BiGrid | 1-2 |
| Testing | 1 |
| **Totale** | **7-9 giorni** |

---

## 3. Grafici

### 3.1 Scelta Libreria: ECharts (RACCOMANDATO)

> **Decisione**: Usare **ECharts** invece di Recharts.

| Criterio | Recharts | ECharts |
|----------|----------|---------|
| **Rendering** | SVG (DOM nodes) | Canvas (singolo elemento) |
| **Performance 10k+ punti** | ❌ Rallenta | ✅ Fluido |
| **Tipi grafici** | Base | Completi (Treemap, Sankey, Gauge, etc.) |
| **Interattività** | Buona | Eccellente |
| **Bundle size** | ~150KB | ~400KB (tree-shakeable) |
| **Stile Power BI** | No | Sì |

**Motivazione**: Nella BI è comune visualizzare migliaia di punti dati. Recharts usa SVG che crea un nodo DOM per ogni punto, causando rallentamenti. ECharts usa Canvas, gestendo centinaia di migliaia di punti senza problemi.

### 3.2 Tipi di Grafici da Supportare

#### Fase 1 (Essenziali) - 1-2 settimane
1. **Barre** (verticali/orizzontali, raggruppate, impilate)
2. **Linee** (singole, multiple, area)
3. **Torta/Ciambella**
4. **KPI Card** (numero grande con trend)

#### Fase 2 (Avanzati) - 2-3 settimane
5. **Scatter Plot**
6. **Treemap**
7. **Heatmap**
8. **Gauge**
9. **Waterfall**
10. **Funnel**

#### Fase 3 (Specializzati) - Futuro
11. **Mappa geografica**
12. **Sankey**
13. **Radar**
14. **Candlestick** (per dati finanziari)

### 3.3 Architettura Proposta

```
┌─────────────────────────────────────────────────────────┐
│                    Dashboard                             │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │   Widget    │  │   Widget    │  │   Widget    │     │
│  │  (Pivot)    │  │  (Chart)    │  │  (KPI Card) │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
│                                                         │
│  Ogni widget ha:                                        │
│  - reportId (fonte dati)                               │
│  - type: 'pivot' | 'chart' | 'kpi'                     │
│  - config: PivotConfig | ChartConfig | KPIConfig       │
└─────────────────────────────────────────────────────────┘
```

### 3.4 Schema Configurazione Grafico

```typescript
interface ChartConfig {
  type: 'bar' | 'line' | 'pie' | 'scatter' | 'area' | 'treemap' | 'gauge' | 'kpi';

  // Mappatura dati
  dimensions: string[];      // Campi per assi X / categorie
  metrics: MetricConfig[];   // Campi per valori Y
  splitBy?: string;          // Campo per serie multiple

  // Stile
  title?: string;
  subtitle?: string;
  legend: {
    show: boolean;
    position: 'top' | 'bottom' | 'left' | 'right';
  };
  colors?: string[];         // Palette custom

  // Assi (per grafici cartesiani)
  xAxis?: {
    label?: string;
    type: 'category' | 'value' | 'time';
    format?: string;
  };
  yAxis?: {
    label?: string;
    min?: number;
    max?: number;
    format?: string;
  };

  // Interattività
  tooltip: boolean;
  zoom: boolean;
  brush: boolean;            // Selezione range

  // Export
  downloadable: boolean;
}
```

### 3.5 Componente React con ECharts

```tsx
// components/BiChart.tsx
import ReactECharts from 'echarts-for-react';
import { useEffect, useState } from 'react';

interface BiChartProps {
  reportId: number;
  config: ChartConfig;
  filters?: Record<string, any>;
  onDrillDown?: (item: any) => void;
}

function BiChart({ reportId, config, filters, onDrillDown }: BiChartProps) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    // Riutilizza la stessa API del pivot
    fetchChartData(reportId, config, filters)
      .then(setData)
      .finally(() => setLoading(false));
  }, [reportId, config, filters]);

  const option = buildEChartsOption(config, data);

  return (
    <ReactECharts
      option={option}
      style={{ height: '100%', width: '100%' }}
      onEvents={{
        click: (params) => onDrillDown?.(params.data)
      }}
      showLoading={loading}
      opts={{ renderer: 'canvas' }} // Canvas per performance
    />
  );
}

function buildEChartsOption(config: ChartConfig, data: any[]): EChartsOption {
  // Costruisce opzione ECharts basata su config
  switch (config.type) {
    case 'bar':
      return buildBarChart(config, data);
    case 'line':
      return buildLineChart(config, data);
    case 'pie':
      return buildPieChart(config, data);
    // ... altri tipi
  }
}
```

### 3.6 Editor Configurazione Grafico

UI simile a BiGridConfig ma per grafici:

```
┌────────────────────────────────────────┐
│ Tipo Grafico: [Barre ▼]                │
├────────────────────────────────────────┤
│ DIMENSIONI (Asse X / Categorie)        │
│ ┌────────────────────────────────────┐ │
│ │ [Articolo]                         │ │
│ └────────────────────────────────────┘ │
│                                        │
│ METRICHE (Asse Y / Valori)             │
│ ┌────────────────────────────────────┐ │
│ │ [Venduto] [SUM ▼]                  │ │
│ │ [Costo] [SUM ▼]                    │ │
│ └────────────────────────────────────┘ │
│                                        │
│ SERIE (Colori diversi per...)          │
│ ┌────────────────────────────────────┐ │
│ │ [Anno]                             │ │
│ └────────────────────────────────────┘ │
│                                        │
│ [Opzioni Avanzate ▼]                   │
│ ☑ Mostra legenda                       │
│ ☑ Abilita tooltip                      │
│ ☐ Abilita zoom                         │
└────────────────────────────────────────┘
```

### 3.7 Integrazione con Dashboard

La dashboard dovrà supportare:
- Griglia drag & drop per posizionare widget
- Resize dei widget
- Mix di pivot table e grafici
- Filtri globali che si applicano a tutti i widget
- Cross-filtering (click su grafico filtra altri widget)

### 3.8 Stima Effort

| Componente | Giorni |
|------------|--------|
| Setup ECharts | 1 |
| Componente BiChart base | 2-3 |
| Editor configurazione | 3-4 |
| Tipi grafici Fase 1 (4 tipi) | 3-4 |
| Integrazione Dashboard | 3-4 |
| Cross-filtering | 2-3 |
| Export PNG/PDF | 1-2 |
| Testing | 2 |
| **Totale Fase 1** | **17-23 giorni** |

---

## 4. Confronto con Power BI

### 4.1 Funzionalità Power BI vs INFOBI 4.0

| Funzionalità | Power BI | INFOBI 4.0 Attuale | Gap | Priorità |
|--------------|----------|-------------------|-----|----------|
| **Connessioni Dati** |
| SQL Server/PostgreSQL | ✅ | ✅ | - | - |
| Excel/CSV import | ✅ | ❌ | Alto | Media |
| API REST | ✅ | ❌ | Alto | Bassa |
| Real-time streaming | ✅ | ❌ | Alto | Bassa |
| **Modellazione** |
| Relazioni tra tabelle | ✅ | ❌ | Alto | Alta |
| Colonne calcolate | ✅ | ❌ | Alto | **Alta** |
| Misure DAX | ✅ | ❌ | Alto | Media |
| Gerarchie | ✅ | Parziale | Medio | Media |
| **Visualizzazioni** |
| Tabella/Matrice | ✅ | ✅ | - | - |
| Grafici base | ✅ | ❌ | Alto | **Alta** |
| KPI/Card | ✅ | ❌ | Alto | Alta |
| Mappe | ✅ | ❌ | Alto | Bassa |
| Custom visuals | ✅ | ❌ | Alto | Bassa |
| **Interattività** |
| Cross-filtering | ✅ | ❌ | Alto | Alta |
| Drill-down | ✅ | Parziale | Medio | Media |
| Slicer/Filtri | ✅ | ✅ | - | - |
| Bookmarks | ✅ | ❌ | Medio | Bassa |
| **Collaborazione** |
| Condivisione dashboard | ✅ | Parziale | Medio | Alta |
| Commenti | ✅ | ❌ | Medio | Bassa |
| Subscription/Alert | ✅ | ❌ | Alto | Media |
| **Sicurezza** |
| Row-Level Security | ✅ | ❌ | **CRITICO** | **URGENTE** |
| Ruoli e permessi | ✅ | Parziale | **CRITICO** | **URGENTE** |
| **Mobile** |
| App mobile | ✅ | ❌ | Alto | Bassa |
| Responsive | ✅ | Parziale | Medio | Media |
| **AI/ML** |
| Q&A (linguaggio naturale) | ✅ | ❌ | Alto | Bassa |
| Insights automatici | ✅ | ❌ | Alto | Bassa |
| Anomaly detection | ✅ | ❌ | Alto | Bassa |

### 4.2 Funzionalità Mancanti Critiche (Priorità URGENTE)

#### 1. **Sistema Permessi Avanzato** (VULNERABILITÀ ATTUALE)

> **PROBLEMA CRITICO IDENTIFICATO**: Nel codice attuale (`connections.py`), qualsiasi utente con ruolo `admin` può eliminare le connessioni al database. Questo è un rischio di sicurezza.

```python
# CODICE ATTUALE (VULNERABILE)
@router.delete("/{conn_id}")
async def delete_connection(..., user = Depends(get_current_admin)):
    # CHIUNQUE sia admin può cancellare!
```

**SOLUZIONE**: Implementare la gerarchia Superuser > Admin > User (vedi sezione 5).

#### 2. **Row-Level Security (RLS)**

> **NOTA ARCHITETTURALE**: Il connection pool è condiviso globalmente (`_engines` in `engine_pool.py`). La RLS NON può essere implementata a livello database (utenti DB diversi) ma deve essere implementata logicamente nel backend.

Vedi sezione 6.

#### 3. **Colonne Calcolate e Misure**
Vedi sezione 1.

#### 4. **Grafici**
Vedi sezione 3.

### 4.3 Funzionalità Power BI NON Necessarie per INFOBI

- **Power Query M**: Troppo complesso, meglio SQL diretto
- **Custom Visuals Marketplace**: Over-engineering
- **Paginated Reports**: Casi d'uso limitati
- **AI/ML Features**: Fase molto futura

### 4.4 Vantaggio Competitivo INFOBI

INFOBI può differenziarsi da Power BI su:

1. **Semplicità**: UI più semplice e immediata
2. **Performance**: Polars + Arrow IPC + Dragonfly cache
3. **Costo**: Nessun licensing per utente
4. **Self-hosted**: Dati rimangono on-premise
5. **Personalizzazione**: Codice sorgente modificabile

---

## 5. Sistema Permessi e Ruoli

> **PRIORITÀ: URGENTE** - Questo è un prerequisito di sicurezza.

### 5.1 Problema Attuale

Nel file `backend/app/api/connections.py`:
```python
@router.delete("/{conn_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_connection(
    conn_id: int,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_admin)  # <-- VULNERABILITÀ
):
```

**Rischio**: Se dai l'utente `admin` al cliente per gestire i suoi utenti, lui può inavvertitamente (o dolosamente) cancellare la connessione al database di produzione.

### 5.2 Gerarchia Ruoli Proposta

```
┌─────────────────────────────────────────────────────────────┐
│                      SUPERUSER                               │
│                    (infostudio)                              │
│  ─────────────────────────────────────────────────────────  │
│  • Accesso completo a tutto il sistema                      │
│  • Gestione connessioni database                            │
│  • Gestione report/query                                    │
│  • Gestione utenti (inclusi admin)                          │
│  • Non può essere eliminato/modificato da altri             │
│  • Unico account con questi privilegi                       │
│  • Credenziali: infostudio / Infostudi0++                   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     ADMINISTRATOR                            │
│  ─────────────────────────────────────────────────────────  │
│  • NON può vedere/gestire connessioni                       │
│  • NON può vedere/gestire report                            │
│  • PUÒ creare dashboard                                     │
│  • PUÒ assegnare dashboard a utenti                         │
│  • PUÒ gestire utenti (solo ruolo USER)                     │
│  • NON può gestire altri admin o superuser                  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                        USER                                  │
│  ─────────────────────────────────────────────────────────  │
│  • PUÒ vedere SOLO le dashboard assegnate                   │
│  • PUÒ interagire con i report nelle dashboard assegnate    │
│  • NON può creare/modificare nulla                          │
│  • NON può vedere menu amministrativi                       │
└─────────────────────────────────────────────────────────────┘
```

### 5.3 Matrice Permessi Dettagliata

| Azione | SUPERUSER | ADMIN | USER |
|--------|-----------|-------|------|
| **Connessioni** |
| Visualizza lista | ✅ | ❌ | ❌ |
| Crea connessione | ✅ | ❌ | ❌ |
| Modifica connessione | ✅ | ❌ | ❌ |
| Elimina connessione | ✅ | ❌ | ❌ |
| **Report** |
| Visualizza lista | ✅ | ❌ | ❌ |
| Crea report | ✅ | ❌ | ❌ |
| Modifica report | ✅ | ❌ | ❌ |
| Elimina report | ✅ | ❌ | ❌ |
| **Dashboard** |
| Visualizza tutte | ✅ | ✅ | ❌ |
| Visualizza assegnate | ✅ | ✅ | ✅ |
| Crea dashboard | ✅ | ✅ | ❌ |
| Modifica dashboard | ✅ | ✅* | ❌ |
| Elimina dashboard | ✅ | ✅* | ❌ |
| Assegna a utenti | ✅ | ✅ | ❌ |
| **Utenti** |
| Visualizza tutti | ✅ | ✅** | ❌ |
| Crea utente | ✅ | ✅*** | ❌ |
| Modifica utente | ✅ | ✅*** | ❌ |
| Elimina utente | ✅ | ✅*** | ❌ |
| Modifica superuser | ✅ | ❌ | ❌ |
| Modifica admin | ✅ | ❌ | ❌ |
| **Menu Visibili** |
| Connessioni | ✅ | ❌ | ❌ |
| Report | ✅ | ❌ | ❌ |
| Dashboard | ✅ | ✅ | ✅**** |
| Utenti | ✅ | ✅ | ❌ |

```
*    Solo dashboard create da loro
**   Solo utenti con ruolo USER
***  Solo utenti con ruolo USER
**** Solo dashboard assegnate, in modalità sola lettura
```

### 5.4 Schema Database Aggiornato

```sql
-- Tabella utenti aggiornata
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('superuser', 'admin', 'user')),
    is_system_account BOOLEAN DEFAULT FALSE,  -- true solo per infostudio
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    last_login TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE
);

-- Assegnazione dashboard a utenti
CREATE TABLE dashboard_assignments (
    id SERIAL PRIMARY KEY,
    dashboard_id INTEGER REFERENCES dashboards(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    assigned_by INTEGER REFERENCES users(id),
    assigned_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(dashboard_id, user_id)
);

-- Audit log per tracciare modifiche
CREATE TABLE audit_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id INTEGER,
    old_value JSONB,
    new_value JSONB,
    ip_address VARCHAR(45),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Inserimento account superuser di sistema
INSERT INTO users (username, email, password_hash, role, is_system_account)
VALUES (
    'infostudio',
    'infostudio@system.local',
    '$2b$12$...hash_di_Infostudi0++...',
    'superuser',
    TRUE
);
```

### 5.5 Modifiche Backend Richieste

```python
# core/deps.py - NUOVE DIPENDENZE

async def get_current_superuser(
    current_user: User = Depends(get_current_user)
) -> User:
    """Richiede ruolo SUPERUSER."""
    if current_user.role != 'superuser':
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Superuser access required"
        )
    return current_user

async def get_current_admin_or_superuser(
    current_user: User = Depends(get_current_user)
) -> User:
    """Richiede ruolo ADMIN o SUPERUSER."""
    if current_user.role not in ['admin', 'superuser']:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )
    return current_user


# api/connections.py - CORREZIONE VULNERABILITÀ

@router.delete("/{conn_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_connection(
    conn_id: int,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_superuser)  # <-- CORRETTO: solo superuser
):
    # Solo superuser può eliminare connessioni
    ...

@router.post("/", response_model=ConnectionResponse)
async def create_connection(
    conn: ConnectionCreate,
    db: AsyncSession = Depends(get_db),
    user = Depends(get_current_superuser)  # <-- CORRETTO: solo superuser
):
    ...
```

### 5.6 Stima Effort

| Componente | Giorni |
|------------|--------|
| Schema database + migrazione | 1-2 |
| Backend permissions middleware | 2-3 |
| API endpoints update | 2-3 |
| Frontend navigation dinamico | 1-2 |
| Frontend route protection | 1-2 |
| Dashboard assignment UI | 2-3 |
| Testing permessi | 2-3 |
| **Totale** | **11-18 giorni** |

---

## 6. Row-Level Security (RLS)

> **NOTA ARCHITETTURALE CRITICA**: Il connection pool è condiviso (`_engines` globale). La RLS deve essere implementata a livello applicativo, NON delegata al database.

### 6.1 Problema

```python
# engine_pool.py - Pool CONDIVISO
_engines: Dict[str, Engine] = {}  # Singleton globale

def get_engine(db_type: str, config: Dict) -> Engine:
    # Lo stesso engine è riutilizzato da TUTTI gli utenti
    ...
```

Questo significa che NON possiamo:
- Usare utenti database diversi per RLS
- Delegare la sicurezza al database

### 6.2 Soluzione: RLS Logica nel Backend

```python
# services/rls.py

from typing import Optional, Dict, List

class RLSEngine:
    """
    Row-Level Security implementata a livello applicativo.
    Aggiunge clausole WHERE forzate alle query.
    """

    @staticmethod
    async def get_user_filters(user_id: int, report_id: int) -> Dict[str, List]:
        """
        Recupera i filtri RLS per un utente su un report.

        Returns:
            Dict con campo -> valori permessi
            Es: {"regione": ["Nord", "Centro"], "divisione": ["IT"]}
        """
        # Query dalla tabella rls_rules
        rules = await db.execute(
            select(RLSRule).where(
                RLSRule.user_id == user_id,
                RLSRule.report_id == report_id
            )
        )

        filters = {}
        for rule in rules:
            if rule.field not in filters:
                filters[rule.field] = []
            filters[rule.field].append(rule.allowed_value)

        return filters

    @staticmethod
    def apply_rls_to_query(base_query: str, rls_filters: Dict[str, List]) -> str:
        """
        Aggiunge clausole WHERE forzate alla query.

        IMPORTANTE: Usa parameterized queries per sicurezza!
        """
        if not rls_filters:
            return base_query

        conditions = []
        for field, values in rls_filters.items():
            # Sanitizza field name
            safe_field = "".join(c for c in field if c.isalnum() or c == '_')

            if len(values) == 1:
                conditions.append(f"{safe_field} = :rls_{safe_field}")
            else:
                placeholders = ", ".join([f":rls_{safe_field}_{i}" for i in range(len(values))])
                conditions.append(f"{safe_field} IN ({placeholders})")

        where_clause = " AND ".join(conditions)

        # Wrappa la query originale
        return f"SELECT * FROM ({base_query}) AS _base WHERE {where_clause}"


# Integrazione in query_engine.py

async def execute_query_with_rls(
    user_id: int,
    report_id: int,
    db_type: str,
    config: dict,
    query: str,
    **kwargs
) -> tuple:
    """Esegue query con RLS applicata."""

    # 1. Recupera filtri RLS per l'utente
    rls_filters = await RLSEngine.get_user_filters(user_id, report_id)

    # 2. Applica RLS alla query
    secured_query = RLSEngine.apply_rls_to_query(query, rls_filters)

    # 3. Esegui query securizzata
    return await QueryEngine.execute_query(db_type, config, secured_query, **kwargs)
```

### 6.3 Schema Database RLS

```sql
-- Regole RLS per report
CREATE TABLE rls_rules (
    id SERIAL PRIMARY KEY,
    report_id INTEGER REFERENCES reports(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    field VARCHAR(100) NOT NULL,
    allowed_value VARCHAR(255) NOT NULL,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(report_id, user_id, field, allowed_value)
);

-- Esempio: Mario può vedere solo Regione Nord e Centro
INSERT INTO rls_rules (report_id, user_id, field, allowed_value, created_by)
VALUES
    (1, 5, 'regione', 'Nord', 1),
    (1, 5, 'regione', 'Centro', 1);
```

### 6.4 Stima Effort

| Componente | Giorni |
|------------|--------|
| Schema database RLS | 1 |
| Backend RLS Engine | 2-3 |
| Integrazione query_engine | 2 |
| UI gestione regole RLS | 3-4 |
| Testing | 2 |
| **Totale** | **10-14 giorni** |

---

## 7. Priorità e Roadmap Suggerita

> **REVISIONE**: Roadmap aggiornata con priorità corrette basate sull'analisi del codice.

### 7.1 Fase 1 - URGENTE: Sicurezza (1-2 settimane)

**PRIORITÀ MASSIMA** - Blocca distribuzione software senza questa fase.

1. **Sistema Permessi** (1 settimana)
   - Migrazione account admin → infostudio
   - Implementazione ruoli SUPERUSER/ADMIN/USER
   - Protezione endpoint `connections.py` e `reports.py`
   - Menu frontend dinamico

2. **Dashboard Assignment** (0.5 settimane)
   - UI assegnazione dashboard a utenti
   - Filtro visibilità dashboard per ruolo

### 7.2 Fase 2 - Grafici (1-2 settimane)

**VALORE IMMEDIATO** - Gli utenti vogliono vedere grafici.

1. **Setup ECharts** (2-3 giorni)
   - Installazione `echarts-for-react`
   - Componente BiChart base

2. **Grafici Fase 1** (1 settimana)
   - Barre, linee, torta, KPI card
   - Editor configurazione base
   - Integrazione dashboard

### 7.3 Fase 3 - Colonne Calcolate (2 settimane)

**POTENZA ANALITICA** - Usando Polars.

1. **Parser Espressioni** (1 settimana)
   - Mapping sintassi utente → Polars expressions
   - Validazione sicura

2. **UI e Integrazione** (1 settimana)
   - Editor colonne calcolate
   - Integrazione BiGridConfig

### 7.4 Fase 4 - Confronti Split (1 settimana)

**CILIEGINA** - Completa il pivot.

1. **Backend Polars** (2-3 giorni)
2. **UI Configurazione** (2-3 giorni)
3. **Formattazione condizionale** (1-2 giorni)

### 7.5 Fase 5 - Enterprise (4+ settimane)

1. **Row-Level Security** (2 settimane)
2. **Cross-filtering dashboard** (1 settimana)
3. **Import Excel/CSV** (1-2 settimane)
4. **Export avanzato** (1 settimana)

### 7.6 Timeline Complessiva RIVISTA

```
Settimana 1:     Sistema Permessi (URGENTE)
Settimana 2:     Grafici ECharts
Settimana 3-4:   Colonne Calcolate (Polars)
Settimana 5:     Confronti Split
Settimana 6-7:   Row-Level Security
Settimana 8+:    Enterprise Features
```

---

## Appendice A: Riferimenti Tecnici

### Librerie Consigliate (AGGIORNATE)

| Funzionalità | Libreria | NPM/PyPI |
|--------------|----------|----------|
| Grafici | **ECharts** | `echarts`, `echarts-for-react` |
| Grid Layout | react-grid-layout | `react-grid-layout` |
| Expression Parser | lark-parser (Python) | `lark` |
| Date handling | date-fns | `date-fns` |
| Number formatting | numeral | `numeral` |
| Data processing | **Polars** (già presente) | `polars` |

### API Endpoint da Creare

```
# Colonne Calcolate
POST   /api/calculated-columns          # Crea colonna calcolata
GET    /api/reports/{id}/columns        # Lista colonne (incluse calcolate)
DELETE /api/calculated-columns/{id}     # Elimina

# Dashboard Assignment
POST   /api/dashboards/{id}/assign      # Assegna dashboard a utenti
GET    /api/dashboards/assigned         # Dashboard assegnate all'utente corrente
DELETE /api/dashboards/{id}/assign/{user_id}  # Rimuovi assegnazione

# Grafici
POST   /api/charts/data                 # Dati per grafico

# RLS
GET    /api/reports/{id}/rls            # Regole RLS per report
POST   /api/reports/{id}/rls            # Crea regola RLS
DELETE /api/rls/{id}                    # Elimina regola
```

---

## Appendice B: Crediti Revisione

Questo documento è stato revisionato incorporando feedback tecnici da:
- **Gemini 3 Pro Preview** - Analisi architetturale e raccomandazioni Polars
- **Claude Opus 4.5** - Implementazione originale e aggiornamenti

Punti chiave della revisione:
1. ✅ Sostituito Pandas con Polars per colonne calcolate
2. ✅ Confermato ECharts per performance su grandi dataset
3. ✅ Evidenziata vulnerabilità in `connections.py`
4. ✅ Documentata limitazione RLS per pool condiviso
5. ✅ Riordinata roadmap con sicurezza come priorità #1

---

**Fine Documento**
