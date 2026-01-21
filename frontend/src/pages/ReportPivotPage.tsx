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
import TreeDataGrid from '../components/TreeDataGrid';
import BiGridConfig from '../components/BiGridConfig';
import {
  ArrowLeft, Download, Settings, Loader2,
  ChevronRight, Save, LayoutGrid, Edit
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
  const [showBuilder, setShowBuilder] = useState(true);
  const [pivotConfig, setPivotConfig] = useState<PivotConfig>({
    rows: [],
    columns: [],
    values: [],
    orderBy: [],
    filters: []
  });

  const getToken = () => localStorage.getItem('token');

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
      const reportRes = await fetch(`/api/reports/${reportId}`, {
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
      if (!reportRes.ok) throw new Error('Report non trovato');
      const reportData = await reportRes.json();
      setReport(reportData);

      // Get schema for pivot builder
      const schemaRes = await fetch(`/api/pivot/${reportId}/schema`, {
        headers: { 'Authorization': `Bearer ${getToken()}` }
      });
      if (!schemaRes.ok) throw new Error('Schema non disponibile');
      const schemaData = await schemaRes.json();
      setSchema(schemaData);

      // Load SAVED pivot configuration from DB (if exists)
      let initialConfig: PivotConfig;
      try {
        const configRes = await fetch(`/api/pivot/${reportId}/config`, {
          headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (configRes.ok) {
          const savedConfig = await configRes.json();
          // Use saved config if it has data
          if (savedConfig.rows?.length > 0 || savedConfig.values?.length > 0) {
            initialConfig = savedConfig;
            console.log('✅ Loaded SAVED pivot config from DB:', savedConfig);
          } else {
            throw new Error('Empty config, use defaults');
          }
        } else {
          throw new Error('No saved config');
        }
      } catch (err) {
        // Fallback: Auto-populate ALL fields in Columns for immediate flat table view
        // User can then remove fields, add grouping, split columns, etc.
        console.log('⚠️ No saved config found, auto-populating all fields');

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

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-blue-500 mx-auto mb-3" />
          <p className="text-slate-500">Caricamento...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <Link to="/reports" className="p-2 hover:bg-slate-100 rounded-lg">
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </Link>
          <div>
            <h1 className="font-semibold text-slate-800 flex items-center gap-2">
              <LayoutGrid className="w-5 h-5 text-blue-500" />
              {report?.name || 'Pivot Table'}
            </h1>
            <p className="text-xs text-slate-500">Gerarchia multi-livello con BiGrid</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Toggle Builder */}
          <button
            onClick={() => setShowBuilder(!showBuilder)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
              showBuilder
                ? 'bg-blue-100 text-blue-700'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Settings className="w-4 h-4" />
            Configurazione
          </button>

          {/* Edit Report (go to editor) */}
          {user?.role === 'admin' && (
            <Link
              to={`/reports/${reportId}/edit`}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-purple-600 hover:bg-purple-700 text-white transition"
            >
              <Edit className="w-4 h-4" />
              Modifica
            </Link>
          )}
        </div>
      </div>

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
      <div className="bg-white border-t px-4 py-2 flex items-center justify-between text-xs text-slate-600 flex-shrink-0">
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
          <span className="px-2 py-1 bg-green-100 text-green-700 rounded font-medium">
            Multi-Level ✓
          </span>
        </div>
      </div>
    </div>
  );
}
