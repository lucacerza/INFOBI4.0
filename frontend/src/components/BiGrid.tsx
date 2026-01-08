/**
 * BiGrid Component - Multi-Level Column Hierarchy Pivot Table
 *
 * Replaces Perspective.js with a custom implementation that supports:
 * - Multi-level column dimensions (not just single split_by)
 * - Perfect column alignment using flexbox pattern
 * - Hierarchical row grouping with expand/collapse
 * - Server-side aggregation (all calculations done in backend)
 * - Arrow IPC data format from backend
 * - Row virtualization for 1M+ rows performance
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import debounce from 'lodash.debounce';
import { Loader2, RefreshCw, ChevronRight, ChevronDown } from 'lucide-react';
import * as arrow from 'apache-arrow';
import { SkeletonTable } from './SkeletonLoader';
import { useDashboardStore } from '../stores/dashboardStore';
import './BiGrid.css';

interface MetricDefinition {
  name: string;
  field?: string;
  type: string;
  aggregation?: string;
  revenueField?: string;
  costField?: string;
}

interface BiGridProps {
  reportId: number;
  className?: string;
  defaultGroupBy?: string[];
  defaultSplitBy?: string[];  // Changed to array for multi-level!
  defaultMetrics?: MetricDefinition[];
  onConfigChange?: (config: any) => void;
  previewMode?: boolean;  // If true, limits aggregation to 100 rows for fast config
}

interface PivotConfig {
  group_by: string[];
  split_by: string[];  // Multi-level column dimensions
  metrics: MetricDefinition[];
  filters: Record<string, any>;
}

interface ColumnDef {
  accessorKey?: string;
  header: string;
  size: number;
  meta?: {
    isGroupColumn?: boolean;
    isTreeColumn?: boolean;
    isNumber?: boolean;
    isColumnGroup?: boolean;
    isLeafGroup?: boolean;
    level?: number;
    columnPath?: string;
    rowDimensions?: string[];
  };
  columns?: ColumnDef[];
}

// Pivot Engine (adapted from newpivot/pivot.js)
class PivotEngine {
  private data: any[];
  private rowDimensions: string[];
  private colDimensions: string[];
  private measures: string[];

  constructor(data: any[]) {
    this.data = data;
    this.rowDimensions = [];
    this.colDimensions = [];
    this.measures = ['value'];
  }

  setRowDimensions(dimensions: string[]) {
    this.rowDimensions = dimensions;
    return this;
  }

  setColDimensions(dimensions: string[]) {
    this.colDimensions = dimensions;
    return this;
  }

  setMeasures(measures: string[]) {
    this.measures = measures.filter(m => m);
    return this;
  }

  private calculateTreeColumnWidth(data: any[], rowDimensions: string[]): number {
    // Calculate optimal width based on:
    // 1. Maximum hierarchy depth (need space for indentation)
    // 2. Maximum text length in the tree column values

    const MIN_WIDTH = 200;
    const MAX_WIDTH = 500;
    const CHAR_WIDTH = 8; // Average pixel width per character in monospace font
    const INDENT_PER_LEVEL = 12; // Matches our CSS indent
    const EXPAND_BUTTON_WIDTH = 24; // Space for expand/collapse button
    const PADDING = 24; // Left/right padding

    // Estimate maximum depth by counting unique value combinations
    // For grouped data, depth = number of grouping levels
    const maxDepth = rowDimensions.length;

    // Sample first 100 rows to find longest value
    const sampleSize = Math.min(100, data.length);
    let maxTextLength = 0;

    for (let i = 0; i < sampleSize; i++) {
      const row = data[i];
      // Check all row dimension fields for longest text
      rowDimensions.forEach(dim => {
        const value = String(row[dim] || '');
        maxTextLength = Math.max(maxTextLength, value.length);
      });
    }

    // Calculate width: indent + button + text + padding
    const maxIndent = maxDepth * INDENT_PER_LEVEL;
    const textWidth = maxTextLength * CHAR_WIDTH;
    const calculatedWidth = maxIndent + EXPAND_BUTTON_WIDTH + textWidth + PADDING;

    // Clamp between min and max
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, calculatedWidth));
  }

  generate() {
    // No column dimensions = simple row grouping only
    if (this.colDimensions.length === 0) {
      return this.generateRowsOnly();
    }

    // With column dimensions: backend returns pivoted data with columns like "2022|Venduto"
    return this.generateAlreadyPivoted();
  }

  private generateRowsOnly() {
    return {
      data: this.data,
      columns: this.buildSimpleColumns(),
      grouping: this.rowDimensions,
      isPivoted: false
    };
  }

  private buildSimpleColumns(): ColumnDef[] {
    if (this.data.length === 0) return [];

    const columns: ColumnDef[] = [];
    const sampleRow = this.data[0];
    const rowDimSet = new Set(this.rowDimensions);

    // FIXED: When row dimensions exist, create a single tree column for hierarchical display
    if (this.rowDimensions.length > 0) {
      // Calculate optimal width based on content and hierarchy depth
      const treeColumnWidth = this.calculateTreeColumnWidth(this.data, this.rowDimensions);

      columns.push({
        accessorKey: this.rowDimensions[0],
        header: this.rowDimensions.join(' > '),
        size: treeColumnWidth,
        meta: {
          isGroupColumn: true,
          isTreeColumn: true,
          rowDimensions: this.rowDimensions
        }
      });
    }

    // Add other columns (metrics and non-dimension fields)
    Object.keys(sampleRow).forEach(key => {
      if (!rowDimSet.has(key)) {
        const isNumber = typeof sampleRow[key] === 'number';
        columns.push({
          accessorKey: key,
          header: key.charAt(0).toUpperCase() + key.slice(1),
          size: 150,
          meta: { isNumber }
        });
      }
    });

    return columns;
  }

  private generateAlreadyPivoted() {
    // Backend returns already-pivoted data with column structure: [Group1, Group2, ..., MetricCol1, MetricCol2, ...]
    // Example: [Cliente, 2023, 2024, 2025] where 2023/2024/2025 are pivoted metric columns

    if (this.data.length === 0) {
      return {
        data: [],
        columns: [],
        grouping: this.rowDimensions,
        isPivoted: true
      };
    }

    const columns: ColumnDef[] = [];
    const sampleRow = this.data[0];
    const rowDimSet = new Set(this.rowDimensions);

    // Add tree column for row dimensions
    if (this.rowDimensions.length > 0) {
      // Calculate optimal width based on content and hierarchy depth
      const treeColumnWidth = this.calculateTreeColumnWidth(this.data, this.rowDimensions);

      columns.push({
        accessorKey: this.rowDimensions[0],
        header: this.rowDimensions.join(' > '),
        size: treeColumnWidth,
        meta: {
          isGroupColumn: true,
          isTreeColumn: true,
          rowDimensions: this.rowDimensions
        }
      });
    }

    // Detect pivoted columns (all columns except row dimensions)
    const pivotedColumns = Object.keys(sampleRow).filter(key => !rowDimSet.has(key));

    // Build hierarchical column structure from pivoted column names
    // Example: "Electronics|2023" -> hierarchy with Electronics -> 2023
    const hierarchy = this.buildColumnHierarchyFromNames(pivotedColumns);
    const columnGroups = this.buildColumnGroupsRecursive(hierarchy, 0);
    columns.push(...columnGroups);

    return {
      data: this.data,
      columns,
      grouping: this.rowDimensions,
      isPivoted: true
    };
  }

  private buildColumnHierarchyFromNames(columnNames: string[]): any {
    // Build hierarchy from column names that use pipe separator
    // Example: ["Electronics|2023", "Electronics|2024", "Furniture|2023"]
    const hierarchy: any = {};

    columnNames.forEach(colName => {
      const parts = colName.includes('|') ? colName.split('|') : [colName];
      let current = hierarchy;

      parts.forEach((part, idx) => {
        if (!current[part]) {
          current[part] = {
            _isLeaf: idx === parts.length - 1,
            _fullPath: parts.slice(0, idx + 1).join('|'),
            _colName: colName,  // Store original column name for accessor
            _children: {}
          };
        }
        current = current[part]._children;
      });
    });

    return hierarchy;
  }

  private generateFullPivot() {
    const { pivotedData, columnPaths } = this.pivotData();
    const columns = this.buildPivotColumns(columnPaths);

    return {
      data: pivotedData,
      columns,
      grouping: this.rowDimensions,
      isPivoted: true,
      columnPaths
    };
  }

  private pivotData() {
    const groupedMap = new Map<string, any>();
    const columnPathsSet = new Set<string>();

    this.data.forEach(row => {
      // Build row key
      const rowKey = this.rowDimensions.map(k => row[k]).join('|||');

      // Build column path
      const colPath = this.colDimensions.map(d => row[d]).join('|');
      columnPathsSet.add(colPath);

      // Get or create pivoted row
      if (!groupedMap.has(rowKey)) {
        const baseRow: any = {};
        this.rowDimensions.forEach(k => baseRow[k] = row[k]);
        groupedMap.set(rowKey, baseRow);
      }

      const targetRow = groupedMap.get(rowKey)!;

      // Add measure values
      this.measures.forEach(measure => {
        if (row[measure] !== undefined) {
          const colKey = `${colPath}_${measure}`;
          targetRow[colKey] = row[measure];
        }
      });
    });

    return {
      pivotedData: Array.from(groupedMap.values()),
      columnPaths: Array.from(columnPathsSet).sort()
    };
  }

  private buildPivotColumns(columnPaths: string[]): ColumnDef[] {
    const columns: ColumnDef[] = [];

    // Single tree column for ALL row dimensions
    if (this.rowDimensions.length > 0) {
      columns.push({
        accessorKey: this.rowDimensions[0],
        header: this.rowDimensions.join(' > '),
        size: 200,
        meta: {
          isGroupColumn: true,
          isTreeColumn: true,
          rowDimensions: this.rowDimensions
        }
      });
    }

    // Build hierarchical column structure
    const hierarchy = this.buildColumnHierarchy(columnPaths);
    const columnGroups = this.buildColumnGroupsRecursive(hierarchy, 0);
    columns.push(...columnGroups);

    return columns;
  }

  private buildColumnHierarchy(columnPaths: string[]): any {
    const hierarchy: any = {};

    columnPaths.forEach(path => {
      const parts = path.split('|');
      let current = hierarchy;

      parts.forEach((part, idx) => {
        if (!current[part]) {
          current[part] = {
            _isLeaf: idx === parts.length - 1,
            _fullPath: parts.slice(0, idx + 1).join('|'),
            _children: {}
          };
        }
        current = current[part]._children;
      });
    });

    return hierarchy;
  }

  private buildColumnGroupsRecursive(hierarchy: any, level: number): ColumnDef[] {
    const groups: ColumnDef[] = [];

    Object.entries(hierarchy).forEach(([key, node]: [string, any]) => {
      if (key.startsWith('_')) return;

      if (node._isLeaf) {
        // Leaf level: If this comes from already-pivoted data, use the column name directly
        if (node._colName) {
          // Already-pivoted data: single column for this leaf
          groups.push({
            accessorKey: node._colName,
            header: key,
            size: 120,
            meta: {
              isNumber: true,
              columnPath: node._fullPath
            }
          });
        } else {
          // Client-side pivoted data: create measure columns
          const measureColumns: ColumnDef[] = this.measures.map(measure => ({
            accessorKey: `${node._fullPath}_${measure}`,
            header: measure.charAt(0).toUpperCase() + measure.slice(1),
            size: 120,
            meta: {
              isNumber: true,
              columnPath: node._fullPath
            }
          }));

          groups.push({
            header: key,
            size: 120 * measureColumns.length,
            columns: measureColumns,
            meta: { isColumnGroup: true, level, isLeafGroup: true }
          });
        }
      } else {
        // Non-leaf: recurse
        const childGroups = this.buildColumnGroupsRecursive(node._children, level + 1);
        const totalSize = childGroups.reduce((sum, g) => sum + g.size, 0);
        groups.push({
          header: key,
          size: totalSize,
          columns: childGroups,
          meta: { isColumnGroup: true, level }
        });
      }
    });

    return groups;
  }
}

export default function BiGrid({
  reportId,
  className = '',
  defaultGroupBy = [],
  defaultSplitBy = [],
  defaultMetrics = [],
  onConfigChange,
  previewMode = false
}: BiGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ rows: 0, time: 0, cached: false });
  const [schema, setSchema] = useState<any>(null);
  const [currentConfig, setCurrentConfig] = useState<PivotConfig>({
    group_by: defaultGroupBy,
    split_by: defaultSplitBy,
    metrics: defaultMetrics,
    filters: {}
  });
  const [pivotResult, setPivotResult] = useState<any>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Update config when defaults change and execute pivot
  useEffect(() => {
    // IMPORTANT: If user selects Group By but no metrics, we need to ensure
    // at least ONE metric exists so backend knows what to aggregate
    // Default to COUNT(*) if no metrics specified
    const effectiveMetrics = defaultMetrics.length > 0
      ? defaultMetrics
      : (defaultGroupBy.length > 0 || defaultSplitBy.length > 0)
        ? [{ name: 'count', field: '*', type: 'count', aggregation: 'COUNT' }]
        : [];

    const newConfig = {
      group_by: defaultGroupBy,
      split_by: defaultSplitBy,
      metrics: effectiveMetrics,
      filters: {}
    };
    setCurrentConfig(newConfig);

    // Execute pivot ONLY if schema is loaded AND config is not empty
    // Don't waste time querying DB when user hasn't selected anything yet
    if (schema && (defaultGroupBy.length > 0 || defaultSplitBy.length > 0 || defaultMetrics.length > 0)) {
      console.log('🔵 [BiGrid] Executing pivot with config:', newConfig);
      executePivot(newConfig);
    } else if (schema) {
      // Schema loaded but config empty - show empty state
      console.log('⚪ [BiGrid] Config is empty, showing empty state');
      setPivotResult({
        data: [],
        columns: [],
        grouping: [],
        isPivoted: false
      });
      setIsLoading(false);
    }
  }, [defaultGroupBy, defaultSplitBy, defaultMetrics, schema]);

  // Load schema on mount
  useEffect(() => {
    loadSchema();
  }, [reportId]);

  const loadSchema = async () => {
    try {
      const response = await fetch(`/api/pivot/${reportId}/schema`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (!response.ok) throw new Error('Failed to load schema');

      const data = await response.json();
      setSchema(data);

      // DON'T execute pivot here - let the useEffect at line 302 handle it
      // This avoids race conditions and duplicate executions

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setIsLoading(false);
    }
  };

  const executePivot = async (config: PivotConfig) => {
    setIsLoading(true);
    setError(null);

    try {
      const t0 = performance.now();
      console.log('🔵 [PERF] BiGrid START', { config });

      // Call backend with multi-level split_by
      const t1 = performance.now();

      // PREVIEW MODE: Add limit=100 for fast configuration
      const requestBody = previewMode
        ? { ...config, limit: 100 }
        : config;

      const response = await fetch(`/api/pivot/${reportId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(requestBody)
      });
      const t2 = performance.now();
      console.log(`🟡 [PERF] Backend fetch: ${(t2-t1).toFixed(0)}ms`);

      if (!response.ok) throw new Error('Pivot request failed');

      const queryTime = parseFloat(response.headers.get('X-Query-Time') || '0');
      const cached = response.headers.get('X-Cache-Hit') === 'true';
      const rowCount = response.headers.get('X-Row-Count');

      // Parse Arrow data
      const t3 = performance.now();
      const arrayBuffer = await response.arrayBuffer();
      const t4 = performance.now();
      console.log(`🟡 [PERF] Arrow download: ${(t4-t3).toFixed(0)}ms, size: ${(arrayBuffer.byteLength/1024).toFixed(1)}KB`);

      const table = arrow.tableFromIPC(arrayBuffer);
      const t5 = performance.now();
      console.log(`🟡 [PERF] Arrow parse IPC: ${(t5-t4).toFixed(0)}ms, rows: ${table.numRows}`);

      // Convert to plain objects - OPTIMIZED: use table.toArray() which is much faster
      const data = table.toArray().map(row => {
        const obj: any = {};
        table.schema.fields.forEach((field) => {
          obj[field.name] = row[field.name];
        });
        return obj;
      });
      const t6 = performance.now();
      console.log(`🟡 [PERF] Arrow to objects: ${(t6-t5).toFixed(0)}ms`);

      // Build pivot using engine
      const engine = new PivotEngine(data);
      engine.setRowDimensions(config.group_by);
      engine.setColDimensions(config.split_by);
      engine.setMeasures(config.metrics.map(m => m.name));

      const t7 = performance.now();
      const result = engine.generate();
      const t8 = performance.now();
      console.log(`🟡 [PERF] PivotEngine generate: ${(t8-t7).toFixed(0)}ms`);
      console.log('🔵 [BiGrid] PivotEngine result:', {
        grouping: result.grouping,
        isPivoted: result.isPivoted,
        dataRows: result.data.length,
        columns: result.columns.length
      });

      setPivotResult(result);
      const t9 = performance.now();
      console.log(`🟡 [PERF] React setState: ${(t9-t8).toFixed(0)}ms`);

      const rows = parseInt(rowCount || '0');
      setStats({
        rows,
        time: queryTime,
        cached
      });

      // Warn user if hit the 10k limit (raw data only)
      if (rows === 10000 && config.group_by.length === 0 && config.split_by.length === 0) {
        console.warn('⚠️ Raw data limited to 10,000 rows. Use Pivot (add dimensions) to aggregate millions of rows.');
      }

      const tTotal = performance.now();
      console.log(`🟢 [PERF] TOTAL BiGrid render: ${(tTotal-t0).toFixed(0)}ms`);
      console.log(`📊 [PERF] Breakdown: Fetch=${(t2-t1).toFixed(0)}ms | Download=${(t4-t3).toFixed(0)}ms | Parse=${(t5-t4).toFixed(0)}ms | Convert=${(t6-t5).toFixed(0)}ms | Engine=${(t8-t7).toFixed(0)}ms`);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      console.error('🔴 [PERF] BiGrid ERROR:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const debouncedPivotRequest = useCallback(
    debounce(async (config: PivotConfig) => {
      await executePivot(config);
    }, 300),
    [reportId]
  );

  const handleConfigChange = (field: keyof PivotConfig, value: any) => {
    const newConfig = { ...currentConfig, [field]: value };
    setCurrentConfig(newConfig);
    debouncedPivotRequest(newConfig);
    onConfigChange?.(newConfig);
  };

  const handleRefresh = () => {
    executePivot(currentConfig);
  };

  const toggleRow = (rowKey: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(rowKey)) {
      newExpanded.delete(rowKey);
    } else {
      newExpanded.add(rowKey);
    }
    setExpandedRows(newExpanded);
  };

  // Render table using BiGrid pattern
  useEffect(() => {
    if (!pivotResult || !containerRef.current) return;

    // Always use grouping for hierarchical display, even with split_by
    const groupingToUse = pivotResult.isPivoted
      ? pivotResult.grouping  // Use row dimensions even in pivot mode
      : pivotResult.grouping;

    renderBiGrid(
      containerRef.current,
      pivotResult.columns,
      pivotResult.data,
      groupingToUse,
      expandedRows,
      toggleRow
    );
  }, [pivotResult, expandedRows]);

  // Auto-resize columns: compute optimal widths based on header and sample data
  useEffect(() => {
    if (!pivotResult) return;

    // Create canvas for text measurement
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Match default font used in app (tailwind base)
    ctx.font = '14px Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial';

    const measureText = (text: string) => {
      try {
        return Math.ceil(ctx.measureText(String(text || '')).width);
      } catch (e) {
        return 80;
      }
    };

    const flatCols: ColumnDef[] = flattenColumns(pivotResult.columns || []);

    // Sample up to N rows for content width
    const sampleRows = (pivotResult.data || []).slice(0, 200);

    const updatedCols = flatCols.map(col => {
      // Header width
      const headerW = measureText(col.header) + 24; // padding

      if (col.meta?.isTreeColumn) {
        // Tree column: account for indentation and expand button
        const indentPerLevel = 12;
        const maxDepth = (pivotResult.grouping || []).length || 1;
        // compute longest value among grouping fields
        let maxText = 0;
        sampleRows.forEach(r => {
          (pivotResult.grouping || []).forEach(g => {
            maxText = Math.max(maxText, String(r[g] || '').length);
          });
        });
        const textW = maxText * 7; // approximate char width
        const calc = Math.max(160, Math.min(600, textW + (maxDepth * indentPerLevel) + 60));
        return { ...col, size: Math.max(calc, headerW) };
      }

      // For data columns, measure a few sample values to determine width
      let maxContentW = 0;
      sampleRows.forEach(r => {
        const v = r[col.accessorKey || ''];
        const formatted = (col.meta?.isNumber && typeof v === 'number') ? v.toLocaleString() : (v || '');
        maxContentW = Math.max(maxContentW, measureText(formatted));
      });

      // Minimum/maximum constraints
      const minW = 80;
      const maxW = 400;
      const contentW = Math.max(minW, Math.min(maxW, maxContentW + 24));

      const newSize = Math.max(headerW, contentW);
      return { ...col, size: newSize };
    });

    // Rebuild hierarchical columns with updated sizes
    function rebuildWithSizes(cols: ColumnDef[]): ColumnDef[] {
      return cols.map(c => {
        if (c.columns && c.columns.length > 0) {
          const children = rebuildWithSizes(c.columns);
          const total = children.reduce((s, ch) => s + ch.size, 0);
          return { ...c, columns: children, size: total };
        }
        const leaf = updatedCols.find(u => u.accessorKey === c.accessorKey && u.header === c.header);
        return leaf ? { ...c, size: leaf.size } : c;
      });
    }

    const newColumns = rebuildWithSizes(pivotResult.columns || []);

    // Compare sizes to avoid unnecessary state updates
    let changed = false;
    const oldFlat = flattenColumns(pivotResult.columns || []);
    const newFlat = flattenColumns(newColumns);
    if (oldFlat.length === newFlat.length) {
      for (let i = 0; i < oldFlat.length; i++) {
        if (oldFlat[i].size !== newFlat[i].size) { changed = true; break; }
      }
    } else {
      changed = true;
    }

    if (changed) {
      setPivotResult({ ...pivotResult, columns: newColumns });
    }
  }, [pivotResult]);

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Stats Bar (minimal) */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-white">
        <div className="flex items-center gap-3 text-xs text-gray-500">
          {stats.cached && (
            <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded">CACHE</span>
          )}
          <span>{stats.rows.toLocaleString()} righe</span>
          <span className="text-green-600 font-medium">{stats.time}ms</span>
        </div>

        <button
          onClick={handleRefresh}
          disabled={isLoading}
          className="p-2 hover:bg-gray-100 rounded-lg transition"
          title="Aggiorna"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-red-50 text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Warning: 10k limit reached */}
      {stats && stats.rows === 10000 && currentConfig && currentConfig.group_by.length === 0 && currentConfig.split_by.length === 0 && (
        <div className="px-4 py-3 bg-amber-50 border-l-4 border-amber-400 text-amber-800 text-sm flex items-start gap-2">
          <span className="text-lg">⚠️</span>
          <div>
            <p className="font-semibold">Limite 10.000 righe raggiunto</p>
            <p className="text-xs mt-1">
              Stai visualizzando solo le prime 10.000 righe di {(3599123).toLocaleString()}.
              <strong className="ml-1">Usa il Pivot</strong> (aggiungi dimensioni Righe/Colonne) per aggregare e analizzare milioni di righe istantaneamente.
            </p>
          </div>
        </div>
      )}

      {/* BiGrid container with skeleton loading */}
      {isLoading ? (
        <div className="flex-1 overflow-hidden">
          <SkeletonTable rows={15} columns={6} />
        </div>
      ) : (
        <div
          ref={containerRef}
          className="flex-1 relative bg-white"
          style={{ minHeight: '400px' }}
        />
      )}
    </div>
  );
}

