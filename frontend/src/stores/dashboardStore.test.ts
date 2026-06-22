/**
 * Test dello store dei filtri dashboard.
 * Copre i bug storici degli slicer: selezione single/multi e "Seleziona tutti".
 * (valori usati: placeholder neutri, nessun dato reale)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useDashboardStore, selectedValuesOf } from './dashboardStore';

const store = () => useDashboardStore.getState();

beforeEach(() => {
  useDashboardStore.setState({ filtersByReport: {}, currentDashboardId: null });
});

describe('selectedValuesOf (accessor unico)', () => {
  it('ritorna [] se il filtro è assente', () => {
    expect(selectedValuesOf(undefined)).toEqual([]);
  });

  it('ritorna [value] per un valore singolo', () => {
    expect(selectedValuesOf({ value: 'A', type: 'equals' })).toEqual(['A']);
  });

  it('ritorna l’intero array per multi-valore', () => {
    expect(selectedValuesOf({ value: 'A', values: ['A', 'B', 'C'], type: 'in' })).toEqual(['A', 'B', 'C']);
  });
});

describe('dashboardStore - selezione filtri', () => {
  it('single value: getSelectedValues ritorna un solo elemento', () => {
    store().setFilter(1, 'col', 'A', 'equals');
    expect(store().getSelectedValues(1, 'col')).toEqual(['A']);
  });

  it('multi value ("Seleziona tutti"): ritorna TUTTI i valori, non solo il primo', () => {
    store().setFilter(1, 'col', ['A', 'B', 'C'], 'equals');
    expect(store().getSelectedValues(1, 'col')).toEqual(['A', 'B', 'C']);
  });

  it('getFilterModelForReport: multi -> type "in" con values', () => {
    store().setFilter(1, 'col', ['A', 'B'], 'equals');
    const fm = store().getFilterModelForReport(1);
    expect(fm.col.type).toBe('in');
    expect(fm.col.values).toEqual(['A', 'B']);
  });

  it('getFilterModelForReport: single -> "equals" con filter', () => {
    store().setFilter(1, 'col', 'A', 'equals');
    const fm = store().getFilterModelForReport(1);
    expect(fm.col.type).toBe('equals');
    expect(fm.col.filter).toBe('A');
  });

  it('removeFilter azzera la selezione', () => {
    store().setFilter(1, 'col', 'A', 'equals');
    store().removeFilter(1, 'col');
    expect(store().getSelectedValues(1, 'col')).toEqual([]);
  });

  it('i filtri sono isolati per report', () => {
    store().setFilter(1, 'col', 'A', 'equals');
    expect(store().getSelectedValues(2, 'col')).toEqual([]);
  });
});
