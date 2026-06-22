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
import { ListSlicer, DropdownSlicer } from '../components/slicers';
import FilterBar from '../components/FilterBar';
import {
  ArrowLeft, Loader2, Plus, X, Trash2, GripVertical,
  Table, BarChart3, Settings, SlidersHorizontal
} from 'lucide-react';
import { reportsApi, pivotApi } from '../services/api';
import { toast } from '../stores/toastStore';

interface Widget {
  id: number;
  report_id: number;
  title: string;
  widget_type: 'grid' | 'chart' | 'slicer';
  config: {
    chartType?: ChartType;
    groupBy?: string[];
    metrics?: any[];
    splitBy?: string[];
    // Slicer-specific config
    slicerType?: 'list' | 'dropdown';
    slicerColumn?: string;
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
    getFilterModelForReport,
    getSelectedValues
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

  const addSlicerWidget = async (reportId: number, column: string, slicerType: 'list' | 'dropdown') => {
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
          title: column, // Use column name as title
          widget_type: 'slicer',
          config: {
            slicerType,
            slicerColumn: column
          },
          position: { x: 0, y: widgets.length, w: 3, h: 4 }
        })
      });

      if (res.ok) {
        const newWidget = await res.json();
        setWidgets([...widgets, newWidget]);
        setShowAddModal(false);
        toast.success(`Slicer "${column}" aggiunto`);
      }
    } catch (err) {
      toast.error('Errore aggiunta slicer');
    }
  };

  const removeWidget = async (widgetId: number) => {
    if (!confirm('Rimuovere questo widget?')) return;

    // Find widget to check if it's a slicer
    const widget = widgets.find(w => w.id === widgetId);

    try {
      await fetch(`/api/dashboards/${dashboardId}/widgets/${widgetId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
      setWidgets(widgets.filter(w => w.id !== widgetId));

      // If it was a slicer, clear its filter
      if (widget?.widget_type === 'slicer' && widget.config?.slicerColumn) {
        removeFilter(widget.report_id, widget.config.slicerColumn);
      }

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

  const toggleWidgetType = async (widgetId: number, currentType: 'grid' | 'chart' | 'slicer') => {
    // Slicers can't be toggled
    if (currentType === 'slicer') return;

    const newType = currentType === 'grid' ? 'chart' : 'grid';

    // Update local state (ottimistico)
    setWidgets(widgets.map(w =>
      w.id === widgetId ? { ...w, widget_type: newType } : w
    ));

    // Persist to backend
    try {
      await fetch(`/api/dashboards/${dashboardId}/widgets/${widgetId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ widget_type: newType })
      });
    } catch (err) {
      toast.error('Errore aggiornamento tipo widget');
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

  // All reports available for adding (same report can be added multiple times as different widget types)
  const availableReports = reports;

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

  // Slicer handler: when user selects values in a slicer
  // Always stores as array to keep checkbox state consistent
  const handleSlicerChange = (reportId: number, column: string, values: string[] | null) => {
    if (!column) return;

    if (values === null || values.length === 0) {
      // Clear filter
      removeFilter(reportId, column);
    } else {
      // Always use array format for slicers (even single value)
      setFilter(reportId, column, values, 'equals');
    }
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

      {/* Filter Bar */}
      <FilterBar
        dashboardId={dashboardId}
        availableReports={reports.length > 0 ? reports : widgets.map(w => ({ id: w.report_id, name: w.title })).filter((v, i, a) => a.findIndex(t => t.id === v.id) === i)}
        filtersByReport={filtersByReport}
        onFilterChange={(reportId, column, values) => handleSlicerChange(reportId, column, values.length > 0 ? values : null)}
        onFilterRemove={(reportId, column) => removeFilter(reportId, column)}
        onClearAll={clearAllFilters}
        canEdit={isAdminOrSuperuser}
      />

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
                getSelectedValues={(column) => getSelectedValues(widget.report_id, column)}
                onDrillDown={(value) => handleDrillDown(widget.report_id, widget.config?.groupBy || [], value)}
                onSlicerChange={(column, values) => handleSlicerChange(widget.report_id, column, values)}
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
          onAddSlicer={addSlicerWidget}
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
  getSelectedValues,
  onDrillDown,
  onSlicerChange
}: {
  widget: Widget;
  canEdit: boolean;
  onRemove: () => void;
  onConfigChange: (config: Widget['config']) => void;
  onToggleType: () => void;
  filters: Record<string, any>;
  getSelectedValues: (column: string) => any[];
  onDrillDown: (value: string) => void;
  onSlicerChange: (column: string, values: string[] | null) => void;
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
          ) : widget.widget_type === 'slicer' ? (
            <SlidersHorizontal className="w-4 h-4 text-purple-500" />
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
        {widget.widget_type === 'slicer' ? (
          // Slicer Widget
          <div className="h-full overflow-hidden">
            {config.slicerType === 'dropdown' ? (
              <DropdownSlicer
                reportId={widget.report_id}
                column={config.slicerColumn || ''}
                title={widget.title}
                selectedValue={getSelectedValues(config.slicerColumn || '')[0] ?? null}
                onSelectionChange={(value) => {
                  onSlicerChange(config.slicerColumn || '', value ? [value] : null);
                }}
              />
            ) : (
              <ListSlicer
                reportId={widget.report_id}
                column={config.slicerColumn || ''}
                title={widget.title}
                selectedValues={getSelectedValues(config.slicerColumn || '')}
                onSelectionChange={(values) => {
                  onSlicerChange(config.slicerColumn || '', values.length > 0 ? values : null);
                }}
                maxHeight={350}
              />
            )}
          </div>
        ) : widget.widget_type === 'chart' ? (
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
              value: f.filter,
              values: f.values
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
  onAddSlicer,
  onClose
}: {
  reports: Report[];
  onAdd: (reportId: number, type: 'grid' | 'chart') => void;
  onAddSlicer: (reportId: number, column: string, slicerType: 'list' | 'dropdown') => void;
  onClose: () => void;
}) {
  const [selectedReport, setSelectedReport] = useState<number | null>(null);
  const [widgetType, setWidgetType] = useState<'grid' | 'chart' | 'slicer'>('chart');
  const [schema, setSchema] = useState<any>(null);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [selectedColumn, setSelectedColumn] = useState<string | null>(null);
  const [slicerType, setSlicerType] = useState<'list' | 'dropdown'>('list');

  const getToken = () => localStorage.getItem('token');

  // Load schema when report selected and slicer type chosen
  useEffect(() => {
    if (!selectedReport || widgetType !== 'slicer') { setSchema(null); return; }
    setLoadingSchema(true);
    setSchema(null);
    setSelectedColumn(null);
    fetch(`/api/pivot/${selectedReport}/schema`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    })
      .then(res => res.json())
      .then(data => setSchema(data))
      .catch(() => setSchema(null))
      .finally(() => setLoadingSchema(false));
  }, [selectedReport, widgetType]);

  const handleAdd = () => {
    if (!selectedReport) return;
    if (widgetType === 'slicer') {
      if (!selectedColumn) return;
      onAddSlicer(selectedReport, selectedColumn, slicerType);
    } else {
      onAdd(selectedReport, widgetType);
    }
  };

  const canAdd = !!selectedReport && (widgetType !== 'slicer' || !!selectedColumn);

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
              <button
                type="button"
                onClick={() => setWidgetType('slicer')}
                className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border transition ${
                  widgetType === 'slicer'
                    ? 'border-purple-500 bg-purple-50 text-purple-700'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <SlidersHorizontal className="w-5 h-5" />
                Slicer
              </button>
            </div>
          </div>

          {/* Report Selection */}
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">Seleziona Report</label>
            {reports.length === 0 ? (
              <p className="text-slate-500 text-center py-8">
                Nessun report disponibile
              </p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-auto">
                {reports.map(report => (
                  <button
                    type="button"
                    key={report.id}
                    onClick={() => setSelectedReport(report.id)}
                    className={`w-full text-left p-3 rounded-lg border transition ${
                      selectedReport === report.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'hover:border-blue-300 hover:bg-slate-50'
                    }`}
                  >
                    <p className="font-medium text-sm">{report.name}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Slicer-specific options */}
          {widgetType === 'slicer' && selectedReport && (
            <>
              <div className="mb-4">
                <label className="block text-sm font-medium mb-2">Colonna</label>
                {loadingSchema ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                  </div>
                ) : !schema || schema.columns?.length === 0 ? (
                  <p className="text-slate-500 text-sm">Nessuna colonna disponibile</p>
                ) : (
                  <div className="space-y-1 max-h-36 overflow-auto border rounded-lg">
                    {schema.columns.map((col: any) => (
                      <button
                        type="button"
                        key={col.name}
                        onClick={() => setSelectedColumn(col.name)}
                        className={`w-full text-left px-3 py-1.5 text-sm transition ${
                          selectedColumn === col.name
                            ? 'bg-purple-50 text-purple-700 font-medium'
                            : 'hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        {col.label || col.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium mb-2">Stile Slicer</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSlicerType('list')}
                    className={`flex-1 p-2 text-sm rounded-lg border transition ${
                      slicerType === 'list'
                        ? 'border-purple-500 bg-purple-50 text-purple-700'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    Lista
                  </button>
                  <button
                    type="button"
                    onClick={() => setSlicerType('dropdown')}
                    className={`flex-1 p-2 text-sm rounded-lg border transition ${
                      slicerType === 'dropdown'
                        ? 'border-purple-500 bg-purple-50 text-purple-700'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    Dropdown
                  </button>
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
            onClick={handleAdd}
            disabled={!canAdd}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Aggiungi
          </button>
        </div>
      </div>
    </div>
  );
}