// BiGrid rendering functions (adapted from newpivot/app.js)
function renderBiGrid(
  container: HTMLDivElement,
  columns: ColumnDef[],
  data: any[],
  grouping: string[],
  expandedRows: Set<string>,
  toggleRow: (key: string) => void
) {
  const headerLevels = getHeaderLevels(columns);
  const flatColumns = flattenColumns(columns);

  // Build grouped data
  const groupedData = grouping.length > 0 ? buildGroupedData(data, grouping, expandedRows) : data;

  console.log('🔵 [BiGrid] Render:', {
    grouping,
    dataRows: data.length,
    groupedRows: groupedData.length,
    sampleGrouped: groupedData[0]
  });

  // Wrapper with horizontal scroll (both header and body scroll together)
  // IMPORTANT: Horizontal scroll container must allow sticky positioning
  let html = '<div class="bigrid-scroll-wrapper" style="width: 100%; height: 100%; overflow-x: auto; overflow-y: hidden; position: relative;">';
  html += '<div class="bigrid-table">';

  // Render header (fixed at top, scrolls horizontally with body)
  html += renderHeader(headerLevels, flatColumns);

  // Render body (scrolls vertically, width matches header)
  html += '<div class="bigrid-body">';
  groupedData.forEach(row => {
    html += renderRow(row, flatColumns, grouping, expandedRows, toggleRow);
  });
  html += '</div>';

  html += '</div>';
  html += '</div>'; // Close scroll wrapper

  container.innerHTML = html;

  // Attach event listeners for expand/collapse
  container.querySelectorAll('.expand-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const rowKey = target.getAttribute('data-row-key');
      if (rowKey) toggleRow(rowKey);
    });
  });
}

