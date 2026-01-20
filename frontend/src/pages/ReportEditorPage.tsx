/**
 * Report Editor with Pivot Configuration Preview
 *
 * WORKFLOW:
 * 1. User writes SQL query + tests it
 * 2. Click "Configure Pivot" → Shows preview with LIMIT 100 rows
 * 3. Configure pivot dimensions (rows, columns, values) in sidebar
 * 4. Save config → Stored in DB, loaded by /reports/:id/pivot
 */
import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Save, Loader2, Play, CheckCircle, XCircle, AlertCircle, Settings, Eye } from 'lucide-react';
import BiGrid from '../components/BiGrid';
import BiGridConfig from '../components/BiGridConfig';
import TreeDataGrid from '../components/TreeDataGrid';

interface ColumnInfo {
  name: string;
  type: 'string' | 'number' | 'date';
  label?: string;
}

interface MetricConfig {
  id: string;
  name: string;
  field: string;
  aggregation: 'SUM' | 'AVG' | 'COUNT' | 'MIN' | 'MAX';
}

interface PivotConfig {
  rows: string[];        // groupBy
  columns: string[];     // splitBy
  values: MetricConfig[]; // metrics
  /* STARTED NEW FEATURE: OrderBy/FilterBy */
  orderBy?: { field: string; direction: 'asc' | 'desc' }[];
  filters?: { field: string; type: string; value: any }[];
  /* END NEW FEATURE */
}

