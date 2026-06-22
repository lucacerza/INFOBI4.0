/**
 * FilterBarDropdown - Dropdown multi-select per la barra filtri della dashboard
 * Stile scuro coerente con sidebar BiGridConfig (#2b2b2b)
 * Lazy loading: fetch dei valori distinti solo al primo click
 */
import { useState, useEffect, useRef } from 'react';
import { Search, X, ChevronDown, Loader2, Check } from 'lucide-react';
import { apiFetch } from '../services/apiClient';

interface FilterBarDropdownProps {
  reportId: number;
  column: string;
  columnLabel?: string;
  selectedValues: string[];
  onSelectionChange: (values: string[]) => void;
  onRemove: () => void;
}

export default function FilterBarDropdown({
  reportId,
  column,
  columnLabel,
  selectedValues,
  onSelectionChange,
  onRemove
}: FilterBarDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [allValues, setAllValues] = useState<string[]>([]);
  const [filteredValues, setFilteredValues] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Lazy load distinct values on first open
  useEffect(() => {
    if (isOpen && !loaded) {
      loadValues();
    }
  }, [isOpen]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
        setLoaded(true);
      } else {
        setError('Errore caricamento');
      }
    } catch {
      setError('Errore di connessione');
    } finally {
      setLoading(false);
    }
  };

  // Filter values based on search
  useEffect(() => {
    if (!search.trim()) {
      setFilteredValues(allValues);
    } else {
      const s = search.toLowerCase();
      setFilteredValues(allValues.filter(v => v.toLowerCase().includes(s)));
    }
  }, [search, allValues]);

  const toggleValue = (value: string) => {
    if (selectedValues.includes(value)) {
      onSelectionChange(selectedValues.filter(v => v !== value));
    } else {
      onSelectionChange([...selectedValues, value]);
    }
  };

  // If all values are selected, clear the filter (equivalent to no filter, avoids SQL parameter limit)
  const selectAll = () => {
    if (filteredValues.length === allValues.length) {
      onSelectionChange([]);
    } else {
      onSelectionChange([...filteredValues]);
    }
  };
  const deselectAll = () => onSelectionChange([]);

  const hasSelection = selectedValues.length > 0;
  const label = columnLabel || column;

  return (
    <div className="relative group" ref={containerRef}>
      {/* Trigger Button - dark theme */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition-colors ${
          hasSelection
            ? 'bg-blue-500/20 border border-blue-400/40 text-blue-300'
            : 'bg-[#404040] border border-[#555] text-gray-300 hover:border-gray-400'
        }`}
      >
        <span className="truncate max-w-[120px]">{label}</span>
        {hasSelection && (
          <span className="bg-blue-500 text-white text-[10px] px-1.5 py-0.5 rounded-full min-w-[16px] text-center leading-none">
            {selectedValues.length}
          </span>
        )}
        <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Remove button (X) - visible on hover */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-gray-500 hover:bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        title="Rimuovi filtro"
      >
        <X className="w-2.5 h-2.5" />
      </button>

      {/* Dropdown Popover - dark theme */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-[#1e1e1e] rounded-lg shadow-xl border border-[#333] z-50">
          {/* Search */}
          <div className="p-2 border-b border-[#333]">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cerca..."
                className="w-full pl-7 pr-3 py-1.5 text-xs bg-[#2b2b2b] text-gray-200 border border-[#444] rounded focus:outline-none focus:border-blue-500"
                autoFocus
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                  title="Cancella ricerca"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Select All / Deselect All */}
          <div className="px-3 py-1.5 border-b border-[#333] flex items-center gap-2 text-[10px]">
            <button type="button" onClick={selectAll} className="text-blue-400 hover:text-blue-300">
              Tutti
            </button>
            <span className="text-gray-600">|</span>
            <button type="button" onClick={deselectAll} className="text-blue-400 hover:text-blue-300">
              Nessuno
            </button>
            {hasSelection && (
              <span className="ml-auto text-gray-500">{selectedValues.length} sel.</span>
            )}
          </div>

          {/* Values List */}
          <div className="max-h-52 overflow-auto">
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
              </div>
            ) : error ? (
              <div className="text-center py-4 text-red-400 text-xs">{error}</div>
            ) : filteredValues.length === 0 ? (
              <div className="text-center py-4 text-gray-500 text-xs">Nessun valore</div>
            ) : (
              filteredValues.map((value) => {
                const isSelected = selectedValues.includes(value);
                return (
                  <div
                    key={value}
                    onClick={() => toggleValue(value)}
                    className={`flex items-center gap-2 px-3 py-1 cursor-pointer hover:bg-[#333] text-xs ${
                      isSelected ? 'bg-blue-500/10' : ''
                    }`}
                  >
                    <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${
                      isSelected ? 'bg-blue-500 border-blue-500' : 'border-[#555]'
                    }`}>
                      {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                    </div>
                    <span className="truncate text-gray-300">{value || '(vuoto)'}</span>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          {loaded && (
            <div className="px-3 py-1 border-t border-[#333] text-[10px] text-gray-500">
              {filteredValues.length} di {allValues.length} valori
            </div>
          )}
        </div>
      )}
    </div>
  );
}