function getHeaderLevels(columns: ColumnDef[]): ColumnDef[][] {
  const levels: ColumnDef[][] = [];

  function traverse(cols: ColumnDef[], level: number) {
    if (!levels[level]) levels[level] = [];

    cols.forEach(col => {
      if (col.columns && col.columns.length > 0) {
        levels[level].push(col);
        traverse(col.columns, level + 1);
      } else {
        levels[level].push(col);
      }
    });
  }

  traverse(columns, 0);
  return levels;
}

function flattenColumns(columns: ColumnDef[]): ColumnDef[] {
  const result: ColumnDef[] = [];

  function traverse(cols: ColumnDef[]) {
    cols.forEach(col => {
      if (col.columns && col.columns.length > 0) {
        traverse(col.columns);
      } else {
        result.push(col);
      }
    });
  }

  traverse(columns);
  return result;
}

function renderHeader(levels: ColumnDef[][], flatColumns: ColumnDef[]): string {
  let html = '<div class="bigrid-header">';

  // Find tree column size
  let treeColumnSize = 0;
  if (levels.length > 0) {
    const treeCol = levels[0].find(c => c.meta?.isTreeColumn);
    if (treeCol) treeColumnSize = treeCol.size;
  }

  levels.forEach((level, levelIdx) => {
    html += '<div class="bigrid-header-row">';

    let hasTreeColumn = false;
    level.forEach(cell => {
      const isTreeColumn = cell.meta?.isTreeColumn;

      if (isTreeColumn) {
        hasTreeColumn = true;
        if (levelIdx === 0) {
          html += `<div class="bigrid-header-cell tree-col" style="width: ${cell.size}px; flex: 0 0 ${cell.size}px;">
            ${cell.header}
          </div>`;
        }
      } else {
        const isColumnGroup = cell.meta?.isColumnGroup;
        const isNumber = cell.meta?.isNumber;
        html += `<div class="bigrid-header-cell ${isColumnGroup ? 'col-group' : ''} ${isNumber ? 'text-right' : ''}"
          style="width: ${cell.size}px; flex: 0 0 ${cell.size}px;">
          ${cell.header}
        </div>`;
      }
    });

    // Add placeholder for alignment
    if (levelIdx > 0 && treeColumnSize > 0 && !hasTreeColumn) {
      const placeholder = `<div class="bigrid-header-cell header-placeholder"
        style="width: ${treeColumnSize}px; flex: 0 0 ${treeColumnSize}px; visibility: hidden; border: none;">
        &nbsp;
      </div>`;
      const rowContent = html.substring(html.lastIndexOf('<div class="bigrid-header-row">') + 31);
      html = html.substring(0, html.lastIndexOf('<div class="bigrid-header-row">') + 31);
      html += placeholder + rowContent;
    }

    html += '</div>';
  });

  html += '</div>';
  return html;
}