export default function ReportEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id;

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connections, setConnections] = useState<any[]>([]);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    columns?: string[];
  } | null>(null);

  // Form state
  const [form, setForm] = useState({
    name: '',
    description: '',
    connection_id: 0,
    query: '',
    cache_enabled: true,
    cache_ttl: 3600
  });

  // Pivot configuration mode
  const [showPivotConfig, setShowPivotConfig] = useState(false);
  const [schema, setSchema] = useState<{ columns: ColumnInfo[] } | null>(null);
  const [pivotConfig, setPivotConfig] = useState<PivotConfig>({
    rows: [],
    columns: [],
    values: [],
    orderBy: [],
    filters: []
  });

  const getToken = () => localStorage.getItem('token');

  useEffect(() => {
    loadConnections();
    if (!isNew) loadReport();
  }, [id]);

  const loadConnections = async () => {
    try {
      const res = await fetch('/api/connections', {
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
      const data = await res.json();
      setConnections(data);
      if (data.length > 0 && !form.connection_id) {
        setForm(f => ({ ...f, connection_id: data[0].id }));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const loadReport = async () => {
    try {
      const res = await fetch(`/api/reports/${id}`, {
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
      const data = await res.json();
      setForm({
        name: data.name,
        description: data.description || '',
        connection_id: data.connection_id,
        query: data.query,
        cache_enabled: data.cache_enabled,
        cache_ttl: data.cache_ttl
      });
      setTestResult({ success: true, message: 'Query esistente' });

      // Load saved pivot config if exists
      try {
        const configRes = await fetch(`/api/pivot/${id}/config`, {
          headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (configRes.ok) {
          const savedConfig = await configRes.json();
          setPivotConfig(savedConfig);
        }
      } catch (err) {
        console.log('No saved pivot config');
      }

    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleTestQuery = async () => {
    if (!form.connection_id || !form.query.trim()) return;

    setTesting(true);
    setTestResult(null);

    try {
      const res = await fetch('/api/reports/test-query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify({
          connection_id: form.connection_id,
          query: form.query
        })
      });

      const data = await res.json();

      if (res.ok) {
        setTestResult({
          success: true,
          message: `${data.row_count} righe`,
          columns: data.columns
        });
      } else {
        setTestResult({
          success: false,
          message: data.detail || 'Errore'
        });
      }
    } catch (err: any) {
      setTestResult({ success: false, message: err.message });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.query.trim() || !testResult?.success) return;

    setSaving(true);
    try {
      const res = await fetch(isNew ? '/api/reports' : `/api/reports/${id}`, {
        method: isNew ? 'POST' : 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify({
          ...form,
          default_group_by: [],
          default_metrics: [],
          available_metrics: []
        })
      });

      if (res.ok) {
        const data = await res.json();
        navigate(`/reports/${data.id}/pivot`);
      } else {
        const err = await res.json();
        alert(err.detail || 'Errore');
      }
    } catch (err) {
      alert('Errore nel salvataggio');
    } finally {
      setSaving(false);
    }
  };

  const handleConfigurePivot = async () => {
    if (!id) {
      alert('Salva prima il report per configurare il pivot');
      return;
    }

    // Load schema for pivot configuration
    try {
      const schemaRes = await fetch(`/api/pivot/${id}/schema`, {
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
      if (!schemaRes.ok) throw new Error('Schema non disponibile');
      const schemaData = await schemaRes.json();
      setSchema(schemaData);

      // Try to load existing config
      try {
          const configRes = await fetch(`/api/pivot/${id}/config`, {
            headers: { 'Authorization': `Bearer ${getToken()}` }
          });
          
          if (configRes.ok) {
              const savedConfig = await configRes.json();
              if (savedConfig.rows?.length > 0 || savedConfig.columns?.length > 0 || savedConfig.values?.length > 0) {
                  console.log("Loaded saved pivot config");
                  setPivotConfig(savedConfig);
                  setShowPivotConfig(true);
                  return;
              }
          }
      } catch (e) {
          console.log("No saved config found or error", e);
      }

      // Fallback: Auto-populate Columns with ALL fields for immediate flat table view
      // User can then remove fields, add grouping, split columns, etc.
      const allFieldsAsMetrics: MetricConfig[] = schemaData.columns.map((col: ColumnInfo, idx: number) => ({
        id: `metric-${idx}`,
        name: col.label || col.name,
        field: col.name,
        // Use appropriate aggregation based on column type:
        // - Numeric fields: SUM (default for aggregations)
        // - String/Date fields: MAX (first value in group - works for flat table too)
        aggregation: (col.type === 'number' ? 'SUM' : 'MAX') as 'SUM' | 'AVG' | 'COUNT' | 'MIN' | 'MAX'
      }));

      setPivotConfig({
        rows: [],       // No grouping initially
        columns: [],    // No split initially
        values: allFieldsAsMetrics,  // ALL fields visible in flat table
        /* STARTED NEW FEATURE: OrderBy/FilterBy */
        orderBy: [],
        filters: []
        /* END NEW FEATURE */
      });

      setShowPivotConfig(true);
    } catch (err: any) {
      alert('Errore caricamento schema: ' + err.message);
    }
  };

  const handleSavePivotConfig = async () => {
    if (!id) return;

    try {
      const res = await fetch(`/api/pivot/${id}/config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify(pivotConfig)
      });

      if (res.ok) {
        alert('Configurazione pivot salvata!');
      } else {
        const err = await res.json();
        alert(err.detail || 'Errore');
      }
    } catch (err) {
      alert('Errore nel salvataggio configurazione');
    }
  };

  const handleGoToFullReport = async () => {
    if (!id) return;

    // Auto-save config before navigating
    try {
      await fetch(`/api/pivot/${id}/config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify(pivotConfig)
      });
      
      // Navigate after successful save
      navigate(`/reports/${id}/pivot`);
    } catch (err) {
      console.error('Error auto-saving config:', err);
      // Navigate anyway - user can reconfigure
      navigate(`/reports/${id}/pivot`);
    }
  };

  const handleConfigChange = (newConfig: PivotConfig) => {
    setPivotConfig(newConfig);
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  // PIVOT CONFIGURATION VIEW (with preview using LIMIT 100)
  if (showPivotConfig && schema && id) {
    return (
      <div className="h-full flex flex-col bg-slate-50">
        {/* Header */}
        <div className="bg-white border-b px-4 py-3 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowPivotConfig(false)}
              className="p-2 hover:bg-slate-100 rounded-lg"
            >
              <ArrowLeft className="w-5 h-5 text-slate-600" />
            </button>
            <div>
              <h1 className="font-semibold text-slate-800">{form.name} - Configurazione Pivot</h1>
              <p className="text-xs text-amber-600 font-medium">
                PREVIEW MODE: Mostrando solo 100 righe per configurazione veloce
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSavePivotConfig}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition"
            >
              <Save className="w-4 h-4" />
              Salva Config
            </button>
            <button
              onClick={handleGoToFullReport}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-green-600 hover:bg-green-700 text-white transition"
            >
              <Eye className="w-4 h-4" />
              Vedi Report Completo
            </button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Config Sidebar */}
          <BiGridConfig
            availableColumns={schema.columns}
            config={pivotConfig as any}
            onChange={handleConfigChange as any}
          />

          {/* Preview Grid (LIMIT 100 rows) */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1">
              <TreeDataGrid
                reportId={parseInt(id!)}
                rowGroups={pivotConfig.rows || []}
                valueCols={pivotConfig.values || []}
                pivotCols={pivotConfig.columns || []}
                previewMode={true}
                orderBy={pivotConfig.orderBy || []}
                filters={pivotConfig.filters || []}
                having={pivotConfig.having || []}
              />
            </div>
          </div>
        </div>

        {/* Status Bar */}
        <div className="bg-amber-100 border-t border-amber-300 px-4 py-2 flex items-center justify-between text-xs flex-shrink-0">
          <div className="flex items-center gap-2 text-amber-800">
            <AlertCircle className="w-4 h-4" />
            <strong>MODALITÀ PREVIEW:</strong> Configurazione su campione di 100 righe. Salva per vedere tutti i dati.
          </div>
          <div className="flex items-center gap-4 text-amber-700">
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
        </div>
      </div>
    );
  }

  // QUERY EDITOR VIEW (default)
  return (
    <div className="h-full flex flex-col bg-slate-50">
      <div className="bg-white border-b px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          <Link to="/reports" className="p-2 hover:bg-slate-100 rounded-lg">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-xl font-bold">{isNew ? 'Nuovo Report' : 'Modifica Report'}</h1>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">

          <div className="bg-white rounded-xl border p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium mb-1">Nome *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg"
                  placeholder="Vendite per Agente"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Connessione</label>
                <select
                  value={form.connection_id}
                  onChange={e => setForm({ ...form, connection_id: parseInt(e.target.value) })}
                  className="w-full px-4 py-2 border rounded-lg"
                >
                  {connections.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Descrizione</label>
              <input
                type="text"
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg"
              />
            </div>
          </div>

          <div className="bg-white rounded-xl border p-6">
            <div className="flex justify-between mb-4">
              <h2 className="font-semibold">Query SQL</h2>
              <button
                onClick={handleTestQuery}
                disabled={testing || !form.query.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg disabled:bg-slate-300"
              >
                {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Testa
              </button>
            </div>

            <textarea
              value={form.query}
              onChange={e => { setForm({ ...form, query: e.target.value }); setTestResult(null); }}
              className="w-full h-64 px-4 py-3 font-mono text-sm border rounded-lg bg-slate-50"
              placeholder={`SELECT
    rtrim(MVDESAGE) as Agente,
    CAST(DATEPART(year, mvDatDoc) AS VARCHAR) as Anno,
    isnull(TOTVEN,0) as Venduto,
    isnull(costoe,0) as Costo
FROM SEP01INFOVBI
WHERE mvDatDoc >= '2023-01-01'`}
            />

            {testResult && (
              <div className={`mt-4 p-4 rounded-lg flex items-start gap-3 ${
                testResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
              } border`}>
                {testResult.success ? <CheckCircle className="w-5 h-5 text-green-600" /> : <XCircle className="w-5 h-5 text-red-600" />}
                <div>
                  <p className={testResult.success ? 'text-green-800' : 'text-red-800'}>{testResult.message}</p>
                  {testResult.columns && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {testResult.columns.map(col => (
                        <span key={col} className="px-2 py-0.5 bg-white border rounded text-xs font-mono">{col}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
              <AlertCircle className="w-4 h-4 inline mr-2" />
              <strong>Importante:</strong> Scrivi query SENZA GROUP BY. L'aggregazione si fa nel pivot.
            </div>
          </div>

          <div className="bg-white rounded-xl border p-6">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.cache_enabled}
                  onChange={e => setForm({ ...form, cache_enabled: e.target.checked })}
                  className="w-4 h-4 rounded"
                />
                Cache
              </label>
              {form.cache_enabled && (
                <select
                  value={form.cache_ttl}
                  onChange={e => setForm({ ...form, cache_ttl: parseInt(e.target.value) })}
                  className="px-3 py-1 border rounded text-sm"
                >
                  <option value={300}>5 min</option>
                  <option value={1800}>30 min</option>
                  <option value={3600}>1 ora</option>
                  <option value={86400}>24 ore</option>
                </select>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border-t px-6 py-4">
        <div className="max-w-4xl mx-auto flex justify-between">
          <Link to="/reports" className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg">
            Annulla
          </Link>
          <div className="flex gap-2">
            {!isNew && testResult?.success && (
              <button
                onClick={handleConfigurePivot}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
              >
                <Settings className="w-4 h-4" />
                Configura Pivot
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={saving || !form.name || !form.query || !testResult?.success}
              className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-lg disabled:bg-slate-300"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {isNew ? 'Crea Report' : 'Salva'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
