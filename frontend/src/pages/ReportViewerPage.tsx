/**
 * ReportViewerPage - BI Report Overview
 * Shows report metadata and provides quick access to Pivot view
 */
import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import {
  ArrowLeft, Download, RefreshCw, Loader2, FileSpreadsheet,
  FileText, Clock, Database, Zap, Edit, LayoutGrid
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
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin' || user?.role === 'superuser';
  const reportId = parseInt(id || '0');
  
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({ rows: 0, time: 0, cached: false });

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

    } catch (err: any) {
      console.error('Load error:', err);
      setError(err.message || 'Errore sconosciuto');
    } finally {
      setLoading(false);
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