function renderRow(
  row: any,
  columns: ColumnDef[],
  grouping: string[],
  expandedRows: Set<string>,
  toggleRow: (key: string) => void
): string {
  const isGroup = row._isGroup;
  const depth = row._depth || 0;
  const isExpanded = expandedRows.has(row._groupKey);

  let html = `<div class="bigrid-row ${isGroup ? 'group-row' : ''}" data-depth="${depth}">`;

  columns.forEach(col => {
    const isTreeColumn = col.meta?.isTreeColumn;
    const isNumber = col.meta?.isNumber;

    if (isTreeColumn && isGroup) {
      // Group row with expand button (only if it has children)
      const indent = depth * 12;
      const hasChildren = row._children && row._children.length > 0;

      if (hasChildren) {
        html += `<div class="bigrid-cell tree-col" style="width: ${col.size}px; flex: 0 0 ${col.size}px;">
          <div style="padding-left: ${indent}px;" class="flex items-center gap-2">
            <button class="expand-btn" data-row-key="${row._groupKey}">
              ${isExpanded ? '▼' : '▶'}
            </button>
            <span class="group-value">${row._groupValue}</span>
          </div>
        </div>`;
      } else {
        // Leaf level group - no expand button, just show the value
        html += `<div class="bigrid-cell tree-col" style="width: ${col.size}px; flex: 0 0 ${col.size}px;">
          <div style="padding-left: ${indent}px;" class="flex items-center gap-2">
            <span style="width: 20px;"></span>
            <span class="group-value">${row._groupValue}</span>
          </div>
        </div>`;
      }
    } else if (isTreeColumn) {
      // Regular row in tree column (leaf nodes)
      const indent = depth * 12 + 20;
      const value = row[col.accessorKey || ''] || '';
      html += `<div class="bigrid-cell tree-col" style="width: ${col.size}px; flex: 0 0 ${col.size}px;">
        <div style="padding-left: ${indent}px;">${value}</div>
      </div>`;
    } else {
      // Data cell
      const value = row[col.accessorKey || ''];
      const formatted = isNumber && typeof value === 'number' ? value.toLocaleString() : (value || '');
      html += `<div class="bigrid-cell ${isNumber ? 'text-right' : ''}" style="width: ${col.size}px; flex: 0 0 ${col.size}px;">
        ${formatted}
      </div>`;
    }
  });

  html += '</div>';

  // Render children if expanded
  if (isGroup && isExpanded && row._children) {
    row._children.forEach((child: any) => {
      html += renderRow(child, columns, grouping, expandedRows, toggleRow);
    });
  }

  return html;
}

