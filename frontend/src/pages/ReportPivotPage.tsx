/**
 * ReportPivotPage - Advanced Pivot with Multi-Level Column Hierarchy
 *
 * This page demonstrates the new BiGrid component with:
 * - Drag & drop pivot configuration
 * - Multi-level column hierarchies
 * - Perfect column alignment
 * - Server-side aggregation
 */
import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { logger } from '../utils/logger';
import { apiFetch } from '../services/apiClient';
import TreeDataGrid from '../components/TreeDataGrid';
import BiGridConfig from '../components/BiGridConfig';
import {
  ArrowLeft, Download, Settings, Loader2,
  ChevronRight, Save, LayoutGrid, Edit, Sparkles, Lightbulb, X, ThumbsUp, ThumbsDown, AlertTriangle
} from 'lucide-react';

interface ColumnInfo {
  name: string;
  type: 'string' | 'number' | 'date';
  label?: string;
}

interface PivotConfig {
  rows: string[];        // groupBy
  columns: string[];     // splitBy
  values: MetricConfig[]; // metrics
  /* STARTED NEW FEATURE: OrderBy/FilterBy */
  orderBy?: { field: string; direction: 'asc' | 'desc' }[];
  filters?: { field: string; type: string; value: any }[];
  /* END NEW FEATURE */
  having?: { field: string; aggregation: string; type: string; value: any }[];
}

interface MetricConfig {
  id: string;
  name: string;
  field: string;
  aggregation: 'SUM' | 'AVG' | 'COUNT' | 'MIN' | 'MAX';
}

