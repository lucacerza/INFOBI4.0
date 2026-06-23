/**
 * ReportViewerPage - BI Report Overview
 * Shows report metadata and provides quick access to Pivot view
 */
import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import {
  ArrowLeft, Download, RefreshCw, Loader2, FileSpreadsheet,
  FileText, Clock, Database, Zap, Edit, LayoutGrid, Boxes, Tags, Sparkles, ShieldCheck
} from 'lucide-react';
import { apiFetch } from '../services/apiClient';

interface Report {
  id: number;
  name: string;
  description?: string;
  sql_query: string;
  connection_id: number;
  created_at?: string;
  updated_at?: string;
  pivot_config?: any;
}

export default function ReportViewerPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin' || user?.role === 'superuser';
  const isSuperuser = user?.role === 'superuser';
  const isSteward = user?.role === 'data_steward';
  const canGovern = isSuperuser || isSteward;   // gestione del semantic layer
  const reportId = parseInt(id || '0');

  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({ rows: 0, time: 0, cached: false });

  // Warehouse (DuckDB) state
  const [whDataset, setWhDataset] = useState<any | null>(null);
  const [whBacked, setWhBacked] = useState(false);
  const [whBusy, setWhBusy] = useState(false);
  const [whMode, setWhMode] = useState<'full' | 'incremental'>('full');
  const [whWatermark, setWhWatermark] = useState('');
  const [whKeys, setWhKeys] = useState('');

  // Semantic layer state
  const [semCols, setSemCols] = useState<any[]>([]);
  const [semBusy, setSemBusy] = useState(false);

  // NL -> Dashboard
  const [dashDesc, setDashDesc] = useState('');
  const [dashBusy, setDashBusy] = useState(false);

  // Load on mount
  useEffect(() => {
    if (id) {
      loadEverything();
    }
  }, [id]);

  const loadEverything = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Get report metadata only
      const reportRes = await apiFetch(`/api/reports/${reportId}`);
      if (!reportRes.ok) throw new Error('Report non trovato');
      const reportData = await reportRes.json();
      setReport(reportData);
      setWhBacked(!!reportData.warehouse_backed);

      // Stato warehouse (solo superuser può gestirlo)
      if (isSuperuser) {
        const whRes = await apiFetch('/api/warehouse');
        if (whRes.ok) {
          const datasets = await whRes.json();
          const found = datasets.find((d: any) => d.source_report_id === reportId) || null;
          setWhDataset(found);
          if (found) {
            setWhMode(found.sync_mode === 'incremental' ? 'incremental' : 'full');
            setWhWatermark(found.watermark_column || '');
            setWhKeys((found.key_columns || []).join(', '));
          }
        }
      }

      // Semantic layer: gestito da superuser e data steward
      if (canGovern) {
        const semRes = await apiFetch(`/api/semantic/reports/${reportId}`);
        if (semRes.ok) setSemCols(await semRes.json());
      }

    } catch (err: any) {
      console.error('Load error:', err);
      setError(err.message || 'Errore sconosciuto');
    } finally {
      setLoading(false);
    }
  };

  // Materializza / aggiorna il mart nel warehouse
  const handleMaterialize = async () => {
    setWhBusy(true);
    try {
      const body: any = { report_id: reportId, sync_mode: whMode };
      if (whMode === 'incremental') {
        body.watermark_column = whWatermark.trim();
        body.key_columns = whKeys.split(',').map(s => s.trim()).filter(Boolean);
      }
      const res = await apiFetch('/api/warehouse/from-report', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).detail || 'Errore');
      setWhDataset(await res.json());
    } catch (err: any) {
      alert(`Materializzazione fallita: ${err.message}`);
    } finally {
      setWhBusy(false);
    }
  };

  // Attiva/disattiva l'uso del warehouse per le query del report
  const handleToggleBacked = async () => {
    const next = !whBacked;
    setWhBusy(true);
    try {
      const res = await apiFetch(`/api/reports/${reportId}`, {
        method: 'PUT',
        body: JSON.stringify({ warehouse_backed: next }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || 'Errore');
      setWhBacked(next);
    } catch (err: any) {
      alert(`Aggiornamento fallito: ${err.message}`);
    } finally {
      setWhBusy(false);
    }
  };

  // Semantic: auto-rileva ruoli/tipi/aggregazioni dalle colonne reali
  const handleAutodetect = async () => {
    setSemBusy(true);
    try {
      const res = await apiFetch(`/api/semantic/reports/${reportId}/autodetect`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json()).detail || 'Errore');
      setSemCols(await res.json());
    } catch (err: any) {
      alert(`Auto-rilevamento fallito: ${err.message}`);
    } finally {
      setSemBusy(false);
    }
  };

  // Aggiorna localmente un campo (per input controllati prima del salvataggio)
  const setSemLocal = (column: string, field: string, value: any) =>
    setSemCols(cs => cs.map(c => (c.column_name === column ? { ...c, [field]: value } : c)));

  // Salva una modifica semantica sul backend
  const patchSem = async (column: string, patch: Record<string, any>) => {
    try {
      const res = await apiFetch(`/api/semantic/reports/${reportId}/columns/${encodeURIComponent(column)}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const updated = await res.json();
        setSemCols(cs => cs.map(c => (c.column_name === column ? updated : c)));
      }
    } catch { /* errore di rete: lascia lo stato locale */ }
  };

  // Genera una dashboard dai dati del report descrivendola a parole
  const handleGenerateDashboard = async (e: React.FormEvent) => {
    e.preventDefault();
    const desc = dashDesc.trim();
    if (!desc) return;
    setDashBusy(true);
    try {
      const res = await apiFetch(`/api/ai/reports/${reportId}/dashboard`, {
        method: 'POST',
        body: JSON.stringify({ description: desc }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Errore AI');
      navigate(`/dashboards/${data.dashboard_id}`);
    } catch (err: any) {
      alert(`Generazione dashboard fallita: ${err.message}`);
    } finally {
      setDashBusy(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await apiFetch(`/api/reports/${reportId}/refresh-cache`, { method: 'POST' });
      alert('Cache aggiornata! Ricarica la pagina pivot per vedere i nuovi dati.');
    } catch (err) {
      console.error('Refresh failed:', err);
      alert('Errore durante l\'aggiornamento della cache');
    } finally {
      setRefreshing(false);
    }
  };

  // Loading state
  if (loading && !report) {
    return (
      <div className="h-full flex items-center justify-center bg-surface-2">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-accent mx-auto mb-3" />
          <p className="text-muted">Caricamento...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !report) {
    return (
      <div className="h-full flex items-center justify-center bg-surface-2">
        <div className="text-center">
          <Database className="w-16 h-16 text-slate-300 mx-auto mb-4" />
          <p className="text-neg mb-2">{error}</p>
          <Link to="/reports" className="text-accent hover:underline">
            Torna ai report
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-surface-2">
      {/* Header */}
      <div className="bg-surface border-b px-4 py-3 flex items-center justify-between flex-shrink-0 z-10">
        <div className="flex items-center gap-3">
          <Link to="/reports" className="p-2 hover:bg-ground rounded-lg">
            <ArrowLeft className="w-5 h-5 text-muted" />
          </Link>
          <div>
            <h1 className="font-disp font-bold tracking-tight text-ink">{report?.name || 'Report'}</h1>
            {report?.description && <p className="text-xs text-muted">{report.description}</p>}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Pivot Avanzato */}
          <Link
            to={`/reports/${reportId}/pivot`}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white rounded-lg text-sm font-medium transition shadow-sm"
            title="Pivot con gerarchia multi-livello"
          >
            <LayoutGrid className="w-4 h-4" />
            Pivot Avanzato
          </Link>

          {/* Refresh */}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-2 hover:bg-ground rounded-lg"
            title="Aggiorna dati"
          >
            <RefreshCw className={`w-4 h-4 text-muted ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          
          {/* Export */}
          <div className="relative group">
            <button className="p-2 hover:bg-ground rounded-lg" title="Esporta">
              <Download className="w-4 h-4 text-muted" />
            </button>
            <div className="absolute right-0 top-full mt-1 w-32 bg-surface rounded-lg shadow-xl border opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-20">
              <a href={`/api/export/${reportId}/xlsx`} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface-2 rounded-t-lg">
                <FileSpreadsheet className="w-4 h-4 text-pos" />Excel
              </a>
              <a href={`/api/export/${reportId}/csv`} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface-2 rounded-b-lg">
                <FileText className="w-4 h-4 text-accent" />CSV
              </a>
            </div>
          </div>
          
          {/* Admin: Edit Query */}
          {isAdmin && (
            <>
              <div className="w-px h-6 bg-line mx-1" />
              
              <Link
                to={`/reports/${reportId}/edit`}
                className="flex items-center gap-2 px-3 py-1.5 bg-slate-600 hover:bg-slate-700 text-white rounded-lg text-sm font-medium transition"
                title="Modifica Query"
              >
                <Edit className="w-4 h-4" />
                Modifica
              </Link>
            </>
          )}
        </div>
      </div>
      
      {/* Main Content: Report Info Card */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-2xl w-full bg-surface rounded-xl shadow-lg p-8 text-center">
          <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <LayoutGrid className="w-10 h-10 text-white" />
          </div>
          
          <h2 className="text-2xl font-bold text-ink mb-3">{report?.name}</h2>
          
          {report?.description && (
            <p className="text-muted mb-8">{report.description}</p>
          )}
          
          <div className="flex flex-col gap-3 mb-8">
            <Link
              to={`/reports/${reportId}/pivot`}
              className="flex items-center justify-center gap-2 px-6 py-4 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white rounded-lg text-lg font-medium transition shadow-md hover:shadow-lg"
            >
              <LayoutGrid className="w-5 h-5" />
              Apri Pivot Avanzato
            </Link>
            
            <div className="grid grid-cols-2 gap-3">
              <a
                href={`/api/export/${reportId}/xlsx`}
                className="flex items-center justify-center gap-2 px-4 py-3 bg-green-50 hover:bg-green-100 text-pos rounded-lg text-sm font-medium transition border border-green-200"
              >
                <FileSpreadsheet className="w-4 h-4" />
                Export Excel
              </a>
              
              <a
                href={`/api/export/${reportId}/csv`}
                className="flex items-center justify-center gap-2 px-4 py-3 bg-accent-soft hover:bg-accent-soft text-accent-strong rounded-lg text-sm font-medium transition border border-accent"
              >
                <FileText className="w-4 h-4" />
                Export CSV
              </a>
            </div>
          </div>
          
          {/* Warehouse (DuckDB) — solo superuser */}
          {isSuperuser && (
            <div className="text-left bg-surface-2 border border-line rounded-xl p-4 mb-6">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Boxes className="w-4 h-4 text-accent" />
                  <span className="font-semibold text-ink text-sm">Warehouse</span>
                </div>
                {whDataset ? (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-accent-soft text-accent-strong num">
                    {whDataset.row_count?.toLocaleString('it-IT')} righe
                  </span>
                ) : (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-ground text-muted">
                    non materializzato
                  </span>
                )}
              </div>

              <p className="text-xs text-muted mb-3">
                {whDataset?.last_sync_at
                  ? `Ultima sincronizzazione: ${new Date(whDataset.last_sync_at).toLocaleString('it-IT')}`
                  : 'Crea una copia colonnare del report per query più veloci e indipendenti dalla sorgente.'}
              </p>

              {/* Modalità ETL */}
              <div className="flex items-center gap-2 flex-wrap mb-3">
                <select
                  value={whMode}
                  onChange={e => setWhMode(e.target.value as 'full' | 'incremental')}
                  className="px-2 py-1.5 text-sm border border-line rounded-lg bg-surface"
                >
                  <option value="full">Full refresh</option>
                  <option value="incremental">Incrementale</option>
                </select>
                {whMode === 'incremental' && (
                  <>
                    <input
                      value={whWatermark}
                      onChange={e => setWhWatermark(e.target.value)}
                      placeholder="colonna watermark (es. updated_at)"
                      className="flex-1 min-w-[10rem] px-2 py-1.5 text-sm border border-line rounded-lg num"
                    />
                    <input
                      value={whKeys}
                      onChange={e => setWhKeys(e.target.value)}
                      placeholder="chiavi merge, es. id (opz.)"
                      className="w-40 px-2 py-1.5 text-sm border border-line rounded-lg num"
                    />
                    {whDataset?.last_watermark && (
                      <span className="num text-xs px-2 py-1 rounded bg-ground text-muted">
                        watermark: {whDataset.last_watermark}
                      </span>
                    )}
                  </>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={handleMaterialize}
                  disabled={whBusy}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-sm font-medium disabled:opacity-50 hover:brightness-110"
                  style={{ background: 'linear-gradient(100deg,#7B6CF5,#6A8DF5)' }}
                >
                  {whBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Boxes className="w-4 h-4" />}
                  {whDataset ? 'Aggiorna mart' : 'Materializza'}
                </button>

                <button
                  onClick={handleToggleBacked}
                  disabled={whBusy || !whDataset}
                  title={!whDataset ? 'Materializza prima il report' : ''}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border transition disabled:opacity-50 ${
                    whBacked
                      ? 'bg-accent-soft text-accent-strong border-accent'
                      : 'text-muted border-line hover:bg-ground'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${whBacked ? 'bg-accent' : 'bg-muted'}`} />
                  {whBacked ? 'Query sul warehouse: attivo' : 'Interroga il warehouse'}
                </button>
              </div>
            </div>
          )}

          {/* Semantica (modello) — superuser e data steward */}
          {canGovern && (
            <div className="text-left bg-surface-2 border border-line rounded-xl p-4 mb-6">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Tags className="w-4 h-4 text-accent" />
                  <span className="font-semibold text-ink text-sm">Semantica</span>
                  {semCols.length > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-ground text-muted num">
                      {semCols.length} colonne
                    </span>
                  )}
                </div>
                <button
                  onClick={handleAutodetect}
                  disabled={semBusy}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-line text-muted hover:bg-ground disabled:opacity-50"
                >
                  {semBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {semCols.length > 0 ? 'Ri-rileva' : 'Auto-rileva'}
                </button>
              </div>

              {semCols.length === 0 ? (
                <p className="text-xs text-muted">
                  Definisci misure, dimensioni e formati: la base per dashboard più chiare e per l'AI.
                </p>
              ) : (
                <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
                  {semCols.map(c => (
                    <div key={c.column_name} className="flex items-center gap-2 flex-wrap">
                      <span className="num text-xs px-2 py-1 rounded bg-ground text-muted shrink-0 min-w-[7rem]">
                        {c.column_name}
                      </span>
                      <input
                        value={c.business_name || ''}
                        placeholder="Nome business"
                        onChange={e => setSemLocal(c.column_name, 'business_name', e.target.value)}
                        onBlur={() => patchSem(c.column_name, { business_name: c.business_name })}
                        className="flex-1 min-w-[8rem] px-2 py-1 text-sm border border-line rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent"
                      />
                      <select
                        value={c.role}
                        onChange={e => patchSem(c.column_name, { role: e.target.value })}
                        className="px-2 py-1 text-sm border border-line rounded-lg bg-surface"
                      >
                        <option value="dimension">dimensione</option>
                        <option value="measure">misura</option>
                        <option value="time">tempo</option>
                        <option value="attribute">attributo</option>
                      </select>
                      <select
                        value={c.default_aggregation}
                        onChange={e => patchSem(c.column_name, { default_aggregation: e.target.value })}
                        className="px-2 py-1 text-sm border border-line rounded-lg bg-surface num"
                        title="Aggregazione di default"
                      >
                        <option value="none">—</option>
                        <option value="sum">somma</option>
                        <option value="avg">media</option>
                        <option value="count">conteggio</option>
                        <option value="min">min</option>
                        <option value="max">max</option>
                      </select>
                      <input
                        value={c.unit || ''}
                        placeholder="unità"
                        onChange={e => setSemLocal(c.column_name, 'unit', e.target.value)}
                        onBlur={() => patchSem(c.column_name, { unit: c.unit })}
                        className="w-16 px-2 py-1 text-sm border border-line rounded-lg focus:ring-2 focus:ring-accent focus:border-transparent num"
                      />
                      <button
                        type="button"
                        onClick={() => patchSem(c.column_name, { is_certified: !c.is_certified })}
                        title={c.is_certified ? 'Certificata (usabile dall\'AI in modalità governata)' : 'Non certificata'}
                        className={`p-1.5 rounded-lg border transition shrink-0 ${
                          c.is_certified
                            ? 'bg-accent-soft text-accent-strong border-accent'
                            : 'text-muted border-line hover:bg-ground'
                        }`}
                      >
                        <ShieldCheck className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Genera dashboard con l'AI — solo superuser */}
          {isSuperuser && (
            <form onSubmit={handleGenerateDashboard} className="text-left bg-surface-2 border border-line rounded-xl p-4 mb-6">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 text-accent" />
                <span className="font-semibold text-ink text-sm">Genera dashboard con l'AI</span>
              </div>
              <p className="text-xs text-muted mb-3">
                Descrivi cosa vuoi vedere: l'AI crea i widget sui dati di questo report.
              </p>
              <div className="flex items-center gap-2">
                <input
                  value={dashDesc}
                  onChange={e => setDashDesc(e.target.value)}
                  placeholder="es. «andamento per anno e dettaglio per regione»"
                  className="flex-1 px-3 py-2 text-sm border border-line rounded-xl focus:ring-2 focus:ring-accent focus:border-transparent"
                />
                <button
                  type="submit"
                  disabled={dashBusy || !dashDesc.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-white text-sm font-semibold disabled:opacity-50 hover:brightness-110 shrink-0"
                  style={{ background: 'linear-gradient(100deg,#7B6CF5,#6A8DF5)' }}
                >
                  {dashBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  Genera
                </button>
              </div>
            </form>
          )}

          <div className="flex items-center justify-center gap-4 pt-6 border-t">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2 text-muted hover:text-ink hover:bg-ground rounded-lg transition text-sm"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              Aggiorna Cache
            </button>
            
            {isAdmin && (
              <Link
                to={`/reports/${reportId}/edit`}
                className="flex items-center gap-2 px-4 py-2 text-muted hover:text-ink hover:bg-ground rounded-lg transition text-sm"
              >
                <Edit className="w-4 h-4" />
                Modifica Report
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
