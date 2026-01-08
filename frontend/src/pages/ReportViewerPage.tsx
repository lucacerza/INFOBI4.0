/**
 * ReportViewerPage - Clean BI Viewer
 * Data loads automatically, Perspective settings for admin only
 */
import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
// import perspective from '@finos/perspective';
// import '@finos/perspective-viewer';
// import '@finos/perspective-viewer-datagrid';
// import '@finos/perspective-viewer-d3fc';
// import '@finos/perspective-viewer/dist/css/themes.css';
import {
  ArrowLeft, Download, RefreshCw, Loader2, FileSpreadsheet,
  FileText, Save, Clock, Database, Zap, Check, Edit, LayoutGrid
} from 'lucide-react';

export default function ReportViewerPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  const reportId = parseInt(id || '0');
  
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [stats, setStats] = useState({ rows: 0, time: 0, cached: false });
  
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const workerRef = useRef<any>(null);
  const tableRef = useRef<any>(null);

  const getToken = () => localStorage.getItem('token');

  // Initialize worker
  useEffect(() => {
    // workerRef.current = perspective.worker();
    return () => {
      // tableRef.current?.delete();
      // workerRef.current?.terminate();
    };
  }, []);

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
      // 1. Get report metadata
      const reportRes = await fetch(`/api/reports/${reportId}`, {
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
      if (!reportRes.ok) throw new Error('Report non trovato');
      const reportData = await reportRes.json();
      setReport(reportData);
      
      // 2. Get data
      const dataRes = await fetch(`/api/reports/${reportId}/data`, {
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
      if (!dataRes.ok) throw new Error('Errore caricamento dati');
      
      const queryTime = parseFloat(dataRes.headers.get('X-Query-Time') || '0');
      const cacheHit = dataRes.headers.get('X-Cache-Hit') === 'true';
      const rowCount = dataRes.headers.get('X-Row-Count');
      const arrayBuffer = await dataRes.arrayBuffer();
      
      setStats({
        rows: parseInt(rowCount || '0'),
        time: queryTime,
        cached: cacheHit
      });
      
      // 3. Load into Perspective
      await createViewerAndLoad(arrayBuffer, reportData.perspective_config);
      
    } catch (err: any) {
      console.error('Load error:', err);
      setError(err.message || 'Errore sconosciuto');
    } finally {
      setLoading(false);
    }
  };

  const createViewerAndLoad = async (arrowData: ArrayBuffer, savedConfig?: any) => {
    if (!containerRef.current || !workerRef.current) return;
    
    // Create viewer element if not exists
    if (!viewerRef.current) {
      const viewer = document.createElement('perspective-viewer');
      viewer.setAttribute('theme', 'Pro Light');
      containerRef.current.innerHTML = '';
      containerRef.current.appendChild(viewer);
      viewerRef.current = viewer;
      
      // Wait for custom element to be defined
      await customElements.whenDefined('perspective-viewer');
    }
    
    // Delete old table
    if (tableRef.current) {
      await tableRef.current.delete();
    }
    
    // Create new table and load
    tableRef.current = await workerRef.current.table(arrowData);
    await viewerRef.current.load(tableRef.current);
    
    // Restore saved config
    if (savedConfig && Object.keys(savedConfig).length > 0) {
      try {
        await viewerRef.current.restore(savedConfig);
      } catch (e) {
        console.warn('Config restore failed:', e);
      }
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      // Invalidate cache
      await fetch(`/api/reports/${reportId}/refresh-cache`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
      
      // Reload data
      const dataRes = await fetch(`/api/reports/${reportId}/data`, {
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
      
      const queryTime = parseFloat(dataRes.headers.get('X-Query-Time') || '0');
      const cacheHit = dataRes.headers.get('X-Cache-Hit') === 'true';
      const rowCount = dataRes.headers.get('X-Row-Count');
      const arrayBuffer = await dataRes.arrayBuffer();
      
      setStats({
        rows: parseInt(rowCount || '0'),
        time: queryTime,
        cached: cacheHit
      });
      
      // Reload into viewer
      if (viewerRef.current && workerRef.current) {
        if (tableRef.current) {
          await tableRef.current.delete();
        }
        tableRef.current = await workerRef.current.table(arrayBuffer);
        await viewerRef.current.load(tableRef.current);
        
        if (report?.perspective_config) {
          await viewerRef.current.restore(report.perspective_config);
        }
      }
    } catch (err) {
      console.error('Refresh failed:', err);
    } finally {
      setRefreshing(false);
    }
  };

  const handleSaveConfig = async () => {
    if (!viewerRef.current || !isAdmin) return;
    
    setSaving(true);
    try {
      const config = await viewerRef.current.save();
      
      const res = await fetch(`/api/reports/${reportId}/perspective-config`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(config)
      });
      
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        setReport((prev: any) => ({ ...prev, perspective_config: config }));
      }
    } catch (err) {
      console.error('Save failed:', err);
      alert('Errore nel salvataggio');
    } finally {
      setSaving(false);
    }
  };

  // Loading state
  if (loading && !report) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-blue-500 mx-auto mb-3" />
          <p className="text-slate-500">Caricamento...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !report) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <Database className="w-16 h-16 text-slate-300 mx-auto mb-4" />
          <p className="text-red-500 mb-2">{error}</p>
          <Link to="/reports" className="text-blue-500 hover:underline">
            Torna ai report
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3 flex items-center justify-between flex-shrink-0 z-10">
        <div className="flex items-center gap-3">
          <Link to="/reports" className="p-2 hover:bg-slate-100 rounded-lg">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </Link>
          <div>
            <h1 className="font-semibold text-slate-800">{report?.name || 'Report'}</h1>
            {report?.description && <p className="text-xs text-slate-500">{report.description}</p>}
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Stats */}
          <div className="hidden md:flex items-center gap-3 px-3 py-1.5 bg-slate-100 rounded-lg text-xs">
            {stats.cached && (
              <span className="flex items-center gap-1 text-green-600 font-medium">
                <Zap className="w-3 h-3" />Cache
              </span>
            )}
            <span className="flex items-center gap-1 text-slate-600">
              <Database className="w-3 h-3" />{stats.rows.toLocaleString()}
            </span>
            <span className="flex items-center gap-1 text-slate-600">
              <Clock className="w-3 h-3" />{stats.time.toFixed(0)}ms
            </span>
          </div>
          
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
            className="p-2 hover:bg-slate-100 rounded-lg"
            title="Aggiorna dati"
          >
            <RefreshCw className={`w-4 h-4 text-slate-600 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          
          {/* Export */}
          <div className="relative group">
            <button className="p-2 hover:bg-slate-100 rounded-lg" title="Esporta">
              <Download className="w-4 h-4 text-slate-600" />
            </button>
            <div className="absolute right-0 top-full mt-1 w-32 bg-white rounded-lg shadow-xl border opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-20">
              <a href={`/api/export/${reportId}/xlsx`} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 rounded-t-lg">
                <FileSpreadsheet className="w-4 h-4 text-green-600" />Excel
              </a>
              <a href={`/api/export/${reportId}/csv`} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 rounded-b-lg">
                <FileText className="w-4 h-4 text-blue-600" />CSV
              </a>
            </div>
          </div>
          
          {/* Admin: Edit Query & Save */}
          {isAdmin && (
            <>
              <div className="w-px h-6 bg-slate-200 mx-1" />
              
              <Link
                to={`/reports/${reportId}/edit`}
                className="p-2 hover:bg-slate-100 rounded-lg"
                title="Modifica Query"
              >
                <Edit className="w-4 h-4 text-slate-600" />
              </Link>
              
              <button
                onClick={handleSaveConfig}
                disabled={saving}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                  saved 
                    ? 'bg-green-500 text-white' 
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
                title="Salva la configurazione corrente"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : saved ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                {saved ? 'Salvato!' : 'Salva'}
              </button>
            </>
          )}
        </div>
      </div>
      
      {/* Loading overlay for data refresh */}
      {loading && report && (
        <div className="absolute inset-0 bg-white/90 flex items-center justify-center z-20">
          <div className="text-center">
            <Loader2 className="w-10 h-10 animate-spin text-blue-500 mx-auto mb-3" />
            <p className="text-slate-500">Caricamento dati...</p>
          </div>
        </div>
      )}
      
      {/* Perspective Container */}
      <div ref={containerRef} className="flex-1 min-h-0" />
      
      {/* CSS: Show Perspective settings button ONLY for admin */}
      <style>{`
        perspective-viewer {
          height: 100%;
          width: 100%;
        }
        perspective-viewer::part(settings_button) {
          display: ${isAdmin ? 'flex' : 'none'} !important;
        }
        perspective-viewer::part(export_button),
        perspective-viewer::part(copy_button),
        perspective-viewer::part(reset_button) {
          display: none !important;
        }
      `}</style>
    </div>
  );
}