export default function ReportPivotPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuthStore();
  const reportId = parseInt(id || '0');

  const [report, setReport] = useState<any>(null);
  const [schema, setSchema] = useState<{ columns: ColumnInfo[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);
  const [pivotConfig, setPivotConfig] = useState<PivotConfig>({
    rows: [],
    columns: [],
    values: [],
    orderBy: [],
    filters: []
  });

  // NL -> Pivot (AI)
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState<{ type: 'info' | 'error'; text: string } | null>(null);
  const [insight, setInsight] = useState<string | null>(null);
  const [insightBusy, setInsightBusy] = useState(false);
  const [aiLogId, setAiLogId] = useState<number | null>(null);
  const [feedbackGiven, setFeedbackGiven] = useState(false);
  const [anomBusy, setAnomBusy] = useState(false);

  // Load report and schema
  useEffect(() => {
    if (id) {
      loadReport();
    }
  }, [id]);

  const loadReport = async () => {
    setLoading(true);
    try {
      // Get report metadata
      const reportRes = await apiFetch(`/api/reports/${reportId}`);
      if (!reportRes.ok) throw new Error('Report non trovato');
      const reportData = await reportRes.json();
      setReport(reportData);

      // Get schema for pivot builder
      const schemaRes = await apiFetch(`/api/pivot/${reportId}/schema`);
      if (!schemaRes.ok) throw new Error('Schema non disponibile');
      const schemaData = await schemaRes.json();
      setSchema(schemaData);

      // Load SAVED pivot configuration from DB (if exists)
      let initialConfig: PivotConfig;
      try {
        const configRes = await apiFetch(`/api/pivot/${reportId}/config`);
        if (configRes.ok) {
          const savedConfig = await configRes.json();
          // Use saved config if it has data
          if (savedConfig.rows?.length > 0 || savedConfig.values?.length > 0) {
            initialConfig = savedConfig;
            logger.debug('✅ Loaded SAVED pivot config from DB:', savedConfig);
          } else {
            throw new Error('Empty config, use defaults');
          }
        } else {
          throw new Error('No saved config');
        }
      } catch (err) {
        // Fallback: Auto-populate ALL fields in Columns for immediate flat table view
        // User can then remove fields, add grouping, split columns, etc.
        logger.debug('⚠️ No saved config found, auto-populating all fields');

        const allFieldsAsMetrics = schemaData.columns.map((col: ColumnInfo, idx: number) => ({
          id: `metric-${idx}`,
          name: col.label || col.name,
          field: col.name,
          // Use appropriate aggregation based on column type:
          // - Numeric fields: SUM (default for aggregations)
          // - String/Date fields: MAX (first value in group - works for flat table too)
          aggregation: (col.type === 'number' ? 'SUM' : 'MAX') as 'SUM' | 'AVG' | 'COUNT' | 'MIN' | 'MAX'
        }));

        initialConfig = {
          rows: [],      // No grouping initially
          columns: [],   // No split initially
          values: allFieldsAsMetrics,  // ALL fields visible in flat table
          orderBy: [],   // No sorting initially
          filters: []    // No filters initially
        };
      }
      setPivotConfig(initialConfig);

    } catch (err: any) {
      console.error('Load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleConfigChange = (newConfig: PivotConfig) => {
    setPivotConfig(newConfig);
  };

  // Applica una config prodotta dall'AI alla pivot (stessa forma di setPivotConfig)
  const applyAiConfig = (cfg: any) => {
    setPivotConfig({
      rows: cfg.group_by || [],
      columns: cfg.split_by || [],
      values: (cfg.metrics || []).map((m: any, i: number) => ({
        id: `ai-${i}`,
        name: m.name,
        field: m.field,
        aggregation: m.aggregation,
      })),
      orderBy: [],
      filters: Object.entries(cfg.filters || {}).map(([field, def]: [string, any]) => ({
        field,
        type: def.type,
        value: def.value ?? def.values,
      })),
      having: [],
    });
  };

  // Genera una narrazione AI dei dati aggregati della vista corrente
  const handleInsight = async () => {
    if (!pivotConfig.values.length) {
      setAiMsg({ type: 'error', text: 'Aggiungi almeno una misura per generare insight' });
      return;
    }
    setInsightBusy(true);
    setInsight(null);
    try {
      const filters: Record<string, any> = {};
      (pivotConfig.filters || []).forEach(f => {
        filters[f.field] = Array.isArray(f.value)
          ? { type: f.type, values: f.value }
          : { type: f.type, value: f.value };
      });
      const res = await apiFetch(`/api/ai/reports/${reportId}/insights`, {
        method: 'POST',
        body: JSON.stringify({
          group_by: pivotConfig.rows,
          metrics: pivotConfig.values.map(v => ({ name: v.name, field: v.field, aggregation: v.aggregation })),
          filters,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Errore AI');
      setInsight(data.narrative || 'Nessuna osservazione rilevante.');
    } catch (err: any) {
      setAiMsg({ type: 'error', text: err.message });
    } finally {
      setInsightBusy(false);
    }
  };

  // Rileva anomalie statistiche sulla prima misura della vista
  const handleAnomalies = async () => {
    if (!pivotConfig.rows.length || !pivotConfig.values.length) {
      setAiMsg({ type: 'error', text: 'Servono almeno una riga (dimensione) e una misura' });
      return;
    }
    setAnomBusy(true);
    setInsight(null);
    try {
      const m = pivotConfig.values[0];
      const res = await apiFetch(`/api/ai/reports/${reportId}/anomalies`, {
        method: 'POST',
        body: JSON.stringify({
          group_by: pivotConfig.rows,
          metric: { field: m.field, aggregation: m.aggregation, name: m.name },
          method: 'zscore',
          threshold: 3.0,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Errore');
      if (!data.count) {
        setInsight(`Nessuna anomalia su «${data.metric}» (media ${data.mean}, dev. std ${data.std}).`);
      } else {
        const lines = data.anomalies.slice(0, 10)
          .map((a: any) => `• ${a.label}: ${a.value} (${a.direction === 'high' ? '↑' : '↓'} z=${a.score})`)
          .join('\n');
        setInsight(`${data.count} anomalie su «${data.metric}» (media ${data.mean}, dev. std ${data.std}):\n${lines}`);
      }
    } catch (err: any) {
      setAiMsg({ type: 'error', text: err.message });
    } finally {
      setAnomBusy(false);
    }
  };

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = aiQuestion.trim();
    if (!q) return;
    setAiBusy(true);
    setAiMsg(null);
    try {
      const res = await apiFetch(`/api/ai/reports/${reportId}/ask`, {
        method: 'POST',
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Errore AI');
      applyAiConfig(data.config);
      setShowBuilder(true);
      setAiMsg({ type: 'info', text: data.explanation || 'Configurazione applicata.' });
      setAiLogId(data.log_id ?? null);
      setFeedbackGiven(false);
    } catch (err: any) {
      setAiMsg({ type: 'error', text: err.message });
      setAiLogId(null);
    } finally {
      setAiBusy(false);
    }
  };

  // Feedback sulla traduzione AI (chiude il loop di governance)
  const sendFeedback = async (helpful: boolean) => {
    if (!aiLogId) return;
    setFeedbackGiven(true);
    try {
      await apiFetch(`/api/ai/logs/${aiLogId}/feedback`, {
        method: 'POST',
        body: JSON.stringify({ helpful }),
      });
    } catch { /* non bloccante */ }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-surface-2">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-accent mx-auto mb-3" />
          <p className="text-muted">Caricamento...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-surface-2">
      {/* Header */}
      <div className="bg-surface border-b px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <Link to="/reports" className="p-2 hover:bg-ground rounded-lg">
            <ArrowLeft className="w-5 h-5 text-muted" />
          </Link>
          <div>
            <h1 className="font-disp font-bold text-lg tracking-tight text-ink flex items-center gap-2">
              <LayoutGrid className="w-5 h-5 text-accent" />
              {report?.name || 'Pivot'}
            </h1>
            <p className="text-xs text-muted">Pivot · gerarchia multi-livello</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Insight AI */}
          <button
            onClick={handleInsight}
            disabled={insightBusy}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-ground text-muted hover:bg-line transition disabled:opacity-50"
            title="Genera una narrazione AI dei dati della vista corrente"
          >
            {insightBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lightbulb className="w-4 h-4" />}
            Insight
          </button>

          {/* Anomalie */}
          <button
            onClick={handleAnomalies}
            disabled={anomBusy}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-ground text-muted hover:bg-line transition disabled:opacity-50"
            title="Rileva valori anomali sulla prima misura"
          >
            {anomBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
            Anomalie
          </button>

          {/* Toggle Builder */}
          <button
            onClick={() => setShowBuilder(!showBuilder)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
              showBuilder
                ? 'bg-accent-soft text-accent-strong'
                : 'bg-ground text-muted hover:bg-line'
            }`}
          >
            <Settings className="w-4 h-4" />
            Configurazione
          </button>

          {/* Edit Report (go to editor) - solo superuser */}
          {user?.role === 'superuser' && (
            <Link
              to={`/reports/${reportId}/edit`}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold text-white transition hover:brightness-110"
              style={{ background: 'linear-gradient(100deg,#7B6CF5,#6A8DF5)' }}
            >
              <Edit className="w-4 h-4" />
              Modifica
            </Link>
          )}
        </div>
      </div>

      {/* Barra AI: domanda in linguaggio naturale -> pivot */}
      <form onSubmit={handleAsk} className="bg-surface border-b px-4 py-2 flex items-center gap-2 flex-shrink-0">
        <Sparkles className="w-4 h-4 text-accent shrink-0" />
        <input
          value={aiQuestion}
          onChange={e => setAiQuestion(e.target.value)}
          placeholder="Chiedi in linguaggio naturale: es. «fatturato per regione»"
          className="flex-1 px-3 py-1.5 text-sm border border-line rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
        />
        {aiMsg && (
          <span className={`text-xs truncate max-w-[35%] ${aiMsg.type === 'error' ? 'text-neg' : 'text-muted'}`}>
            {aiMsg.text}
          </span>
        )}
        {aiLogId && aiMsg?.type === 'info' && (
          feedbackGiven ? (
            <span className="text-xs text-muted shrink-0">grazie!</span>
          ) : (
            <span className="flex items-center gap-1 shrink-0">
              <button type="button" onClick={() => sendFeedback(true)} title="Utile"
                className="p-1 rounded hover:bg-ground text-muted hover:text-pos">
                <ThumbsUp className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => sendFeedback(false)} title="Non utile"
                className="p-1 rounded hover:bg-ground text-muted hover:text-neg">
                <ThumbsDown className="w-4 h-4" />
              </button>
            </span>
          )
        )}
        <button
          type="submit"
          disabled={aiBusy || !aiQuestion.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-sm font-semibold disabled:opacity-50 hover:brightness-110 shrink-0"
          style={{ background: 'linear-gradient(100deg,#7B6CF5,#6A8DF5)' }}
        >
          {aiBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          Chiedi
        </button>
      </form>

      {/* Pannello narrazione AI */}
      {insight && (
        <div className="bg-accent-soft border-b border-accent px-4 py-3 flex items-start gap-3 flex-shrink-0">
          <Lightbulb className="w-4 h-4 text-accent-strong mt-0.5 shrink-0" />
          <p className="flex-1 text-sm text-ink whitespace-pre-line">{insight}</p>
          <button onClick={() => setInsight(null)} className="p-1 hover:bg-surface rounded text-muted shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Compact Config Sidebar */}
        {showBuilder && schema && (
          <BiGridConfig
            availableColumns={schema.columns}
            config={pivotConfig as any}
            onChange={handleConfigChange as any}
          />
        )}

        {/* TreeDataGrid Container - Shows hierarchical data */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1">
            <TreeDataGrid
              reportId={reportId}
              rowGroups={pivotConfig.rows}
              orderBy={pivotConfig.orderBy}
              filters={pivotConfig.filters}
              having={pivotConfig.having || []}
              valueCols={pivotConfig.values}
              pivotCols={pivotConfig.columns}
              previewMode={false}
            />
          </div>
        </div>
      </div>

      {/* Status Bar */}
      <div className="bg-surface border-t px-4 py-2 flex items-center justify-between text-xs text-muted flex-shrink-0">
        <div className="flex items-center gap-4">
          <span>
            <strong>Righe:</strong> {pivotConfig.rows.length > 0 ? pivotConfig.rows.join(' → ') : 'Nessuna'}
          </span>
          <span>
            <strong>Colonne:</strong> {pivotConfig.columns.length > 0 ? pivotConfig.columns.join(' → ') : 'Nessuna'}
          </span>
          <span>
            <strong>Metriche:</strong> {pivotConfig.values.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-2 py-1 bg-green-100 text-pos rounded font-medium">
            Multi-Level ✓
          </span>
        </div>
      </div>
    </div>
  );
}
