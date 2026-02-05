/**
 * Dashboard Store - Gestione filtri cross-widget (Drill-Down)
 *
 * Permette ai widget della dashboard di condividere filtri per report:
 * - Click su un grafico/riga → filtra tutti i widget dello stesso report
 * - Filtri organizzati per reportId (tutti i widget Report A si filtrano insieme)
 * - Reset filtri per report o globale
 */
import { create } from 'zustand';

export interface FilterValue {
  value: any;
  values?: any[]; // For multi-select slicers
  type: 'equals' | 'contains' | 'range' | 'in';
  label?: string;
  sourceField?: string; // Campo originale (es. groupBy[0])
}

interface DashboardState {
  // Filtri attivi per report: reportId -> campo -> valore
  filtersByReport: Record<number, Record<string, FilterValue>>;

  // ID della dashboard corrente
  currentDashboardId: number | null;

  // Azioni per gestire i filtri
  setFilter: (reportId: number, field: string, value: any, type?: FilterValue['type']) => void;
  removeFilter: (reportId: number, field: string) => void;
  clearFiltersForReport: (reportId: number) => void;
  clearAllFilters: () => void;
  setDashboard: (id: number | null) => void;

  // Helper per ottenere filtri per un report specifico
  getFiltersForReport: (reportId: number) => Record<string, FilterValue>;

  // Helper per convertire filtri in formato API (filterModel)
  getFilterModelForReport: (reportId: number) => Record<string, any>;
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  filtersByReport: {},
  currentDashboardId: null,

  setFilter: (reportId, field, value, type = 'equals') => {
    const isArray = Array.isArray(value);
    set((state) => ({
      filtersByReport: {
        ...state.filtersByReport,
        [reportId]: {
          ...(state.filtersByReport[reportId] || {}),
          [field]: {
            value: isArray ? value[0] : value,
            values: isArray ? value : undefined,
            type: isArray ? 'in' : type,
            label: isArray ? `${field}: ${value.length} sel.` : `${field}: ${value}`,
            sourceField: field
          }
        }
      }
    }));
  },

  removeFilter: (reportId, field) => {
    set((state) => {
      const reportFilters = state.filtersByReport[reportId];
      if (!reportFilters) return state;

      const { [field]: _, ...rest } = reportFilters;
      return {
        filtersByReport: {
          ...state.filtersByReport,
          [reportId]: rest
        }
      };
    });
  },

  clearFiltersForReport: (reportId) => {
    set((state) => {
      const { [reportId]: _, ...rest } = state.filtersByReport;
      return { filtersByReport: rest };
    });
  },

  clearAllFilters: () => {
    set({ filtersByReport: {} });
  },

  setDashboard: (id) => {
    // Reset filtri quando si cambia dashboard
    set({ currentDashboardId: id, filtersByReport: {} });
  },

  getFiltersForReport: (reportId) => {
    return get().filtersByReport[reportId] || {};
  },

  getFilterModelForReport: (reportId) => {
    const filters = get().filtersByReport[reportId] || {};
    const filterModel: Record<string, any> = {};

    Object.entries(filters).forEach(([field, filter]) => {
      // Formato compatibile con AG-Grid / TreeDataGrid filterModel
      if (filter.type === 'in' && filter.values) {
        // Multi-value filter (from ListSlicer)
        filterModel[field] = {
          filterType: 'set',
          type: 'in',
          filter: filter.value, // Single value for compatibility
          values: filter.values // Array of values for multi-select
        };
      } else {
        filterModel[field] = {
          filterType: 'text',
          type: filter.type === 'equals' ? 'equals' : 'contains',
          filter: filter.value
        };
      }
    });

    return filterModel;
  }
}));

export default useDashboardStore;
