/**
 * Dashboard Viewer with Widget Management
 */
import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
// import perspective from '@finos/perspective';
// import '@finos/perspective-viewer';
// import '@finos/perspective-viewer-datagrid';
// import '@finos/perspective-viewer-d3fc';
import { ArrowLeft, Loader2, Plus, X, Trash2, GripVertical, Save, Check } from 'lucide-react';

interface Widget {
  id: number;
  report_id: number;
  title: string;
  config: any;
}

interface Report {
  id: number;
  name: string;
}

export default function DashboardViewerPage() {
  const { id } = useParams();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  const dashboardId = parseInt(id || '0');
  
  const [dashboard, setDashboard] = useState<any>(null);
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const getToken = () => localStorage.getItem('token');

  useEffect(() => {
    loadDashboard();
    if (isAdmin) loadReports();
  }, [id]);

  const loadDashboard = async () => {
    try {
      const res = await fetch(`/api/dashboards/${dashboardId}`, {
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
      if (res.ok) {
        const data = await res.json();
        setDashboard(data);
        setWidgets(data.widgets || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadReports = async () => {
    try {
      const res = await fetch('/api/reports', {
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
      if (res.ok) {
        setReports(await res.json());
      }
    } catch (err) {
      console.error(err);
    }
  };

  const addWidget = async (reportId: number) => {
    const report = reports.find(r => r.id === reportId);
    if (!report) return;
    
    try {
      const res = await fetch(`/api/dashboards/${dashboardId}/widgets`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          report_id: reportId,
          title: report.name,
          widget_type: 'grid',
          position: { x: 0, y: widgets.length, w: 6, h: 4 }
        })
      });
      
      if (res.ok) {
        const newWidget = await res.json();
        setWidgets([...widgets, newWidget]);
        setShowAddModal(false);
        setSaved(false);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const removeWidget = async (widgetId: number) => {
    if (!confirm('Rimuovere questo widget?')) return;
    
    try {
      await fetch(`/api/dashboards/${dashboardId}/widgets/${widgetId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
      setWidgets(widgets.filter(w => w.id !== widgetId));
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-slate-500">Dashboard non trovata</p>
      </div>
    );
  }

  // Available reports (not already in dashboard)
  const usedReportIds = widgets.map(w => w.report_id);
  const availableReports = reports.filter(r => !usedReportIds.includes(r.id));

  return (
    <div className="h-full flex flex-col bg-slate-100">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <Link to="/dashboards" className="p-2 hover:bg-slate-100 rounded-lg">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="font-semibold text-slate-800">{dashboard.name}</h1>
        </div>
        
        {isAdmin && (
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
          >
            <Plus className="w-4 h-4" />
            Aggiungi Widget
          </button>
        )}
      </div>
      
      {/* Content */}
      <div className="flex-1 p-4 overflow-auto">
        {widgets.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-slate-500">
              <Plus className="w-16 h-16 mx-auto mb-4 text-slate-300" />
              <p className="text-lg mb-2">Dashboard vuota</p>
              {isAdmin && (
                <button
                  onClick={() => setShowAddModal(true)}
                  className="text-blue-600 hover:underline"
                >
                  Aggiungi il primo widget
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {widgets.map(widget => (
              <WidgetCard
                key={widget.id}
                widget={widget}
                isAdmin={isAdmin}
                onRemove={() => removeWidget(widget.id)}
              />
            ))}
          </div>
        )}
      </div>
      
      {/* Add Widget Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="font-semibold">Aggiungi Widget</h2>
              <button onClick={() => setShowAddModal(false)} className="p-1 hover:bg-slate-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex-1 overflow-auto p-4">
              {availableReports.length === 0 ? (
                <p className="text-slate-500 text-center py-8">
                  Tutti i report sono già nella dashboard
                </p>
              ) : (
                <div className="space-y-2">
                  {availableReports.map(report => (
                    <button
                      key={report.id}
                      onClick={() => addWidget(report.id)}
                      className="w-full text-left p-4 rounded-lg border hover:border-blue-500 hover:bg-blue-50 transition"
                    >
                      <p className="font-medium">{report.name}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Widget Card Component with embedded Perspective viewer
function WidgetCard({ 
  widget, 
  isAdmin, 
  onRemove 
}: { 
  widget: Widget; 
  isAdmin: boolean;
  onRemove: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const workerRef = useRef<any>(null);
  const tableRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // workerRef.current = perspective.worker();
    loadWidgetData();

    return () => {
      // tableRef.current?.delete();
      // workerRef.current?.terminate();
    };
  }, [widget.report_id]);

  const loadWidgetData = async () => {
    try {
      const token = localStorage.getItem('token');
      
      // First get report config
      const reportRes = await fetch(`/api/reports/${widget.report_id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const report = await reportRes.json();
      
      // Then get data
      const dataRes = await fetch(`/api/reports/${widget.report_id}/data`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!dataRes.ok) throw new Error('Data error');
      
      const arrayBuffer = await dataRes.arrayBuffer();
      
      if (!containerRef.current || !workerRef.current) return;
      
      // Create viewer
      if (!viewerRef.current) {
        const viewer = document.createElement('perspective-viewer');
        viewer.setAttribute('theme', 'Pro Light');
        containerRef.current.innerHTML = '';
        containerRef.current.appendChild(viewer);
        viewerRef.current = viewer;
      }
      
      if (tableRef.current) {
        await tableRef.current.delete();
      }
      
      tableRef.current = await workerRef.current.table(arrayBuffer);
      await viewerRef.current.load(tableRef.current);
      
      // Apply saved config
      if (report.perspective_config && Object.keys(report.perspective_config).length > 0) {
        try {
          await viewerRef.current.restore(report.perspective_config);
        } catch (e) {
          console.warn('Config restore failed');
        }
      }
      
      setLoading(false);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border overflow-hidden" style={{ height: '450px' }}>
      {/* Widget Header */}
      <div className="px-4 py-2 border-b bg-slate-50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isAdmin && <GripVertical className="w-4 h-4 text-slate-400" />}
          <h3 className="font-medium text-sm">{widget.title}</h3>
        </div>
        {isAdmin && (
          <button
            onClick={onRemove}
            className="p-1 hover:bg-red-100 rounded text-red-500"
            title="Rimuovi"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
      
      {/* Widget Content */}
      <div className="h-[calc(100%-40px)] relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-white">
            <p className="text-red-500 text-sm">{error}</p>
          </div>
        )}
        <div ref={containerRef} className="h-full" />
      </div>
      
      <style>{`
        perspective-viewer::part(settings_button),
        perspective-viewer::part(export_button),
        perspective-viewer::part(copy_button) {
          display: none !important;
        }
      `}</style>
    </div>
  );
}
