/**
 * FilterBar - Barra filtri per dashboard
 * Stile scuro coerente con sidebar BiGridConfig (#2b2b2b)
 * Configurazione salvata in localStorage per utente
 */
import { useState, useEffect, useRef } from 'react';
import { Filter, Plus, X, Loader2 } from 'lucide-react';
import FilterBarDropdown from './FilterBarDropdown';

export interface FilterBarConfig {
  reportId: number;
  column: string;
  columnLabel: string;
}

interface FilterBarProps {
  dashboardId: number;
  availableReports: { id: number; name: string }[];
  filtersByReport: Record<number, Record<string, any>>;
  onFilterChange: (reportId: number, column: string, values: string[]) => void;
  onFilterRemove: (reportId: number, column: string) => void;
  onClearAll: () => void;
  canEdit: boolean;
}

function getStorageKey(dashboardId: number) {
  return `filterBar_${dashboardId}`;
}

function loadFilterBarConfig(dashboardId: number): FilterBarConfig[] {
  try {
    const saved = localStorage.getItem(getStorageKey(dashboardId));
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function saveFilterBarConfig(dashboardId: number, config: FilterBarConfig[]) {
  localStorage.setItem(getStorageKey(dashboardId), JSON.stringify(config));
}

export default function FilterBar({
  dashboardId,
  availableReports,
  filtersByReport,
  onFilterChange,
  onFilterRemove,
  onClearAll,
  canEdit
}: FilterBarProps) {
  const [filters, setFilters] = useState<FilterBarConfig[]>([]);
  const [showAddPopover, setShowAddPopover] = useState(false);
  const addBtnRef = useRef<HTMLDivElement>(null);

  // Load from localStorage on mount
  useEffect(() => {
    setFilters(loadFilterBarConfig(dashboardId));
  }, [dashboardId]);

  const updateFilters = (newFilters: FilterBarConfig[]) => {
    setFilters(newFilters);
    saveFilterBarConfig(dashboardId, newFilters);
  };

  const addFilter = (reportId: number, column: string, columnLabel: string) => {
    // Avoid duplicates
    if (filters.some(f => f.reportId === reportId && f.column === column)) return;
    updateFilters([...filters, { reportId, column, columnLabel }]);
    setShowAddPopover(false);
  };

  const removeFilter = (reportId: number, column: string) => {
    updateFilters(filters.filter(f => !(f.reportId === reportId && f.column === column)));
    onFilterRemove(reportId, column);
  };

  // Count total active filter selections
  const totalActiveSelections = Object.values(filtersByReport).reduce((total, reportFilters) => {
    return total + Object.keys(reportFilters).length;
  }, 0);

  // Get selected values for a filter from store
  const getSelectedValues = (reportId: number, column: string): string[] => {
    const f = filtersByReport[reportId]?.[column];
    if (!f) return [];
    if (f.values && Array.isArray(f.values)) return f.values;
    if (f.filter) return [f.filter];
    return [];
  };

  // Check if multiple reports are used
  const reportIds = [...new Set(filters.map(f => f.reportId))];
  const isMultiReport = reportIds.length > 1;

  // Don't render if no filters and user can't edit
  if (filters.length === 0 && !canEdit) return null;

  return (
    <div className="bg-[#2b2b2b] border-b border-[#1a1a1a] px-4 py-2 flex-shrink-0">
      <div className="flex items-center gap-2 flex-wrap">
        {/* Label */}
        <div className="flex items-center gap-1.5 text-gray-400">
          <Filter className="w-3.5 h-3.5" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400">Filtri</span>
        </div>

        {/* Filter Dropdowns */}
        {filters.map((filter) => {
          const reportName = availableReports.find(r => r.id === filter.reportId)?.name;
          return (
            <div key={`${filter.reportId}-${filter.column}`} className="group relative">
              {isMultiReport && reportName && (
                <span className="absolute -top-3 left-1 text-[8px] text-gray-500 truncate max-w-[100px]">
                  {reportName}
                </span>
              )}
              <FilterBarDropdown
                reportId={filter.reportId}
                column={filter.column}
                columnLabel={filter.columnLabel}
                selectedValues={getSelectedValues(filter.reportId, filter.column)}
                onSelectionChange={(values) => onFilterChange(filter.reportId, filter.column, values)}
                onRemove={() => removeFilter(filter.reportId, filter.column)}
              />
            </div>
          );
        })}

        {/* Add Filter Button */}
        {canEdit && (
          <div className="relative" ref={addBtnRef}>
            <button
              type="button"
              onClick={() => setShowAddPopover(!showAddPopover)}
              className="flex items-center gap-1 px-2 py-1 text-[10px] border border-dashed border-[#555] text-gray-500 rounded hover:border-blue-400 hover:text-blue-400 transition-colors"
            >
              <Plus className="w-3 h-3" />
              Filtro
            </button>

            {showAddPopover && (
              <AddFilterPopover
                reports={availableReports}
                existingFilters={filters}
                onAdd={addFilter}
                onClose={() => setShowAddPopover(false)}
                containerRef={addBtnRef}
              />
            )}
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Clear All */}
        {totalActiveSelections > 0 && (
          <button
            type="button"
            onClick={onClearAll}
            className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-red-400 transition-colors"
          >
            <X className="w-3 h-3" />
            Pulisci
          </button>
        )}

        {/* Active count */}
        {totalActiveSelections > 0 && (
          <span className="text-[10px] text-gray-600">
            {totalActiveSelections} {totalActiveSelections === 1 ? 'filtro' : 'filtri'}
          </span>
        )}
      </div>
    </div>
  );
}

// Popover per aggiungere un nuovo filtro alla barra - dark theme
function AddFilterPopover({
  reports,
  existingFilters,
  onAdd,
  onClose,
  containerRef
}: {
  reports: { id: number; name: string }[];
  existingFilters: FilterBarConfig[];
  onAdd: (reportId: number, column: string, columnLabel: string) => void;
  onClose: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [selectedReport, setSelectedReport] = useState<number | null>(
    reports.length === 1 ? reports[0].id : null
  );
  const [schema, setSchema] = useState<any>(null);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const getToken = () => localStorage.getItem('token');

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        containerRef.current && !containerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Load schema when report selected
  useEffect(() => {
    if (!selectedReport) return;
    setLoadingSchema(true);
    setSchema(null);
    fetch(`/api/pivot/${selectedReport}/schema`, {
      headers: { 'Authorization': `Bearer ${getToken()}` }
    })
      .then(res => res.json())
      .then(data => setSchema(data))
      .catch(() => setSchema(null))
      .finally(() => setLoadingSchema(false));
  }, [selectedReport]);

  const allColumns = schema?.columns || [];

  // Filter out columns that are already in the filter bar for this report
  const availableColumns = allColumns.filter(
    (col: any) => !existingFilters.some(f => f.reportId === selectedReport && f.column === col.name)
  );

  return (
    <div
      ref={popoverRef}
      className="absolute top-full left-0 mt-1 w-64 bg-[#1e1e1e] rounded-lg shadow-xl border border-[#333] z-50"
    >
      <div className="px-3 py-2 border-b border-[#333]">
        <h4 className="text-[10px] font-bold uppercase tracking-wider text-blue-400">Aggiungi Filtro</h4>
      </div>

      {/* Report Selection (only if multiple reports) */}
      {reports.length > 1 && (
        <div className="p-3 border-b border-[#333]">
          <label className="block text-[10px] text-gray-500 mb-1">Report</label>
          <select
            value={selectedReport || ''}
            onChange={(e) => setSelectedReport(Number(e.target.value) || null)}
            className="w-full px-2 py-1.5 text-xs bg-[#2b2b2b] text-gray-200 border border-[#444] rounded focus:outline-none focus:border-blue-500"
          >
            <option value="">Seleziona report...</option>
            {reports.map(r => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Column Selection */}
      <div className="max-h-48 overflow-auto">
        {!selectedReport ? (
          <div className="p-4 text-center text-gray-600 text-xs">
            Seleziona un report
          </div>
        ) : loadingSchema ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
          </div>
        ) : availableColumns.length === 0 ? (
          <div className="p-4 text-center text-gray-600 text-xs">
            {allColumns.length === 0 ? 'Nessuna colonna disponibile' : 'Tutte le colonne sono già aggiunte'}
          </div>
        ) : (
          availableColumns.map((col: any) => (
            <button
              key={col.name}
              type="button"
              onClick={() => onAdd(selectedReport, col.name, col.label || col.name)}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-[#333] hover:text-blue-300 border-b border-[#2b2b2b] transition-colors"
            >
              {col.label || col.name}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
