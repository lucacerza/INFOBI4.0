import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { reportsApi } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import {
  FileText,
  Plus,
  Search,
  Loader2,
  Clock,
  Database,
  Edit,
  Trash
} from 'lucide-react';

interface Report {
  id: number;
  name: string;
  description: string | null;
  connection_id: number;
  cache_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export default function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  
  useEffect(() => {
    loadReports();
  }, []);
  
  const loadReports = async () => {
    try {
      const data = await reportsApi.list();
      setReports(data);
    } catch (err) {
      console.error('Failed to load reports:', err);
    } finally {
      setLoading(false);
    }
  };
  
  const filteredReports = reports.filter(r =>
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    r.description?.toLowerCase().includes(search.toLowerCase())
  );

  const handleDelete = async (reportId: number, reportName: string) => {
    if (!confirm(`Sei sicuro di voler eliminare il report "${reportName}"?`)) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/reports/${reportId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) throw new Error('Errore durante l\'eliminazione');

      // Ricarica la lista report
      await loadReports();
      alert('Report eliminato con successo');
    } catch (err: any) {
      alert('Errore: ' + err.message);
    }
  };
  
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }
  
  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Report</h1>
          <p className="text-gray-500">{reports.length} report disponibili</p>
        </div>
        
        {isAdmin && (
          <Link
            to="/reports/new"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition"
          >
            <Plus className="w-5 h-5" />
            Nuovo Report
          </Link>
        )}
      </div>
      
      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          type="text"
          placeholder="Cerca report..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>
      
      {/* Reports grid */}
      {filteredReports.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">Nessun report trovato</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredReports.map(report => (
            <div
              key={report.id}
              className="relative p-5 bg-white border border-gray-100 rounded-xl hover:shadow-lg hover:border-blue-200 transition group"
            >
              <Link
                to={`/reports/${report.id}/pivot`}
                className="block"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-500 group-hover:text-white transition">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-800 truncate group-hover:text-blue-600 transition">
                      {report.name}
                    </h3>
                    {report.description && (
                      <p className="text-sm text-gray-500 mt-1 line-clamp-2">
                        {report.description}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-4 mt-4 pt-4 border-t border-gray-100 text-xs text-gray-400">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    {new Date(report.updated_at).toLocaleDateString('it-IT')}
                  </span>
                  {report.cache_enabled && (
                    <span className="flex items-center gap-1 text-green-500">
                      <Database className="w-3.5 h-3.5" />
                      Cache
                    </span>
                  )}
                </div>
              </Link>

              {/* Action buttons (only for admin) */}
              {isAdmin && (
                <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDelete(report.id, report.name);
                    }}
                    className="p-2 bg-slate-100 hover:bg-red-600 hover:text-white rounded-lg transition"
                    title="Elimina report"
                  >
                    <Trash className="w-4 h-4" />
                  </button>
                  <Link
                    to={`/reports/${report.id}/edit`}
                    className="p-2 bg-slate-100 hover:bg-purple-600 hover:text-white rounded-lg transition"
                    onClick={(e) => e.stopPropagation()}
                    title="Modifica report"
                  >
                    <Edit className="w-4 h-4" />
                  </Link>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