function buildGroupedData(data: any[], grouping: string[], expandedRows: Set<string>): any[] {
  // If no grouping, return flat data
  if (grouping.length === 0) return data;

  function buildHierarchy(rows: any[], dimensions: string[], depth = 0): any[] {
    if (depth >= dimensions.length) return rows;

    const dimension = dimensions[depth];
    const groups = new Map<any, any[]>();

    rows.forEach(row => {
      const value = row[dimension];
      if (!groups.has(value)) groups.set(value, []);
      groups.get(value)!.push(row);
    });

    const isLeafLevel = depth === dimensions.length - 1;

    const result: any[] = [];
    groups.forEach((groupRows, value) => {
      const groupKey = dimensions.slice(0, depth + 1).map(d => groupRows[0][d]).join('|||');

      const groupRow: any = {
        _isGroup: true,
        _groupKey: groupKey,
        _groupField: dimension,
        _groupValue: value,
        _depth: depth,
        // At leaf level, don't create children - the group row itself contains the aggregated values
        _children: isLeafLevel ? [] : buildHierarchy(groupRows, dimensions, depth + 1)
      };

      // Set dimension value on group row
      groupRow[dimension] = value;

      // Aggregate ALL columns (both simple metrics and pivoted columns like "2023_venduto")
      const allKeys = new Set<string>();
      groupRows.forEach(r => Object.keys(r).forEach(k => allKeys.add(k)));

      allKeys.forEach(key => {
        if (!dimensions.includes(key) && !key.startsWith('_')) {
          const values = groupRows.map(r => r[key]).filter(v => v !== undefined && v !== null && typeof v === 'number');
          if (values.length > 0) {
            groupRow[key] = values.reduce((a, b) => a + b, 0);
          }
        }
      });

      result.push(groupRow);
    });

    return result;
  }

  return buildHierarchy(data, grouping);
}
