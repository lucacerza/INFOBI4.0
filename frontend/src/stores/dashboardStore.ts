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
  type: 'equals' | 'contains' | 'range';
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
    set((state) => ({
      filtersByReport: {
        ...state.filtersByReport,
        [reportId]: {
          ...(state.filtersByReport[reportId] || {}),
          [field]: {
            value,
            type,
            label: `${field}: ${value}`,
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
      filterModel[field] = {
        filterType: 'text',
        type: filter.type === 'equals' ? 'equals' : 'contains',
        filter: filter.value
      };
    });

    return filterModel;
  }
}));

export default useDashboardStore;
