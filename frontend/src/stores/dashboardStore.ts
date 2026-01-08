/**
 * Dashboard Store - Gestione filtri cross-widget
 * 
 * Permette ai widget della dashboard di condividere filtri:
 * - Click su una riga del pivot → filtra tutti gli altri widget
 * - Filtri persistenti durante la navigazione
 * - Reset filtri globale
 */
import { create } from 'zustand';

interface FilterValue {
  value: any;
  type: 'equals' | 'contains' | 'range';
  label?: string;
}

interface DashboardState {
  // Filtri attivi: campo -> valore
  activeFilters: Record<string, FilterValue>;
  
  // ID della dashboard corrente
  currentDashboardId: number | null;
  
  // Azioni
  setFilter: (field: string, value: any, type?: FilterValue['type']) => void;
  removeFilter: (field: string) => void;
  clearFilters: () => void;
  setDashboard: (id: number | null) => void;
  
  // Helper per costruire query string filtri
  getFilterParams: () => Record<string, any>;
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  activeFilters: {},
  currentDashboardId: null,
  
  setFilter: (field, value, type = 'equals') => {
    set((state) => ({
      activeFilters: {
        ...state.activeFilters,
        [field]: { value, type, label: `${field}: ${value}` }
      }
    }));
  },
  
  removeFilter: (field) => {
    set((state) => {
      const { [field]: _, ...rest } = state.activeFilters;
      return { activeFilters: rest };
    });
  },
  
  clearFilters: () => {
    set({ activeFilters: {} });
  },
  
  setDashboard: (id) => {
    set({ currentDashboardId: id, activeFilters: {} });
  },
  
  getFilterParams: () => {
    const filters = get().activeFilters;
    const params: Record<string, any> = {};
    
    Object.entries(filters).forEach(([field, filter]) => {
      params[field] = filter.value;
    });
    
    return params;
  }
}));

export default useDashboardStore;
