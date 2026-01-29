/**
 * Dashboard Viewer with Widget Management
 * Supports: TreeDataGrid (tabelle) and BiChart (grafici)
 * Drill-down: Click on chart → filters all widgets of same report
 */
import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useDashboardStore } from '../stores/dashboardStore';
import TreeDataGrid from '../components/TreeDataGrid';
import BiChart, { ChartType, ChartTypeSelector } from '../components/BiChart';
import {
  ArrowLeft, Loader2, Plus, X, Trash2, GripVertical,
  Table, BarChart3, Settings, Filter
} from 'lucide-react';
import { reportsApi, pivotApi } from '../services/api';
import { toast } from '../stores/toastStore';

interface Widget {
  id: number;
  report_id: number;
  title: string;
  widget_type: 'grid' | 'chart';
  config: {
    chartType?: ChartType;
    groupBy?: string[];
    metrics?: any[];
    splitBy?: string[];
  };
}

interface Report {
  id: number;
  name: string;
}

export default function DashboardViewerPage() {
  const { id } = useParams();
  const { user } = useAuthStore();
  const {
    filtersByReport,
    setFilter,
    removeFilter,
    clearFiltersForReport,
    clearAllFilters,
    setDashboard: setStoreDashboard,
    getFilterModelForReport
  } = useDashboardStore();
  const isSuperuser = user?.role === 'superuser';
  const isAdminOrSuperuser = user?.role === 'admin' || user?.role === 'superuser';
  const dashboardId = parseInt(id || '0');

  const [dashboard, setDashboard] = useState<any>(null);
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  const getToken = () => localStorage.getItem('token');

  useEffect(() => {
    // Reset filters when changing dashboard
    setStoreDashboard(dashboardId);
    loadDashboard();
    if (isAdminOrSuperuser) loadReports();
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
      toast.error('Errore caricamento dashboard');
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
      toast.error('Errore caricamento report');
    }
  };

  const addWidget = async (reportId: number, widgetType: 'grid' | 'chart') => {
    const report = reports.find(r => r.id === reportId);
    if (!report) return;

    try {
      // Try to load the saved pivot config from the report
      let widgetConfig: Widget['config'] = {};

      try {
        // First, try to get the saved report configuration
        const configRes = await fetch(`/api/pivot/${reportId}/config`, {
          headers: { 'Authorization': `Bearer ${getToken()}` }
        });

        if (configRes.ok) {
          const savedConfig = await configRes.json();
          // Use the saved config if it has data
          if (savedConfig.rows?.length > 0 || savedConfig.values?.length > 0) {
            widgetConfig = {
              chartType: widgetType === 'chart' ? 'bar' : undefined,
              groupBy: savedConfig.rows || [],
              splitBy: savedConfig.columns || [],
              metrics: (savedConfig.values || []).map((v: any, i: number) => ({
                id: v.id || `metric-${i}`,
                name: v.name || v.field,
                field: v.field,
                aggregation: v.aggregation || 'SUM'
              }))
            };
          }
        }

        // If no saved config, fall back to schema-based defaults
        if (!widgetConfig.groupBy?.length && !widgetConfig.metrics?.length) {
          const schema = await pivotApi.getSchema(reportId);
          const numericCols = schema.columns.filter((c: any) => c.type === 'number');
          const stringCols = schema.columns.filter((c: any) => c.type === 'string');

          if (widgetType === 'chart' && numericCols.length > 0) {
            widgetConfig = {
              chartType: 'bar',
              groupBy: stringCols.length > 0 ? [stringCols[0].name] : [],
              metrics: [{
                id: 'metric-1',
                name: numericCols[0].label || numericCols[0].name,
                field: numericCols[0].name,
                aggregation: 'SUM'
              }]
            };
          } else if (widgetType === 'grid') {
            widgetConfig = {
              groupBy: stringCols.length > 0 ? [stringCols[0].name] : [],
              metrics: numericCols.slice(0, 3).map((c: any, i: number) => ({
                id: `metric-${i}`,
                name: c.label || c.name,
                field: c.name,
                aggregation: 'SUM'
              }))
            };
          }
        }
      } catch (e) {
        console.warn('Could not get config for widget:', e);
      }

      const res = await fetch(`/api/dashboards/${dashboardId}/widgets`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          report_id: reportId,
          title: report.name,
          widget_type: widgetType,
          config: widgetConfig,
          position: { x: 0, y: widgets.length, w: 6, h: 4 }
        })
      });

      if (res.ok) {
        const newWidget = await res.json();
        setWidgets([...widgets, newWidget]);
        setShowAddModal(false);
      }
    } catch (err) {
      toast.error('Errore aggiunta widget');
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
      toast.success('Widget rimosso');
    } catch (err) {
      toast.error('Errore rimozione widget');
    }
  };

  const updateWidgetConfig = async (widgetId: number, newConfig: Widget['config']) => {
    // Update local state
    setWidgets(widgets.map(w =>
      w.id === widgetId ? { ...w, config: newConfig } : w
    ));

    // Persist to backend
    try {
      await fetch(`/api/dashboards/${dashboardId}/widgets/${widgetId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ config: newConfig })
      });
    } catch (err) {
      console.warn('Could not save widget config');
    }
  };

  const toggleWidgetType = async (widgetId: number, currentType: 'grid' | 'chart') => {
    const newType = currentType === 'grid' ? 'chart' : 'grid';

    // Update local state
    setWidgets(widgets.map(w =>
      w.id === widgetId ? { ...w, widget_type: newType } : w
    ));

    // Persist to backend - note: backend doesn't support changing widget_type yet
    // This is a local-only toggle for now
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

  // All reports available for adding (same report can be added multiple times as different widget types)
  const availableReports = reports;

  // Collect all active filters for display
  const allActiveFilters = Object.entries(filtersByReport).flatMap(([reportId, filters]) =>
    Object.entries(filters).map(([field, filter]) => ({
      reportId: parseInt(reportId),
      field,
      ...filter
    }))
  );
  const hasActiveFilters = allActiveFilters.length > 0;

  // Drill-down handler: when user clicks on a chart element
  // Supports multi-level drill-down: if groupBy[0] is already filtered, use groupBy[1], etc.
  const handleDrillDown = (reportId: number, groupByFields: string[], category: string) => {
    if (!category || category === 'N/A' || groupByFields.length === 0) return;

    const existingFilters = filtersByReport[reportId] || {};

    // Find the first groupBy field that isn't already filtered
    const nextField = groupByFields.find(field => !existingFilters[field]);

    if (nextField) {
      setFilter(reportId, nextField, category, 'equals');
    }
    // If all groupBy fields are already filtered, do nothing (max depth reached)
  };

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

        <div className="flex items-center gap-2">
          {hasActiveFilters && (
            <button
              onClick={clearAllFilters}
              className="flex items-center gap-2 px-3 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm"
            >
              <X className="w-4 h-4" />
              Rimuovi Filtri
            </button>
          )}
          {isAdminOrSuperuser && (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
            >
              <Plus className="w-4 h-4" />
              Aggiungi Widget
            </button>
          )}
        </div>
      </div>

      {/* Active Filters Bar */}
      {hasActiveFilters && (
        <div className="bg-blue-50 border-b border-blue-100 px-4 py-2 flex items-center gap-2 flex-wrap">
          <Filter className="w-4 h-4 text-blue-500" />
          <span className="text-sm text-blue-700 font-medium">Filtri attivi:</span>
          {allActiveFilters.map((filter, idx) => (
            <span
              key={`${filter.reportId}-${filter.field}-${idx}`}
              className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs"
            >
              <span className="font-medium">{filter.field}:</span> {String(filter.value)}
              <button
                type="button"
                onClick={() => removeFilter(filter.reportId, filter.field)}
                className="ml-1 hover:bg-blue-200 rounded-full p-0.5"
                title="Rimuovi filtro"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 p-4 overflow-auto">
        {widgets.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-slate-500">
              <Plus className="w-16 h-16 mx-auto mb-4 text-slate-300" />
              <p className="text-lg mb-2">Dashboard vuota</p>
              {isAdminOrSuperuser && (
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
            {widgets.map((widget, index) => (
              <WidgetCard
                key={widget.id ?? `widget-${index}`}
                widget={widget}
                canEdit={isAdminOrSuperuser}
                onRemove={() => removeWidget(widget.id)}
                onConfigChange={(config) => updateWidgetConfig(widget.id, config)}
                onToggleType={() => toggleWidgetType(widget.id, widget.widget_type)}
                filters={getFilterModelForReport(widget.report_id)}
                onDrillDown={(value) => handleDrillDown(widget.report_id, widget.config?.groupBy || [], value)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add Widget Modal */}
      {showAddModal && (
        <AddWidgetModal
          reports={availableReports}
          onAdd={addWidget}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}

// Widget Card Component
function WidgetCard({
  widget,
  canEdit,
  onRemove,
  onConfigChange,
  onToggleType,
  filters,
  onDrillDown
}: {
  widget: Widget;
  canEdit: boolean;
  onRemove: () => void;
  onConfigChange: (config: Widget['config']) => void;
  onToggleType: () => void;
  filters: Record<string, any>;
  onDrillDown: (value: string) => void;
}) {
  const [showSettings, setShowSettings] = useState(false);
  const config = widget.config || {};

  // Compute effective groupBy: skip fields that are already filtered (for drill-down)
  const allGroupBy = config.groupBy || [];
  const filteredFields = Object.keys(filters);
  const effectiveGroupBy = allGroupBy.filter(field => !filteredFields.includes(field));

  // For drill-down: if all groupBy fields are filtered, show original (max depth reached)
  const displayGroupBy = effectiveGroupBy.length > 0 ? effectiveGroupBy : allGroupBy;

  // Check if we can drill deeper
  const canDrillDeeper = effectiveGroupBy.length > 0;

  // Validate widget has required data
  if (!widget.report_id) {
    return (
      <div className="bg-white rounded-xl border overflow-hidden p-4" style={{ height: '450px' }}>
        <div className="h-full flex items-center justify-center text-slate-400">
          <p>Widget non configurato correttamente (report mancante)</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border overflow-hidden" style={{ height: '450px' }}>
      {/* Widget Header */}
      <div className="px-4 py-2 border-b bg-slate-50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {canEdit && <GripVertical className="w-4 h-4 text-slate-400 cursor-move" />}
          {widget.widget_type === 'chart' ? (
            <BarChart3 className="w-4 h-4 text-blue-500" />
          ) : (
            <Table className="w-4 h-4 text-emerald-500" />
          )}
          <h3 className="font-medium text-sm">{widget.title}</h3>
        </div>

        <div className="flex items-center gap-1">
          {/* Chart type selector for chart widgets */}
          {canEdit && widget.widget_type === 'chart' && (
            <ChartTypeSelector
              value={config.chartType || 'bar'}
              onChange={(type) => onConfigChange({ ...config, chartType: type })}
            />
          )}

          {canEdit && (
            <>
              {/* Settings button */}
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                className="p-1 hover:bg-slate-100 rounded text-slate-500"
                title="Configura Widget"
              >
                <Settings className="w-4 h-4" />
              </button>
              {/* Toggle between chart and grid */}
              <button
                type="button"
                onClick={onToggleType}
                className="p-1 hover:bg-slate-100 rounded text-slate-500"
                title={widget.widget_type === 'chart' ? 'Passa a Tabella' : 'Passa a Grafico'}
              >
                {widget.widget_type === 'chart' ? (
                  <Table className="w-4 h-4" />
                ) : (
                  <BarChart3 className="w-4 h-4" />
                )}
              </button>
              <button
                type="button"
                onClick={onRemove}
                className="p-1 hover:bg-red-100 rounded text-red-500"
                title="Rimuovi"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Widget Content */}
      <div className="h-[calc(100%-40px)]">
        {widget.widget_type === 'chart' ? (
          <BiChart
            reportId={widget.report_id}
            chartType={config.chartType || 'bar'}
            groupBy={displayGroupBy}
            metrics={config.metrics || []}
            splitBy={config.splitBy}
            filters={filters}
            height="100%"
            onDrillDown={canDrillDeeper ? (category, _value, _seriesName) => {
              // Drill-down: pass category, field logic handled by parent
              if (category) {
                onDrillDown(category);
              }
            } : undefined}
          />
        ) : (
          <TreeDataGrid
            reportId={widget.report_id}
            rowGroups={config.groupBy || []}
            valueCols={config.metrics || []}
            pivotCols={config.splitBy || []}
            filters={Object.entries(filters).map(([field, f]: [string, any]) => ({
              field,
              type: f.type || 'equals',
              value: f.filter
            }))}
            previewMode={false}
          />
        )}
      </div>

      {/* Widget Settings Modal */}
      {showSettings && (
        <WidgetSettingsModal
          widget={widget}
          onSave={(newConfig) => {
            onConfigChange(newConfig);
            setShowSettings(false);
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

// Widget Settings Modal - Configure groupBy, metrics, splitBy per widget
function WidgetSettingsModal({
  widget,
  onSave,
  onClose
}: {
  widget: Widget;
  onSave: (config: Widget['config']) => void;
  onClose: () => void;
}) {
  const [schema, setSchema] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<Widget['config']>(widget.config || {});

  const getToken = () => localStorage.getItem('token');

  // Load report schema
  useEffect(() => {
    const loadSchema = async () => {
      try {
        const res = await fetch(`/api/pivot/${widget.report_id}/schema`, {
          headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (res.ok) {
          setSchema(await res.json());
        }
      } catch (err) {
        console.error('Error loading schema:', err);
      } finally {
        setLoading(false);
      }
    };
    loadSchema();
  }, [widget.report_id]);

  const stringColumns = schema?.columns?.filter((c: any) => c.type === 'string') || [];
  const numericColumns = schema?.columns?.filter((c: any) => c.type === 'number') || [];

  const toggleGroupBy = (field: string) => {
    const current = config.groupBy || [];
    if (current.includes(field)) {
      setConfig({ ...config, groupBy: current.filter(f => f !== field) });
    } else {
      setConfig({ ...config, groupBy: [...current, field] });
    }
  };

  const toggleMetric = (field: string) => {
    const current = config.metrics || [];
    const exists = current.find((m: any) => m.field === field);
    if (exists) {
      setConfig({ ...config, metrics: current.filter((m: any) => m.field !== field) });
    } else {
      setConfig({
        ...config,
        metrics: [...current, { id: `metric-${Date.now()}`, field, name: field, aggregation: 'SUM' }]
      });
    }
  };

  const toggleSplitBy = (field: string) => {
    const current = config.splitBy || [];
    if (current.includes(field)) {
      setConfig({ ...config, splitBy: current.filter(f => f !== field) });
    } else {
      setConfig({ ...config, splitBy: [...current, field] });
    }
  };

  const updateMetricAggregation = (field: string, aggregation: string) => {
    const current = config.metrics || [];
    setConfig({
      ...config,
      metrics: current.map((m: any) =>
        m.field === field ? { ...m, aggregation } : m
      )
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="font-semibold">Configura Widget: {widget.title}</h2>
          <button type="button" onClick={onClose} className="p-1 hover:bg-slate-100 rounded" title="Chiudi">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
            </div>
          ) : (
            <>
              {/* Group By Section */}
              <div>
                <label className="block text-sm font-medium mb-2">
                  Group By (Raggruppamento)
                </label>
                <p className="text-xs text-slate-500 mb-2">
                  Seleziona i campi per raggruppare i dati. L'ordine determina la gerarchia del drill-down.
                </p>
                <div className="flex flex-wrap gap-2">
                  {stringColumns.map((col: any) => (
                    <button
                      key={col.name}
                      type="button"
                      onClick={() => toggleGroupBy(col.name)}
                      className={`px-3 py-1.5 rounded-full text-sm border transition ${
                        (config.groupBy || []).includes(col.name)
                          ? 'bg-blue-100 border-blue-300 text-blue-700'
                          : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      {(config.groupBy || []).includes(col.name) && (
                        <span className="mr-1 font-bold">
                          {(config.groupBy || []).indexOf(col.name) + 1}.
                        </span>
                      )}
                      {col.label || col.name}
                    </button>
                  ))}
                </div>
                {(config.groupBy || []).length > 0 && (
                  <p className="text-xs text-blue-600 mt-2">
                    Ordine drill-down: {(config.groupBy || []).join(' → ')}
                  </p>
                )}
              </div>

              {/* Metrics Section */}
              <div>
                <label className="block text-sm font-medium mb-2">
                  Metriche (Valori)
                </label>
                <p className="text-xs text-slate-500 mb-2">
                  Seleziona i campi numerici da aggregare.
                </p>
                <div className="space-y-2">
                  {numericColumns.map((col: any) => {
                    const metric = (config.metrics || []).find((m: any) => m.field === col.name);
                    const isSelected = !!metric;
                    return (
                      <div key={col.name} className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleMetric(col.name)}
                          className={`flex-1 px-3 py-2 rounded-lg text-sm border text-left transition ${
                            isSelected
                              ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                              : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300'
                          }`}
                        >
                          {col.label || col.name}
                        </button>
                        {isSelected && (
                          <select
                            value={metric?.aggregation || 'SUM'}
                            onChange={(e) => updateMetricAggregation(col.name, e.target.value)}
                            className="px-2 py-2 border rounded-lg text-sm"
                            title="Tipo aggregazione"
                          >
                            <option value="SUM">Somma</option>
                            <option value="AVG">Media</option>
                            <option value="COUNT">Conteggio</option>
                            <option value="MIN">Minimo</option>
                            <option value="MAX">Massimo</option>
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Split By Section (optional pivot) */}
              <div>
                <label className="block text-sm font-medium mb-2">
                  Split By (Pivot - opzionale)
                </label>
                <p className="text-xs text-slate-500 mb-2">
                  Dividi le metriche per questo campo (es. per Anno).
                </p>
                <div className="flex flex-wrap gap-2">
                  {stringColumns.map((col: any) => (
                    <button
                      key={col.name}
                      type="button"
                      onClick={() => toggleSplitBy(col.name)}
                      className={`px-3 py-1.5 rounded-full text-sm border transition ${
                        (config.splitBy || []).includes(col.name)
                          ? 'bg-purple-100 border-purple-300 text-purple-700'
                          : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      {col.label || col.name}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
          >
            Annulla
          </button>
          <button
            type="button"
            onClick={() => onSave(config)}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50"
          >
            Salva
          </button>
        </div>
      </div>
    </div>
  );
}

// Add Widget Modal
function AddWidgetModal({
  reports,
  onAdd,
  onClose
}: {
  reports: Report[];
  onAdd: (reportId: number, type: 'grid' | 'chart') => void;
  onClose: () => void;
}) {
  const [selectedReport, setSelectedReport] = useState<number | null>(null);
  const [widgetType, setWidgetType] = useState<'grid' | 'chart'>('chart');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="font-semibold">Aggiungi Widget</h2>
          <button type="button" onClick={onClose} className="p-1 hover:bg-slate-100 rounded" title="Chiudi">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {/* Widget Type Selection */}
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Tipo Widget</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setWidgetType('chart')}
                className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border transition ${
                  widgetType === 'chart'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <BarChart3 className="w-5 h-5" />
                Grafico
              </button>
              <button
                type="button"
                onClick={() => setWidgetType('grid')}
                className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border transition ${
                  widgetType === 'grid'
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <Table className="w-5 h-5" />
                Tabella
              </button>
            </div>
          </div>

          {/* Report Selection */}
          <div>
            <label className="block text-sm font-medium mb-2">Seleziona Report</label>
            {reports.length === 0 ? (
              <p className="text-slate-500 text-center py-8">
                Tutti i report sono già nella dashboard
              </p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-auto">
                {reports.map(report => (
                  <button
                    type="button"
                    key={report.id}
                    onClick={() => setSelectedReport(report.id)}
                    className={`w-full text-left p-4 rounded-lg border transition ${
                      selectedReport === report.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'hover:border-blue-300 hover:bg-slate-50'
                    }`}
                  >
                    <p className="font-medium">{report.name}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
          >
            Annulla
          </button>
          <button
            type="button"
            onClick={() => selectedReport && onAdd(selectedReport, widgetType)}
            disabled={!selectedReport}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Aggiungi
          </button>
        </div>
      </div>
    </div>
  );
}
