/**
 * ListSlicer - Multi-select checkbox filter for dashboards
 *
 * Features:
 * - Search/filter values
 * - Multi-select with checkboxes
 * - Select all / Deselect all
 * - Integrates with dashboardStore for cross-widget filtering
 */
import { useState, useEffect } from 'react';
import { Search, Check, X, Loader2 } from 'lucide-react';
import { apiFetch } from '../../services/apiClient';

interface ListSlicerProps {
  reportId: number;
  column: string;
  title?: string;
  selectedValues: string[];
  onSelectionChange: (values: string[]) => void;
  maxHeight?: number;
}

export default function ListSlicer({
  reportId,
  column,
  title,
  selectedValues,
  onSelectionChange,
  maxHeight = 250
}: ListSlicerProps) {
  const [allValues, setAllValues] = useState<string[]>([]);
  const [filteredValues, setFilteredValues] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load distinct values from backend
  useEffect(() => {
    const loadValues = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch(`/api/pivot/${reportId}/distinct/${column}`);
        if (res.ok) {
          const data = await res.json();
          const values = data.values.map((v: any) => String(v));
          setAllValues(values);
          setFilteredValues(values);
        } else {
          setError('Errore caricamento valori');
        }
      } catch (err) {
        setError('Errore di connessione');
      } finally {
        setLoading(false);
      }
    };
    loadValues();
  }, [reportId, column]);

  // Filter values based on search
  useEffect(() => {
    if (!search.trim()) {
      setFilteredValues(allValues);
    } else {
      const searchLower = search.toLowerCase();
      setFilteredValues(allValues.filter(v =>
        v.toLowerCase().includes(searchLower)
      ));
    }
  }, [search, allValues]);

  const toggleValue = (value: string) => {
    if (selectedValues.includes(value)) {
      onSelectionChange(selectedValues.filter(v => v !== value));
    } else {
      onSelectionChange([...selectedValues, value]);
    }
  };

  const selectAll = () => {
    onSelectionChange(filteredValues);
  };

  const deselectAll = () => {
    onSelectionChange([]);
  };

  const isAllSelected = filteredValues.length > 0 &&
    filteredValues.every(v => selectedValues.includes(v));

  return (
    <div className="bg-surface rounded-lg border shadow-sm">
      {/* Header */}
      <div className="px-3 py-2 border-b bg-surface-2">
        <h4 className="font-medium text-sm text-ink">
          {title || column}
        </h4>
      </div>

      {/* Search */}
      <div className="p-2 border-b">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca..."
            className="w-full pl-8 pr-3 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-muted"
              title="Cancella ricerca"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Select All / Deselect All */}
      <div className="px-3 py-1.5 border-b flex items-center gap-2 text-xs">
        <button
          type="button"
          onClick={selectAll}
          className="text-accent hover:underline"
        >
          Seleziona tutti
        </button>
        <span className="text-slate-300">|</span>
        <button
          type="button"
          onClick={deselectAll}
          className="text-accent hover:underline"
        >
          Deseleziona
        </button>
        {selectedValues.length > 0 && (
          <span className="ml-auto text-muted">
            {selectedValues.length} selezionati
          </span>
        )}
      </div>

      {/* Values List */}
      <div
        className="overflow-auto"
        style={{ maxHeight: `${maxHeight}px` }}
      >
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-accent" />
          </div>
        ) : error ? (
          <div className="text-center py-4 text-neg text-sm">
            {error}
          </div>
        ) : filteredValues.length === 0 ? (
          <div className="text-center py-4 text-muted text-sm">
            Nessun valore trovato
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredValues.map((value) => {
              const isSelected = selectedValues.includes(value);
              return (
                <div
                  key={value}
                  onClick={() => toggleValue(value)}
                  className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-surface-2 ${
                    isSelected ? 'bg-accent-soft' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleValue(value)}
                    className="sr-only"
                    aria-label={`Seleziona ${value || 'vuoto'}`}
                  />
                  <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                    isSelected
                      ? 'bg-accent border-accent'
                      : 'border-slate-300'
                  }`}>
                    {isSelected && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <span className="text-sm text-ink truncate flex-1">
                    {value || '(vuoto)'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer with count */}
      <div className="px-3 py-1.5 border-t bg-surface-2 text-xs text-muted">
        {filteredValues.length} di {allValues.length} valori
      </div>
    </div>
  );
}
