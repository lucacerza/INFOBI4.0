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

export interface BiGridConfigData {
  rows?: string[];
  columns?: string[];
  values?: BiGridMetric[];
}

interface BiGridConfigProps {
  config: BiGridConfigData;
  availableColumns: string[] | { name: string }[];
  onChange: (config: BiGridConfigData) => void;
}

// --- DRAG & DROP COMPONENTS ---

function SortableItem({ id, children, onRemove, onAggregationChange, aggregation, isAvailableList }: any) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
    
    // Use rigid transform to prevent blurring/distortion
    const style = {
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 999 : 'auto',
    };

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
                <span className="truncate font-sans">{children}</span>
            </div>
            
            <div className="flex items-center gap-1">
                {onAggregationChange && (
                    <select 
                        value={aggregation || 'sum'} 
                        onChange={(e) => { e.stopPropagation(); onAggregationChange(e.target.value); }}
                        onClick={(e) => e.stopPropagation()} 
                        onPointerDown={(e) => e.stopPropagation()} 
                        className="text-[10px] px-1 py-0.5 border border-[#555] rounded bg-[#2b2b2b] text-gray-300 focus:outline-none focus:border-blue-500"
                    >
                        <option value="sum">sum</option>
                        <option value="avg">avg</option>
                        <option value="count">cnt</option>
                        <option value="min">min</option>
                        <option value="max">max</option>
                    </select>
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

function DroppableContainer({ id, items, title, onRemoveItem, onAggregationChange, placeholder, metricsMeta, isAvailableList, hasGroups }: any) {
    const { setNodeRef } = useDroppable({ id });

    const renderedItems = items.map((itemId: string) => {
        const meta = metricsMeta ? metricsMeta[itemId] : null;
        const aggregation = meta ? meta.aggregation : null;
        
        // Show aggregation select only if we have groups (user request) OR if explicitly enabled
        // Actually, user said: "Selects in columns make sense only if at least one field in Group By"
        // So we pass 'hasGroups' to SortableItem or handled here.
        // If hasGroups is false, and this is 'values' container (which has onAggregationChange), hide select?
        const showAgg = onAggregationChange && hasGroups;

        return (
            <SortableItem 
                key={itemId} 
                id={itemId} 
                onRemove={onRemoveItem}
                onAggregationChange={showAgg ? (val: string) => onAggregationChange(itemId, val) : null}
                aggregation={aggregation}
                isAvailableList={isAvailableList}
            >
               {itemId} 
            </SortableItem> 
        );
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
  }>({
      available: [],
      rows: [],
      columns: [],
      values: []
  });

  // Metadata for metrics (aggregation types)
  const [metricsMeta, setMetricsMeta] = useState<Record<string, { aggregation: string }>>({});

  const [activeId, setActiveId] = useState<string | null>(null);
  
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
    ]);
    
    const available = colNames.filter((c: string) => !used.has(c));
    
    setItems({
        available,
        rows: currentRows,
        columns: currentColumns,
        values: valueIds
    });
  }, [availableColumns]); // Breaking dependency loops: don't depend on 'config' here, only init on mount or cols change

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
    
    // Only trigger if changes are real (comparisons logic omitted for simplicity, relying on parent dup check if any)
    onChange({
        rows: items.rows,
        columns: items.columns,
        values: complexValues
    });

  }, [items.rows, items.columns, items.values, metricsMeta, columnTypes]);


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
    return null;
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
    isDraggingRef.current = true;
  };

  const handleDragOver = (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) return;
      
      const activeContainer = findContainer(active.id as string);
      // If over a container directly (e.g. empty placeholder) use its id, else find the item's container
      const overContainer = (over.id in items) 
          ? over.id 
          : findContainer(over.id as string);

      if (!activeContainer || !overContainer || activeContainer === overContainer) {
          return;
      }

      // Moving between containers during drag (optimistic UI)
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
            active.rect.current.translated &&
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
      const activeContainer = findContainer(active.id as string);
      let overContainer: any = null;
      if (over) {
        overContainer = (over.id in items) ? over.id : findContainer(over.id as string);
      }

      if (activeContainer && overContainer && activeContainer === overContainer) {
          const activeIndex = items[activeContainer as keyof typeof items].indexOf(active.id as string);
          const overIndex = items[overContainer as keyof typeof items].indexOf(over!.id as string);
          
          if (activeIndex !== overIndex) {
              setItems((prev: any) => ({
                  ...prev,
                  [activeContainer]: arrayMove(prev[activeContainer], activeIndex, overIndex)
              }));
          }
      }
      setActiveId(null);
      isDraggingRef.current = false;
      
      // Force a sync tick after drag ends
      const complexValues: BiGridMetric[] = items.values.map((id: string) => {
        let agg = metricsMeta[id]?.aggregation;
        if (!agg) {
            const type = columnTypes[id];
            agg = (type === 'number' || type === 'float' || type === 'integer') ? 'sum' : 'count';
        }
        return {
            id,
            field: id,
            aggregation: agg as any
        };
      });
      onChange({
        rows: items.rows,
        columns: items.columns,
        values: complexValues
      });
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

  return (
    <DndContext 
        sensors={sensors} 
        collisionDetection={closestCenter} 
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
    >
        <div className="flex flex-col h-full bg-[#2b2b2b] text-sm border-r border-[#1a1a1a] w-64 flex-shrink-0 font-sans">
             
             {/* 1. Drop Zones (Top Part) */}
             <div className="flex-1 flex flex-col min-h-0 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 p-3">
                
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
                    title="Color"
                    items={items.values}
                    metricsMeta={metricsMeta}
                    onRemoveItem={(id: string) => handleRemove(id, 'values')}
                    onAggregationChange={handleAggregationChange}
                    hasGroups={items.rows.length > 0}
                    placeholder=""
                />
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
