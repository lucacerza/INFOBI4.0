import { useState, useEffect, useRef, useMemo } from 'react';
import { Box, Sigma, ArrowRight, GripVertical, X } from 'lucide-react';
import { 
  DndContext, 
  DragOverlay, 
  DragStartEvent, 
  DragEndEvent, 
  DragOverEvent, 
  useSensor, 
  useSensors, 
  PointerSensor, 
  useDroppable,
  closestCenter,
  KeyboardSensor
} from '@dnd-kit/core';
import { 
  SortableContext, 
  verticalListSortingStrategy, 
  useSortable, 
  arrayMove,
  sortableKeyboardCoordinates
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export interface BiGridMetric {
  id: string;
  field: string;
  aggregation: 'sum' | 'avg' | 'count' | 'min' | 'max';
  label?: string;
}

/* STARTED NEW FEATURE: OrderBy/FilterBy - Interfaces update */
export interface BiGridSort {
  field: string;
  direction: 'asc' | 'desc';
}

export interface BiGridFilter {
  field: string;
  type: string;
  value: any;
}

export interface BiGridHaving {
  field: string;       // Nome del campo aggregato (es. Venduto)
  aggregation: string; // Funzione di aggregazione (sum, avg, count, etc.)
  type: string;        // Tipo confronto (greaterThan, lessThan, equals, etc.)
  value: any;          // Valore di confronto
}

export interface BiGridConfigData {
  rows?: string[];
  columns?: string[];
  values?: BiGridMetric[];
  orderBy?: BiGridSort[];
  filters?: BiGridFilter[];
  having?: BiGridHaving[];
}
/* END NEW FEATURE */

interface BiGridConfigProps {
  config: BiGridConfigData;
  availableColumns: string[] | { name: string }[];
  onChange: (config: BiGridConfigData) => void;
}

// --- DRAG & DROP COMPONENTS ---

// Helper to strip prefixes for display/logic
// Filter IDs can be: filter:fieldname:timestamp (for multiple filters on same field)
// Having IDs can be: having:fieldname:timestamp (for multiple having on same field)
const getFieldFromId = (id: string | null) => {
    if (!id) return '';
    if (id.startsWith('sort:')) return id.replace('sort:', '');
    if (id.startsWith('filter:')) {
        // Handle filter:field:timestamp format
        const parts = id.replace('filter:', '').split(':');
        return parts[0]; // Return just the field name
    }
    if (id.startsWith('having:')) {
        // Handle having:field:timestamp format
        const parts = id.replace('having:', '').split(':');
        return parts[0]; // Return just the field name
    }
    return id;
};

// Helper to check if a field type is numeric
const isNumericType = (type: string | undefined) => {
    if (!type) return true; // Default to numeric if unknown
    const t = type.toLowerCase();
    return t === 'number' || t === 'float' || t === 'integer' || t === 'decimal' || t === 'int' || t === 'bigint' || t === 'smallint' || t === 'real' || t === 'money';
};

// Get valid aggregations for a field type
const getValidAggregations = (fieldType: string | undefined) => {
    if (isNumericType(fieldType)) {
        return [
            { value: 'sum', label: 'SUM' },
            { value: 'avg', label: 'AVG' },
            { value: 'count', label: 'COUNT' },
            { value: 'min', label: 'MIN' },
            { value: 'max', label: 'MAX' }
        ];
    } else {
        // Text/Date fields: only COUNT, MIN, MAX
        return [
            { value: 'count', label: 'COUNT' },
            { value: 'min', label: 'MIN' },
            { value: 'max', label: 'MAX' }
        ];
    }
};

function SortableItem({
    id,
    children,
    onRemove,
    onAggregationChange,
    aggregation,
    isAvailableList,
    /* STARTED NEW FEATURE: OrderBy/FilterBy - New props */
    onSortChange,
    sortDirection,
    onFilterChange,
    filterValue,
    /* END NEW FEATURE */
    // Having props
    onHavingChange,
    havingValue,
    // Field type for aggregation filtering
    fieldType
}: any) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
    
    // Use rigid transform to prevent blurring/distortion
    const style = {
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 999 : 'auto',
    };

    const displayLabel = getFieldFromId(children as string);

    // Filter items have a different layout (2 rows)
    if (onFilterChange) {
        return (
            <div ref={setNodeRef} style={style}
                 className="flex flex-col px-2 py-1 mb-1 bg-[#404040] border border-[#555] rounded cursor-move select-none text-xs text-gray-200"
            >
                {/* Row 1: Field name + remove button */}
                <div className="flex items-center justify-between mb-1" {...attributes} {...listeners}>
                    <div className="flex items-center gap-2">
                        <GripVertical size={12} className="text-gray-500 flex-shrink-0" />
                        <span className="font-sans font-medium text-blue-300">{displayLabel}</span>
                    </div>
                    {onRemove && (
                        <button
                            type="button"
                            title="Rimuovi filtro"
                            onClick={(e) => { e.stopPropagation(); onRemove(id); }}
                            className="text-gray-500 hover:text-red-400 ml-2"
                            onPointerDown={(e) => e.stopPropagation()}
                        >
                            <X size={14} />
                        </button>
                    )}
                </div>
                {/* Row 2: Filter controls */}
                <div className="flex items-center gap-1 pl-5">
                    <select
                        title="Tipo di confronto"
                        value={filterValue?.type || 'contains'}
                        onChange={(e) => { e.stopPropagation(); onFilterChange('type', e.target.value); }}
                        className="bg-[#2b2b2b] text-[10px] text-white border border-gray-600 rounded px-1 flex-shrink-0"
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                    >
                        <option value="contains">Contiene</option>
                        <option value="equals">=</option>
                        <option value="notEqual">≠</option>
                        <option value="greaterThan">&gt;</option>
                        <option value="greaterThanOrEqual">≥</option>
                        <option value="lessThan">&lt;</option>
                        <option value="lessThanOrEqual">≤</option>
                        <option value="startsWith">Inizia</option>
                        <option value="endsWith">Finisce</option>
                    </select>
                    <input
                        type="text"
                        value={filterValue?.value || ''}
                        onChange={(e) => { e.stopPropagation(); onFilterChange('value', e.target.value); }}
                        className="bg-[#2b2b2b] text-xs text-white border border-gray-600 rounded px-1 flex-1 min-w-0"
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                        placeholder="Valore..."
                    />
                </div>
            </div>
        );
    }

    // Having items have a different layout (3 rows: field, aggregation, condition)
    if (onHavingChange) {
        return (
            <div ref={setNodeRef} style={style}
                 className="flex flex-col px-2 py-1 mb-1 bg-[#404040] border border-[#555] rounded cursor-move select-none text-xs text-gray-200"
            >
                {/* Row 1: Field name + remove button */}
                <div className="flex items-center justify-between mb-1" {...attributes} {...listeners}>
                    <div className="flex items-center gap-2">
                        <GripVertical size={12} className="text-gray-500 flex-shrink-0" />
                        <span className="font-sans font-medium text-orange-300">{displayLabel}</span>
                    </div>
                    {onRemove && (
                        <button
                            type="button"
                            title="Rimuovi having"
                            onClick={(e) => { e.stopPropagation(); onRemove(id); }}
                            className="text-gray-500 hover:text-red-400 ml-2"
                            onPointerDown={(e) => e.stopPropagation()}
                        >
                            <X size={14} />
                        </button>
                    )}
                </div>
                {/* Row 2: Aggregation selector + comparison + value */}
                <div className="flex items-center gap-1 pl-5">
                    <select
                        title="Aggregazione"
                        value={havingValue?.aggregation || (isNumericType(fieldType) ? 'sum' : 'count')}
                        onChange={(e) => { e.stopPropagation(); onHavingChange('aggregation', e.target.value); }}
                        className="bg-[#2b2b2b] text-[10px] text-white border border-gray-600 rounded px-1 flex-shrink-0"
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                    >
                        {getValidAggregations(fieldType).map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                    <select
                        title="Tipo di confronto"
                        value={havingValue?.type || 'greaterThan'}
                        onChange={(e) => { e.stopPropagation(); onHavingChange('type', e.target.value); }}
                        className="bg-[#2b2b2b] text-[10px] text-white border border-gray-600 rounded px-1 flex-shrink-0"
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                    >
                        <option value="greaterThan">&gt;</option>
                        <option value="greaterThanOrEqual">≥</option>
                        <option value="lessThan">&lt;</option>
                        <option value="lessThanOrEqual">≤</option>
                        <option value="equals">=</option>
                        <option value="notEqual">≠</option>
                    </select>
                    <input
                        type="number"
                        value={havingValue?.value ?? ''}
                        onChange={(e) => { e.stopPropagation(); onHavingChange('value', e.target.value); }}
                        className="bg-[#2b2b2b] text-xs text-white border border-gray-600 rounded px-1 flex-1 min-w-0 w-16"
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                        placeholder="Valore..."
                    />
                </div>
            </div>
        );
    }

    return (
        <div ref={setNodeRef} style={style}
             className={`
                flex items-center justify-between px-2 py-1 mb-1
                ${isAvailableList ? 'bg-transparent hover:bg-[#404040] border-transparent' : 'bg-[#404040] border-[#555]'}
                border rounded cursor-move select-none text-xs text-gray-200 group
             `}
        >
            <div className="flex items-center gap-2 truncate flex-1" {...attributes} {...listeners}>
                <GripVertical size={12} className="text-gray-500 flex-shrink-0" />
                <span className="truncate font-sans">{displayLabel}</span>
            </div>

            <div className="flex items-center gap-1">
                {onAggregationChange && (
                    <select
                        value={aggregation || (isNumericType(fieldType) ? 'sum' : 'count')}
                        onChange={(e) => { e.stopPropagation(); onAggregationChange(e.target.value); }}
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="text-[10px] px-1 py-0.5 border border-[#555] rounded bg-[#2b2b2b] text-gray-300 focus:outline-none focus:border-blue-500"
                    >
                        {getValidAggregations(fieldType).map(opt => (
                            <option key={opt.value} value={opt.value}>
                                {opt.value === 'count' ? 'cnt' : opt.value}
                            </option>
                        ))}
                    </select>
                )}

                {/* STARTED NEW FEATURE: OrderBy/FilterBy - UI Controls */}
                {onSortChange && (
                   <button
                        onClick={(e) => { e.stopPropagation(); onSortChange(sortDirection === 'asc' ? 'desc' : 'asc'); }}
                        className="text-[10px] px-1.5 py-0.5 border border-[#555] rounded bg-[#2b2b2b] text-gray-300 hover:text-white"
                   >
                       {sortDirection === 'asc' ? 'ASC' : 'DESC'}
                   </button>
                )}
                
                {onRemove && (
                    <button 
                      onClick={(e) => { e.stopPropagation(); onRemove(id); }} 
                      className="p-1 hover:bg-[#555] rounded text-gray-400 hover:text-red-400"
                    >
                       <X size={12}/>
                    </button>
                )}
            </div>
        </div>
    );
}

function DroppableContainer({
    id,
    items,
    title,
    onRemoveItem,
    onAggregationChange,
    placeholder,
    metricsMeta,
    isAvailableList,
    hasGroups,
    /* STARTED NEW FEATURE: OrderBy/FilterBy - New props */
    onSortChange,
    sortMeta,
    onFilterChange,
    filterMeta,
    /* END NEW FEATURE */
    // Having props
    onHavingChange,
    havingMeta,
    // Column types for aggregation filtering
    columnTypes
}: any) {
    const { setNodeRef } = useDroppable({ id });

    const renderedItems = items.map((itemId: string) => {
        const realField = getFieldFromId(itemId);
        // Metadata usually keyed by ANY id (if unique) or FIELD?
        // Aggregations are for value fields (no prefix).
        // Sort/Filter meta are for field names.
        
        const meta = metricsMeta ? metricsMeta[realField] : null;
        const aggregation = meta ? meta.aggregation : null;
        
        // Show aggregation select only if we have groups (user request) OR if explicitly enabled
        // Actually, user said: "Selects in columns make sense only if at least one field in Group By"
        // So we pass 'hasGroups' to SortableItem or handled here.
        // If hasGroups is false, and this is 'values' container (which has onAggregationChange), hide select?
        const showAgg = onAggregationChange && hasGroups;

        /* STARTED NEW FEATURE: OrderBy/FilterBy */
        const sortDirection = sortMeta ? sortMeta[realField] : null;
        // For filters, use the full itemId as key (includes timestamp for uniqueness)
        const filterVal = filterMeta ? filterMeta[itemId] : null;
        // For having, use the full itemId as key (includes timestamp for uniqueness)
        const havingVal = havingMeta ? havingMeta[itemId] : null;

        // Get field type for aggregation filtering
        const fieldType = columnTypes ? columnTypes[realField] : undefined;

        return (
            <SortableItem
                key={itemId}
                id={itemId}
                onRemove={onRemoveItem}
                onAggregationChange={showAgg ? (val: string) => onAggregationChange(itemId, val) : null}
                aggregation={aggregation}
                isAvailableList={isAvailableList}
                // New props
                onSortChange={onSortChange ? (val: string) => onSortChange(realField, val) : null}
                sortDirection={sortDirection}
                // For filters, pass itemId to onFilterChange so we update the correct entry
                onFilterChange={onFilterChange ? (key: string, val: any) => onFilterChange(itemId, key, val) : null}
                filterValue={filterVal}
                // For having, pass itemId to onHavingChange so we update the correct entry
                onHavingChange={onHavingChange ? (key: string, val: any) => onHavingChange(itemId, key, val) : null}
                havingValue={havingVal}
                // Field type for aggregation filtering
                fieldType={fieldType}
            >
               {itemId}
            </SortableItem>
        );
        /* END NEW FEATURE */
    });

    if (isAvailableList) {

        return (
            <SortableContext id={id} items={items} strategy={verticalListSortingStrategy}>
                <div ref={setNodeRef} className="flex-1 p-2 min-h-[50px]">
                    {renderedItems}
                </div>
            </SortableContext>
        );
    }

    return (
        <div className="mb-4">
             {title && (
                <div className="mb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wide flex items-center justify-between">
                    <span>{title}</span>
                </div>
             )}
            <div ref={setNodeRef} className="bg-[#1e1e1e] rounded border border-[#333] min-h-[38px] p-1.5 shadow-inner">
                <SortableContext id={id} items={items} strategy={verticalListSortingStrategy}>
                    <div className="flex flex-col gap-0.5">
                        {renderedItems}
                        {items.length === 0 && (
                             <div className="h-6" /> // spacer for drop target
                        )}
                    </div>
                </SortableContext>
            </div>
        </div>
    );
}

export default function BiGridConfig({ config, availableColumns, onChange }: BiGridConfigProps) {
  // Map column names to types for intelligent defaulting
  const columnTypes = useMemo(() => {
    const types: Record<string, string> = {};
    availableColumns.forEach((c: any) => {
        if (typeof c !== 'string' && c.name) {
            types[c.name] = c.type; // 'string', 'number', 'date', etc.
        }
    });
    return types;
  }, [availableColumns]);

  // --- STATE ---
  // Pure string arrays for robust DndKit operation
  const [items, setItems] = useState<{
      available: string[];
      rows: string[];
      columns: string[];
      values: string[];
      /* STARTED NEW FEATURE: OrderBy/FilterBy - State */
      orderBy: string[]; // IDs prefixed with 'sort:'
      filterBy: string[]; // IDs prefixed with 'filter:'
      /* END NEW FEATURE */
      havingBy: string[]; // IDs prefixed with 'having:'
  }>({
      available: [],
      rows: [],
      columns: [],
      values: [],
      /* STARTED NEW FEATURE: OrderBy/FilterBy - Init */
      orderBy: [],
      filterBy: [],
      /* END NEW FEATURE */
      havingBy: []
  });

  // Metadata for metrics (aggregation types)
  const [metricsMeta, setMetricsMeta] = useState<Record<string, { aggregation: string }>>({});
  
  /* STARTED NEW FEATURE: OrderBy/FilterBy - Metadata State */
  const [sortMeta, setSortMeta] = useState<Record<string, 'asc' | 'desc'>>({});
  const [filterMeta, setFilterMeta] = useState<Record<string, { type: string, value: any }>>({});
  /* END NEW FEATURE */

  // Having metadata: keyed by unique ID, stores aggregation, comparison type and value
  const [havingMeta, setHavingMeta] = useState<Record<string, { aggregation: string, type: string, value: any }>>({});

  const [activeId, setActiveId] = useState<string | null>(null);
  
  // Track start container to revert accidental moves during drag
  const [startContainer, setStartContainer] = useState<string | null>(null);
  // Track start index to restore item to exact position
  const [startIndex, setStartIndex] = useState<number | null>(null);
  
  // Logic Fix: Track a version number to force-sync parent when drag ends
  const [dragVersion, setDragVersion] = useState(0);

  // Ref for auto-scroll when adding filters
  const dropZonesRef = useRef<HTMLDivElement>(null);

  // Track if we are currently dragging to avoid updates during drag
  const isDraggingRef = useRef(false);

  // --- INITIALIZATION ---
  useEffect(() => {
    // Only re-init if meaningful changes occur. 
    // We parse 'availableColumns' into strings.
    const colNames = availableColumns.map((c: any) => typeof c === 'string' ? c : c.name);
    
    // Parse incoming config
    const currentRows = config.rows || [];
    const currentColumns = config.columns || [];
    const currentValues = config.values || [];
    
    // Parse Sort and Filter with fallback
    const currentOrderBy = config.orderBy || [];
    const currentFilters = config.filters || [];

    // Prefix IDs for internal state
    const orderByIds = currentOrderBy.map(o => `sort:${o.field}`);
    // For filters: use unique IDs to allow multiple filters on same field
    const filterByIds = currentFilters.map((f, idx) => `filter:${f.field}:${Date.now() + idx}`);

    const newSortMeta: Record<string, 'asc' | 'desc'> = {};
    currentOrderBy.forEach(o => {
        newSortMeta[o.field] = o.direction;
    });
    setSortMeta(prev => ({ ...prev, ...newSortMeta }));

    // For filters: use the full unique ID as key
    const newFilterMeta: Record<string, { type: string, value: any }> = {};
    currentFilters.forEach((f, idx) => {
        const filterId = filterByIds[idx];
        newFilterMeta[filterId] = { type: f.type, value: f.value };
    });
    setFilterMeta(prev => ({ ...prev, ...newFilterMeta }));
    /* END NEW FEATURE */
    
    // Extract value IDs and metadata
    const valueIds = currentValues.map(v => v.field);
    const newMetricsMeta: Record<string, { aggregation: string }> = {};
    
    currentValues.forEach(v => {
        newMetricsMeta[v.field] = { aggregation: v.aggregation };
    });
    setMetricsMeta(prev => ({ ...prev, ...newMetricsMeta }));

    const used = new Set([
        ...currentRows,
        ...currentColumns,
        ...valueIds
        /* NOTE: We do NOT include orderBy/filterBy in 'used' so they remain available */
    ]);
    
    const available = colNames.filter((c: string) => !used.has(c));
    
    // Parse Having from config
    const currentHaving = config.having || [];
    const havingByIds = currentHaving.map((h, idx) => `having:${h.field}:${Date.now() + idx}`);

    // Initialize havingMeta
    const newHavingMeta: Record<string, { aggregation: string, type: string, value: any }> = {};
    currentHaving.forEach((h, idx) => {
        const havingId = havingByIds[idx];
        newHavingMeta[havingId] = { aggregation: h.aggregation, type: h.type, value: h.value };
    });
    setHavingMeta(prev => ({ ...prev, ...newHavingMeta }));

    setItems({
        available,
        rows: currentRows,
        columns: currentColumns,
        values: valueIds,
        /* STARTED NEW FEATURE: OrderBy/FilterBy - Set State */
        orderBy: orderByIds,
        filterBy: filterByIds,
        /* END NEW FEATURE */
        havingBy: havingByIds
    });
  }, [availableColumns]); // Breaking dependency loops


  // --- AUTO-CORRECT AGGREGATIONS WHEN GROUPING ADDED ---
  useEffect(() => {
    // If we have groups, ensure text fields use COUNT instead of SUM
    if (items.rows.length > 0) {
        let changed = false;
        const newMeta = { ...metricsMeta };

        items.values.forEach(val => {
            // Check type from the map we built
            const typeLower = (columnTypes[val] || '').toLowerCase();
            const isText = typeLower === 'string' || typeLower === 'date' || typeLower === 'text' || typeLower === 'varchar'; 
            const currentAgg = newMeta[val]?.aggregation;

            // If it is text and (no aggregation OR aggregation is SUM), force COUNT
            if (isText && (!currentAgg || currentAgg === 'sum')) {
                 newMeta[val] = { aggregation: 'count' };
                 changed = true;
            }
        });

        if (changed) {
            setMetricsMeta(prev => ({ ...prev, ...newMeta }));
        }
    }
  }, [items.rows, items.values, columnTypes]); // Re-run when rows or values change

  // --- SYNC TO PARENT ---
  // Debounce could be added here if needed, but we'll sync on every change for responsiveness
  useEffect(() => {
    if (isDraggingRef.current) return; // Don't sync while dragging
    
    // Reconstruct complex object for parent
    const complexValues: BiGridMetric[] = items.values.map(id => {
        // Determine Default Aggregation if not set
        let agg = metricsMeta[id]?.aggregation;
        if (!agg) {
            const type = columnTypes[id];
            // If numeric, default to SUM. Else default to COUNT
            agg = (type === 'number' || type === 'float' || type === 'integer') ? 'sum' : 'count';
        }
        
        return {
            id,
            field: id,
            aggregation: agg as any
        };
    });
    
    /* STARTED NEW FEATURE: OrderBy/FilterBy - Reconstruct complex objects */
    const complexOrderBy: BiGridSort[] = items.orderBy.map(id => {
        const field = getFieldFromId(id);
        return {
            field: field,
            direction: sortMeta[field] || 'asc'
        };
    });
    
    const complexFilters: BiGridFilter[] = items.filterBy.map(id => {
        const field = getFieldFromId(id);
        // Use full ID as key for filterMeta (allows multiple filters on same field)
        const meta = filterMeta[id] || { type: 'contains', value: '' };
        return {
            field: field,
            type: meta.type,
            value: meta.value
        };
    });

    // Build Having array
    const complexHaving: BiGridHaving[] = items.havingBy.map(id => {
        const field = getFieldFromId(id);
        // Use full ID as key for havingMeta (allows multiple having on same field)
        const meta = havingMeta[id] || { aggregation: 'sum', type: 'greaterThan', value: '' };
        return {
            field: field,
            aggregation: meta.aggregation,
            type: meta.type,
            value: meta.value
        };
    });
    /* END NEW FEATURE */

    // Only trigger if changes are real (comparisons logic omitted for simplicity, relying on parent dup check if any)
    onChange({
        rows: items.rows,
        columns: items.columns,
        values: complexValues,
        /* STARTED NEW FEATURE: OrderBy/FilterBy - Pass to parent */
        orderBy: complexOrderBy,
        filters: complexFilters,
        having: complexHaving
        /* END NEW FEATURE */
    });

  }, [items.rows, items.columns, items.values, items.orderBy, items.filterBy, items.havingBy, metricsMeta, sortMeta, filterMeta, havingMeta, columnTypes, dragVersion]);


  // --- DND HANDLERS ---
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), 
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const findContainer = (id: string) => {
    if (items.available.includes(id)) return 'available';
    if (items.rows.includes(id)) return 'rows';
    if (items.columns.includes(id)) return 'columns';
    if (items.values.includes(id)) return 'values';
    /* STARTED NEW FEATURE: OrderBy/FilterBy */
    if (items.orderBy.includes(id)) return 'orderBy';
    if (items.filterBy.includes(id)) return 'filterBy';
    /* END NEW FEATURE */
    if (items.havingBy.includes(id)) return 'havingBy';
    return null;
  };


  const handleDragStart = (event: DragStartEvent) => {
    const id = event.active.id as string;
    setActiveId(id);
    const container = findContainer(id);
    setStartContainer(container);
    if (container) {
        setStartIndex(items[container as keyof typeof items]?.indexOf(id) ?? null);
    }
    isDraggingRef.current = true;
  };

  const handleDragOver = (event: DragOverEvent) => {
      const { active, over } = event;
      
      if (!over) return;

      const activeContainer = findContainer(active.id as string);
      const overContainer = (over.id in items) 
          ? over.id 
          : findContainer(over.id as string);

      if (!activeContainer || !overContainer) {
          return;
      }
      
      // Moving between containers logic
      // We do NOT want to move items out of 'OrderBy/FilterBy' back to others via DragOver
      // because we handle duplication logic on Drop. 
      // HOWEVER, dnd-kit visual feedback depends on items actually changing containers/positions.
      
      // If we are dragging TO OrderBy or FilterBy, we only visually move if source is the same container.
      // If source is different (e.g. Available -> OrderBy), distinct logic applies.
      
      // If active item is from OrderBy/FilterBy and over same container, standard sort.
      if (activeContainer === overContainer) {
         if (active.id !== over.id) {
             // Let internal sorting happen in dragOver or dragEnd. 
             // Usually standard dnd-kit examples do sorting in DragOver for visual feedback.
              setItems((prev: any) => {
                  const activeItems = prev[activeContainer];
                  const activeIndex = activeItems.indexOf(active.id);
                  const overIndex = activeItems.indexOf(over.id);
                  return {
                      ...prev,
                      [activeContainer]: arrayMove(prev[activeContainer], activeIndex, overIndex)
                  };
              });
         }
         return;
      }

      // If dragging BETWEEN different containers
      // Special Logic for OrderBy/FilterBy:
      // - If dragging INTO OrderBy/FilterBy: We want to show a "copy" indicator ideally, 
      //   but dnd-kit moves. We defer the actual logic to DragEnd to avoid mutating state prematurely
      //   with "sort:*" prefixes during drag.
      
      // Standard Containers (Rows/Cols/Values/Available) can swap freely as before.
      const isSpecial = (c: string) => c === 'orderBy' || c === 'filterBy' || c === 'havingBy';

      // If involving special containers, skip DragOver updates to prevent state corruption/flickering.
      // Logic handled in DragEnd.
      if (isSpecial(activeContainer as string) || isSpecial(overContainer as string)) {
          // Visual Fix: If we are hovering over specific special zones, reset any intermediate states
          if (isSpecial(overContainer as string)) {
             if (startContainer && !isSpecial(startContainer) && activeContainer !== startContainer) {
                 setItems((prev: any) => {
                      if (!prev[activeContainer]?.includes(active.id)) return prev;
                      if (!prev[startContainer]) return prev;
  
                      // Remove from activeContainer (intermediate)
                      const intermediateRemoved = prev[activeContainer].filter((id: string) => id !== active.id);
                      
                      // Add back to startContainer at ORIGINAL INDEX
                      const sourceList = [...prev[startContainer]];
                      if (startIndex !== null && startIndex >= 0 && startIndex <= sourceList.length) {
                          sourceList.splice(startIndex, 0, active.id);
                      } else {
                          sourceList.push(active.id);
                      }
  
                      return {
                          ...prev,
                          [activeContainer]: intermediateRemoved,
                          [startContainer]: sourceList
                       };
                 });
             }
          }
          return;
      }

      // START FIX: Prevent dragging from GroupBy/SplitBy to Values to avoid accidental "copy in columns"
      // If the user intends to move to OrderBy, they might cross Values. 
      // We block move to "values" if active is "rows"/"columns" solely to protect against this?
      // No, that breaks valid use case.
      // Better: In handleDragEnd, if it ended up in OrderBy, we undo the move.
      // So no change here.
      
      // Standard behavior for standard containers
      setItems((prev: any) => {
          const activeItems = prev[activeContainer];
          const overItems = prev[overContainer];
          const activeIndex = activeItems.indexOf(active.id);
          const overIndex = (over.id in prev) 
            ? overItems.length + 1 
            : overItems.indexOf(over.id);

          let newIndex;
          if (over.id in prev) {
            newIndex = overItems.length + 1;
          } else {
            const isBelowOverItem =
            over &&
            active.rect.current?.translated &&
            active.rect.current.translated.top >
              (over.rect.top + over.rect.height);

            const modifier = isBelowOverItem ? 1 : 0;
            newIndex = overIndex >= 0 ? overIndex + modifier : overItems.length + 1;
          }

          return {
              ...prev,
              [activeContainer]: [
                  ...prev[activeContainer].filter((item: string) => item !== active.id)
              ],
              [overContainer]: [
                  ...prev[overContainer].slice(0, newIndex),
                  active.id,
                  ...prev[overContainer].slice(newIndex, prev[overContainer].length)
              ]
          };
      });
  };

  const handleDragEnd = (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) {
        setActiveId(null);
        isDraggingRef.current = false;
        return;
      }

      const activeContainer = findContainer(active.id as string);
      const overContainer = (over.id in items) ? over.id : findContainer(over.id as string);
      
      if (!activeContainer || !overContainer) {
           setActiveId(null);
           isDraggingRef.current = false;
           return;
      }

      const activeField = getFieldFromId(active.id as string);

      // --- LOGIC FOR ORDER BY / FILTER BY ---
      if (overContainer === 'orderBy' || overContainer === 'filterBy' || overContainer === 'havingBy') {
          // 1. Determine new ID
          // For filterBy/havingBy: use unique ID with timestamp to allow multiple on same field
          // For orderBy: use simple ID (no duplicates allowed)
          let newId: string;
          if (overContainer === 'filterBy') {
              newId = `filter:${activeField}:${Date.now()}`;
          } else if (overContainer === 'havingBy') {
              newId = `having:${activeField}:${Date.now()}`;
          } else {
              newId = `sort:${activeField}`;
          }

          // Checks for special list
          const isSpecial = (k: string | null) => k === 'orderBy' || k === 'filterBy' || k === 'havingBy';
          const isSpecialStart = isSpecial(startContainer);

          // Initialize sortMeta/filterMeta/havingMeta for new field BEFORE setItems
          if (overContainer === 'orderBy' && !sortMeta[activeField]) {
              setSortMeta((prev: Record<string, 'asc' | 'desc'>) => ({ ...prev, [activeField]: 'asc' }));
          }
          // For filterBy: always initialize with unique ID as key
          if (overContainer === 'filterBy') {
              setFilterMeta((prev: Record<string, { type: string, value: any }>) => ({ ...prev, [newId]: { type: 'contains', value: '' } }));
              // Auto-scroll to bottom of drop zones to show new filter
              setTimeout(() => {
                  dropZonesRef.current?.scrollTo({ top: dropZonesRef.current.scrollHeight, behavior: 'smooth' });
              }, 50);
          }
          // For havingBy: initialize with unique ID as key
          if (overContainer === 'havingBy') {
              // Determine default aggregation based on field type
              const fieldType = columnTypes[activeField];
              const defaultAgg = isNumericType(fieldType) ? 'sum' : 'count';
              setHavingMeta((prev: Record<string, { aggregation: string, type: string, value: any }>) => ({
                  ...prev,
                  [newId]: { aggregation: defaultAgg, type: 'greaterThan', value: '' }
              }));
              // Auto-scroll to bottom of drop zones to show new having
              setTimeout(() => {
                  dropZonesRef.current?.scrollTo({ top: dropZonesRef.current.scrollHeight, behavior: 'smooth' });
              }, 50);
          }

          setItems((prev: any) => {
              const newState = { ...prev };

              // A. Add to target
              // For filterBy/havingBy: always add (allows duplicates with unique IDs)
              // For orderBy: only if not exists
              if (overContainer === 'filterBy' || overContainer === 'havingBy') {
                  newState[overContainer] = [...newState[overContainer], newId];
              } else if (!newState[overContainer].includes(newId)) {
                   newState[overContainer] = [...newState[overContainer], newId];
              }

              // B. Restore to startContainer if it was lost (standard behavior removed it)
              // Only if we started in a standard container (rows, columns, values, available)
              if (startContainer && !isSpecialStart && !newState[startContainer].includes(active.id)) {
                  // Put it back in startContainer at ORIGINAL INDEX
                  const sourceList = [...newState[startContainer]];
                  if (startIndex !== null && startIndex >= 0 && startIndex <= sourceList.length) {
                      sourceList.splice(startIndex, 0, active.id);
                  } else {
                      sourceList.push(active.id);
                  }
                  newState[startContainer] = sourceList;

                  // Disable the "move" that happened.
                  // Find where it is now (likely 'values' due to drag-over) and remove it
                  const currentContainer = Object.keys(newState).find(k =>
                      !isSpecial(k) && k !== startContainer && newState[k].includes(active.id)
                  );

                  if (currentContainer) {
                       newState[currentContainer] = newState[currentContainer].filter((id: string) => id !== active.id);
                  }
              }

              return newState;
          });
      }
      // --- LOGIC FOR DROPPING special item INTO TRASH (Available or other) ---
      else if ((activeContainer === 'orderBy' || activeContainer === 'filterBy' || activeContainer === 'havingBy') && overContainer !== activeContainer) {
          // Remove from special container
          setItems((prev: any) => ({
              ...prev,
              [activeContainer]: prev[activeContainer].filter((id: string) => id !== active.id)
          }));
          // Do NOT add to 'available' or 'rows' because the field likely already exists there (implicit copy)
      }
      // --- STANDARD LOGIC (Available <-> Rows <-> Cols <-> Values) ---
      else if (activeContainer === overContainer) {
           // Sorting within same container
           // (Already handled in DragOver for standard, checking again for safety)
           const activeIndex = items[activeContainer as keyof typeof items].indexOf(active.id as string);
           const overIndex = items[overContainer as keyof typeof items].indexOf(over.id as string);
           
           if (activeIndex !== overIndex) {
              setItems((prev: any) => ({
                  ...prev,
                  [activeContainer]: arrayMove(prev[activeContainer], activeIndex, overIndex)
              }));
           }
      } 
      // Note: DragOver handles cross-container moves for standard types. 
      // But if we disabled it in DragOver for special types, we are safe.
      
      setActiveId(null);
      isDraggingRef.current = false;
      // Force sync with parent after drag ends
      setDragVersion(v => v + 1);
  };

  const handleRemove = (id: string, from: string) => {
      setItems((prev: any) => ({
          ...prev,
          [from]: prev[from].filter((item: string) => item !== id),
          available: [...prev.available, id].sort()
      }));
  };

  const handleAggregationChange = (id: string, agg: string) => {
      setMetricsMeta(prev => ({
          ...prev,
          [id]: { aggregation: agg }
      }));
  };

  /* STARTED NEW FEATURE: OrderBy/FilterBy - Handlers */
  const handleSortChange = (id: string, direction: 'asc' | 'desc') => {
      setSortMeta(prev => ({
            ...prev,
            [id]: direction
      }));
  };
  const handleFilterChange = (id: string, key: 'type' | 'value', val: any) => {
      setFilterMeta(prev => ({
          ...prev,
          [id]: {
              ...prev[id] || { type: 'contains', value: '' },
              [key]: val
          }
      }));
  };
  /* END NEW FEATURE */

  // Handler per Having By
  const handleHavingChange = (id: string, key: 'aggregation' | 'type' | 'value', val: any) => {
      setHavingMeta(prev => ({
          ...prev,
          [id]: {
              ...prev[id] || { aggregation: 'sum', type: 'greaterThan', value: '' },
              [key]: val
          }
      }));
  };

  return (
    <DndContext 
        sensors={sensors} 
        collisionDetection={closestCenter} 
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
    >
        <div className="flex flex-col h-full max-h-full bg-[#2b2b2b] text-sm border-r border-[#1a1a1a] w-64 flex-shrink-0 font-sans overflow-hidden">

             {/* 1. Drop Zones (Top Part - scrollable) */}
             <div ref={dropZonesRef} className="flex-1 min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 p-3">
                
                {/* Rows */}
                <DroppableContainer 
                    id="rows"
                    title="Group By"
                    items={items.rows}
                    onRemoveItem={(id: string) => handleRemove(id, 'rows')}
                    placeholder=""
                />
                
                {/* Columns */}
                <DroppableContainer 
                    id="columns"
                    title="Split By"
                    items={items.columns}
                    onRemoveItem={(id: string) => handleRemove(id, 'columns')}
                    placeholder=""
                />
    
                {/* Values */}
                <DroppableContainer
                    id="values"
                    title="Columns"
                    items={items.values}
                    metricsMeta={metricsMeta}
                    onRemoveItem={(id: string) => handleRemove(id, 'values')}
                    onAggregationChange={handleAggregationChange}
                    hasGroups={items.rows.length > 0}
                    placeholder=""
                    columnTypes={columnTypes}
                />

                {/* STARTED NEW FEATURE: OrderBy/FilterBy - New Containers */}
                <DroppableContainer 
                    id="orderBy"
                    title="Order By"
                    items={items.orderBy}
                    onRemoveItem={(id: string) => handleRemove(id, 'orderBy')}
                    onSortChange={handleSortChange}
                    sortMeta={sortMeta}
                    placeholder=""
                />

                <DroppableContainer
                    id="filterBy"
                    title="Filter By"
                    items={items.filterBy}
                    onRemoveItem={(id: string) => handleRemove(id, 'filterBy')}
                    onFilterChange={handleFilterChange}
                    filterMeta={filterMeta}
                    placeholder=""
                />

                <DroppableContainer
                    id="havingBy"
                    title="Having By"
                    items={items.havingBy}
                    onRemoveItem={(id: string) => handleRemove(id, 'havingBy')}
                    onHavingChange={handleHavingChange}
                    havingMeta={havingMeta}
                    placeholder=""
                    columnTypes={columnTypes}
                />
                {/* END NEW FEATURE */
                }

             </div>

             {/* 2. Available Columns (Bottom Part) */}

             <div className="h-1/3 flex flex-col min-h-[150px] border-t border-[#333] bg-[#2b2b2b]">
                 <div className="px-3 py-2 font-bold text-blue-400 text-[10px] uppercase tracking-wider">
                    All Columns
                 </div>
                 <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600">
                    <DroppableContainer 
                        id="available"
                        items={items.available}
                        isAvailableList={true}
                    />
                 </div>
             </div>
    
          </div>
          
          <DragOverlay>
            {activeId ? (
                 <div className="px-2 py-1.5 bg-[#404040] border border-blue-500 shadow-xl rounded w-48 opacity-90 flex items-center gap-2 cursor-grabbing text-white">
                    <GripVertical size={12} className="text-gray-300" />
                    <span className="truncate text-xs font-medium">{activeId}</span>
                </div>
            ) : null}
          </DragOverlay>

    </DndContext>
  );
}
