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

export default function ReportViewerPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  const reportId = parseInt(id || '0');
  
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({ rows: 0, time: 0, cached: false });

  const getToken = () => localStorage.getItem('token');

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
      const reportRes = await fetch(`/api/reports/${reportId}`, {
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
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
      await fetch(`/api/reports/${reportId}/refresh-cache`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
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
          
          {/* Admin: Edit Query */}
          {isAdmin && (
            <>
              <div className="w-px h-6 bg-slate-200 mx-1" />
              
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
        <div className="max-w-2xl w-full bg-white rounded-xl shadow-lg p-8 text-center">
          <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <LayoutGrid className="w-10 h-10 text-white" />
          </div>
          
          <h2 className="text-2xl font-bold text-slate-800 mb-3">{report?.name}</h2>
          
          {report?.description && (
            <p className="text-slate-600 mb-8">{report.description}</p>
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
                className="flex items-center justify-center gap-2 px-4 py-3 bg-green-50 hover:bg-green-100 text-green-700 rounded-lg text-sm font-medium transition border border-green-200"
              >
                <FileSpreadsheet className="w-4 h-4" />
                Export Excel
              </a>
              
              <a
                href={`/api/export/${reportId}/csv`}
                className="flex items-center justify-center gap-2 px-4 py-3 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-sm font-medium transition border border-blue-200"
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
              className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition text-sm"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              Aggiorna Cache
            </button>
            
            {isAdmin && (
              <Link
                to={`/reports/${reportId}/edit`}
                className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition text-sm"
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
