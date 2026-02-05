/**
 * DropdownSlicer - Single-select dropdown filter for dashboards
 *
 * Features:
 * - Single selection dropdown
 * - Search within options
 * - Clear selection option
 * - Integrates with dashboardStore for cross-widget filtering
 */
import { useState, useEffect, useRef } from 'react';
import { ChevronDown, Search, X, Loader2 } from 'lucide-react';

interface DropdownSlicerProps {
  reportId: number;
  column: string;
  title?: string;
  selectedValue: string | null;
  onSelectionChange: (value: string | null) => void;
}

export default function DropdownSlicer({
  reportId,
  column,
  title,
  selectedValue,
  onSelectionChange
}: DropdownSlicerProps) {
  const [allValues, setAllValues] = useState<string[]>([]);
  const [filteredValues, setFilteredValues] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const getToken = () => localStorage.getItem('token');

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Load distinct values from backend
  useEffect(() => {
    const loadValues = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/pivot/${reportId}/distinct/${column}`, {
          headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (res.ok) {
          const data = await res.json();
          const values = data.values.map((v: any) => String(v));
          setAllValues(values);
          setFilteredValues(values);
        } else {
          setError('Errore caricamento');
        }
      } catch (err) {
        setError('Errore connessione');
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

  const selectValue = (value: string) => {
    onSelectionChange(value);
    setIsOpen(false);
    setSearch('');
  };

  const clearSelection = () => {
    onSelectionChange(null);
    setIsOpen(false);
    setSearch('');
  };

  return (
    <div className="bg-white rounded-lg border shadow-sm" ref={dropdownRef}>
      {/* Header */}
      <div className="px-3 py-2 border-b bg-slate-50">
        <h4 className="font-medium text-sm text-slate-700">
          {title || column}
        </h4>
      </div>

      {/* Dropdown Button */}
      <div className="p-2 relative">
        <div className="flex items-center gap-1">
          <div
            onClick={() => !loading && setIsOpen(!isOpen)}
            className={`flex-1 flex items-center justify-between px-3 py-2 text-sm border rounded-md cursor-pointer hover:border-slate-400 ${loading ? 'opacity-50' : ''}`}
          >
            <span className={selectedValue ? 'text-slate-800' : 'text-slate-400'}>
              {loading ? 'Caricamento...' : (selectedValue || 'Seleziona...')}
            </span>
            <ChevronDown className={`w-4 h-4 text-slate-400 transition ${isOpen ? 'rotate-180' : ''}`} />
          </div>
          {selectedValue && (
            <button
              type="button"
              onClick={clearSelection}
              className="p-1.5 hover:bg-slate-100 rounded border"
              title="Rimuovi selezione"
            >
              <X className="w-4 h-4 text-slate-400" />
            </button>
          )}
        </div>

        {/* Dropdown Menu */}
        {isOpen && !loading && (
          <div className="absolute left-2 right-2 z-50 mt-1 bg-white border rounded-md shadow-lg">
            {/* Search in dropdown */}
            <div className="p-2 border-b">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cerca..."
                  className="w-full pl-8 pr-3 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                  autoFocus
                />
              </div>
            </div>

            {/* Options */}
            <div className="max-h-48 overflow-auto">
              {error ? (
                <div className="px-3 py-2 text-sm text-red-500">{error}</div>
              ) : filteredValues.length === 0 ? (
                <div className="px-3 py-2 text-sm text-slate-400">Nessun risultato</div>
              ) : (
                filteredValues.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => selectValue(value)}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-100 ${
                      selectedValue === value ? 'bg-blue-50 text-blue-700' : 'text-slate-700'
                    }`}
                  >
                    {value || '(vuoto)'}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
