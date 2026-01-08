/**
 * BiGridConfig - Pivot Configuration Sidebar (IDENTICAL TO PERSPECTIVE.JS)
 *
 * Layout matches Perspective.js EXACTLY:
 * - Group By (row dimensions)
 * - Split By (column dimensions - multi-level!)
 * - Where (filters)
 * - Columns (metrics/aggregations)
 * - All Columns (available fields)
 * 
 * Enhanced with @dnd-kit for smooth animations
 */
import React, { useState, useEffect } from 'react';
import { X, ChevronDown, ChevronRight, GripVertical } from 'lucide-react';
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  DragOverEvent,
  useDroppable
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface ColumnInfo {
  name: string;
  type: 'string' | 'number' | 'date';
  label?: string;
}

interface MetricConfig {
  id: string;
  name: string;
  field: string;
  aggregation: 'SUM' | 'AVG' | 'COUNT' | 'MIN' | 'MAX';
}

interface PivotConfig {
  rows: string[];
  columns: string[];
  values: MetricConfig[];
}

interface BiGridConfigProps {
  availableColumns: ColumnInfo[];
  config: PivotConfig;
  onChange: (config: PivotConfig) => void;
}

export default function BiGridConfig({ availableColumns, config, onChange }: BiGridConfigProps) {
  // Local state for optimistic UI during drag
  const [localConfig, setLocalConfig] = useState<PivotConfig>(config);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeZone, setActiveZone] = useState<'groupBy' | 'splitBy' | 'columns' | 'allColumns' | null>(null);
  const [activeOperation, setActiveOperation] = useState<MetricConfig['aggregation'] | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  // Sync local state when parent config changes (from external updates)
  useEffect(() => {
    setLocalConfig(config);
  }, [config]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement to start drag
      },
    }),
    useSensor(KeyboardSensor)
  );

  const addToGroupBy = (field: string) => {
    if (!config.rows.includes(field)) {
      onChange({ ...config, rows: [...config.rows, field] });
    }
  };

  const addToSplitBy = (field: string) => {
    if (!config.columns.includes(field)) {
      onChange({ ...config, columns: [...config.columns, field] });
    }
  };

  const addToColumns = (field: string, customAggregation?: MetricConfig['aggregation']) => {
    // Use custom aggregation from menu if provided, otherwise use type-based default
    let aggregation: MetricConfig['aggregation'];

    if (customAggregation) {
      aggregation = customAggregation;
    } else {
      const col = availableColumns.find(c => c.name === field);
      aggregation = (col?.type === 'number') ? 'SUM' : 'MAX';
    }

    const newMetric: MetricConfig = {
      id: `${field}-${Date.now()}`,
      name: field,
      field: field,
      aggregation: aggregation
    };
    onChange({ ...config, values: [...config.values, newMetric] });
  };

  const removeFromGroupBy = (field: string) => {
    onChange({ ...config, rows: config.rows.filter(r => r !== field) });
  };

  const removeFromSplitBy = (field: string) => {
    onChange({ ...config, columns: config.columns.filter(c => c !== field) });
  };

  const removeFromColumns = (id: string) => {
    onChange({ ...config, values: config.values.filter(v => v.id !== id) });
  };

  const changeAggregation = (id: string, agg: MetricConfig['aggregation']) => {
    onChange({
      ...config,
      values: config.values.map(v => v.id === id ? { ...v, aggregation: agg } : v)
    });
  };

  // @dnd-kit handlers
  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    // Store full ID for visibility debugging
    setActiveId(String(active.id));
    
    // Parse zone for logic usage if needed (though logic uses event.active)
    const parts = String(active.id).split('::');
    if (parts.length === 2) {
      setActiveZone(parts[0] as any);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    
    setOverId(String(over.id));
    
    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);

    const [activeZoneRaw, activeField] = activeIdStr.split('::');
    let [overZoneRaw, overField] = overIdStr.split('::');

    // Normalize droppable-* ids used for empty-zone drops
    const activeZone = activeZoneRaw.startsWith('droppable-') ? activeZoneRaw.replace('droppable-', '') : activeZoneRaw;
    const overZone = overZoneRaw && overZoneRaw.startsWith('droppable-') ? overZoneRaw.replace('droppable-', '') : overZoneRaw;
    
    // Don't do anything if same item
    if (activeIdStr === overIdStr) return;
    
    // Optimistic reordering between different zones (like INFOBI5.0)
    // Update LOCAL state only - no commit to parent until drop
    
    // Moving from allColumns to groupBy
    if (activeZone === 'allColumns' && overZone === 'groupBy') {
      const newRows = [...localConfig.rows];
      if (!newRows.includes(activeField)) {
        const insertIndex = overField ? newRows.indexOf(overField) : newRows.length;
        newRows.splice(insertIndex >= 0 ? insertIndex : newRows.length, 0, activeField);
        setLocalConfig({ ...localConfig, rows: newRows });
      }
    }
    
    // Moving from allColumns to splitBy
    else if (activeZone === 'allColumns' && overZone === 'splitBy') {
      const newCols = [...localConfig.columns];
      if (!newCols.includes(activeField)) {
        const insertIndex = overField ? newCols.indexOf(overField) : newCols.length;
        newCols.splice(insertIndex >= 0 ? insertIndex : newCols.length, 0, activeField);
        setLocalConfig({ ...localConfig, columns: newCols });
      }
    }
    
    // Moving from allColumns to columns (metrics)
    else if (activeZone === 'allColumns' && overZone === 'columns') {
      const col = availableColumns.find(c => c.name === activeField);
      if (col && !localConfig.values.find(v => v.field === activeField)) {
        const aggregation = col.type === 'number' ? 'SUM' : 'MAX';
        const newMetric: MetricConfig = {
          id: `${activeField}-${Date.now()}`,
          name: activeField,
          field: activeField,
          aggregation
        };
        const newValues = [...localConfig.values];
        // If overField is an item id, find its index; if overField is empty (droppable target), insert at end
        const insertIndex = overField ? newValues.findIndex(v => v.id === overField) : newValues.length;
        newValues.splice(insertIndex >= 0 ? insertIndex : newValues.length, 0, newMetric);
        setLocalConfig({ ...localConfig, values: newValues });
      }
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    console.log('🎯 [DND] handleDragEnd called', { active: active.id, over: over?.id });
    
    if (!over) {
      console.log('❌ [DND] No over target, resetting to original config');
      // Reset to original config (cancel drag)
      setLocalConfig(config);
      setActiveId(null);
      setActiveZone(null);
      setActiveOperation(null);
      setOverId(null);
      return;
    }

    const [activeZoneStr, activeField] = String(active.id).split('::');
    const overStr = String(over.id);
    let overZoneStr: string;
    let overField: string;
    
    // Check if over is a droppable zone or an item
    if (overStr.startsWith('droppable-')) {
      overZoneStr = overStr.replace('droppable-', '');
      overField = '';
      console.log('📦 [DND] Dropped on droppable zone:', overZoneStr);
    } else {
      [overZoneStr, overField] = overStr.split('::');
      console.log('🎯 [DND] Dropped on item:', { zone: overZoneStr, field: overField });
    }

    console.log('🔍 [DND] Zones:', { from: activeZoneStr, to: overZoneStr, sameZone: activeZoneStr === overZoneStr });

    let finalConfig = { ...localConfig };

    // CASE 1: Reordering within same zone
    if (activeZoneStr === overZoneStr && overField && activeField !== overField) {
      console.log('🔄 [DND] CASE 1: Reordering within same zone');
      switch (activeZoneStr) {
        case 'groupBy': {
          const oldIndex = localConfig.rows.indexOf(activeField);
          const newIndex = localConfig.rows.indexOf(overField);
          console.log('📊 [DND] GroupBy reorder:', { oldIndex, newIndex, field: activeField });
          finalConfig = { ...localConfig, rows: arrayMove(localConfig.rows, oldIndex, newIndex) };
          break;
        }
        case 'splitBy': {
          const oldIndex = localConfig.columns.indexOf(activeField);
          const newIndex = localConfig.columns.indexOf(overField);
          console.log('📊 [DND] SplitBy reorder:', { oldIndex, newIndex, field: activeField });
          finalConfig = { ...localConfig, columns: arrayMove(localConfig.columns, oldIndex, newIndex) };
          break;
        }
        case 'columns': {
          const oldIndex = localConfig.values.findIndex(v => v.id === activeField);
          const newIndex = localConfig.values.findIndex(v => v.id === overField);
          console.log('📊 [DND] Columns reorder:', { oldIndex, newIndex, id: activeField });
          finalConfig = { ...localConfig, values: arrayMove(localConfig.values, oldIndex, newIndex) };
          break;
        }
      }
    }
    // CASE 2: Moving between zones OR dropping on empty zone
    else if (activeZoneStr !== overZoneStr) {
      console.log('➡️ [DND] CASE 2: Moving between zones');
      
      // If localConfig already has the change from dragOver, use it
      // Otherwise, add the item now (handles empty zone drops)
      switch (overZoneStr) {
        case 'groupBy': {
          if (!localConfig.rows.includes(activeField)) {
            console.log('➕ [DND] Adding to GroupBy:', activeField);
            finalConfig = { ...localConfig, rows: [...localConfig.rows, activeField] };
          }
          break;
        }
        case 'splitBy': {
          if (!localConfig.columns.includes(activeField)) {
            console.log('➕ [DND] Adding to SplitBy:', activeField);
            finalConfig = { ...localConfig, columns: [...localConfig.columns, activeField] };
          }
          break;
        }
        case 'columns': {
          // Check if field already exists as a metric
          if (!localConfig.values.find(v => v.field === activeField)) {
            console.log('➕ [DND] Adding to Columns:', activeField);
            const col = availableColumns.find(c => c.name === activeField);
            const aggregation = col?.type === 'number' ? 'SUM' : 'MAX';
            const newMetric: MetricConfig = {
              id: `${activeField}-${Date.now()}`,
              name: activeField,
              field: activeField,
              aggregation
            };
            finalConfig = { ...localConfig, values: [...localConfig.values, newMetric] };
          }
          break;
        }
      }
    }

    // Commit final config to parent
    console.log('✅ [DND] Committing final config:', finalConfig);
    onChange(finalConfig);

    setActiveId(null);
    setActiveZone(null);
    setActiveOperation(null);
    setOverId(null);
  };

  // Show fields in "All Columns" - remove fields that are already in "Columns" (like Perspective.js)
  // BUT keep fields that are in Group By or Split By (user can use same field multiple times)
  const usedInColumns = new Set(localConfig.values.map(v => v.field));
  const availableFields = availableColumns.filter(col => !usedInColumns.has(col.name));

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="w-64 bg-[#1e1e1e] text-white border-r border-gray-700 flex flex-col h-full text-xs font-mono">
        {/* PERSPECTIVE.JS STYLE SECTIONS */}
        <div className="flex-1 overflow-auto">

          {/* GROUP BY (Row Dimensions) */}
          <Section title="Group By" count={localConfig.rows.length} defaultOpen={true}>
            <DroppableZone id="droppable-groupBy">
              <SortableContext
                items={localConfig.rows.map(field => `groupBy::${field}`)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-1 min-h-[40px]">
                  {localConfig.rows.map((field, idx) => {
                    const col = availableColumns.find(c => c.name === field);
                    const activeField = activeId ? String(activeId).split('::')[1] : null;
                    return (
                      <SortableDimensionChip
                        key={`groupBy::${field}`}
                        id={`groupBy::${field}`}
                        label={col?.label || field}
                        type={col?.type || 'string'}
                        onRemove={() => removeFromGroupBy(field)}
                        forceGhost={activeField === field}
                      />
                    );
                  })}
                  {localConfig.rows.length === 0 && (
                    <div className="text-gray-500 italic px-2 py-1 text-[10px]">
                      Drag fields here
                    </div>
                  )}
                </div>
              </SortableContext>
            </DroppableZone>
          </Section>

          {/* SPLIT BY (Column Dimensions - Multi-Level!) */}
          <Section title="Split By" count={localConfig.columns.length} defaultOpen={true}>
            <DroppableZone id="droppable-splitBy">
              <SortableContext
                items={localConfig.columns.map(field => `splitBy::${field}`)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-1 min-h-[40px]">
                  {localConfig.columns.map((field, idx) => {
                    const col = availableColumns.find(c => c.name === field);
                    const activeField = activeId ? String(activeId).split('::')[1] : null;
                    return (
                      <SortableDimensionChip
                        key={`splitBy::${field}`}
                        id={`splitBy::${field}`}
                        label={col?.label || field}
                        type={col?.type || 'string'}
                        onRemove={() => removeFromSplitBy(field)}
                        forceGhost={activeField === field}
                      />
                    );
                  })}
                  {localConfig.columns.length === 0 && (
                    <div className="text-gray-500 italic px-2 py-1 text-[10px]">
                      Drag fields here
                    </div>
                  )}
                </div>
              </SortableContext>
            </DroppableZone>
          </Section>

          {/* WHERE (Filters) - TODO */}
          <Section title="Where" count={0} defaultOpen={false}>
            <div className="text-gray-500 italic px-2 py-1 text-[10px]">
              No filters
            </div>
          </Section>

          {/* COLUMNS (Metrics/Aggregations) */}
          <Section title="Columns" count={localConfig.values.length} defaultOpen={true}>
            <DroppableZone id="droppable-columns">
              <SortableContext
                items={localConfig.values.map(v => `columns::${v.id}`)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-1 min-h-[40px]">
                  {localConfig.values.map((metric, idx) => {
                    const activeField = activeId ? String(activeId).split('::')[1] : null;
                    return (
                      <SortableMetricChip
                        key={`columns::${metric.id}`}
                        id={`columns::${metric.id}`}
                        metric={metric}
                        onRemove={() => removeFromColumns(metric.id)}
                        onChangeAggregation={(agg) => changeAggregation(metric.id, agg)}
                        forceGhost={activeField === metric.field}
                      />
                    );
                  })}
                  {localConfig.values.length === 0 && (
                    <div className="text-gray-500 italic px-2 py-1 text-[10px]">
                      Drag fields here
                    </div>
                  )}
                </div>
              </SortableContext>
            </DroppableZone>
          </Section>

          {/* ALL COLUMNS (Available Fields) */}
          <Section title="All Columns" count={availableFields.length} defaultOpen={true}>
            <SortableContext
              items={availableFields.map(col => `allColumns::${col.name}`)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-0.5">
                {availableFields.map(col => (
                  <SortableFieldRow
                    key={`allColumns::${col.name}`}
                    id={`allColumns::${col.name}`}
                    column={col}
                  />
                ))}
              </div>
            </SortableContext>
          </Section>
        </div>
      </div>

      {/* Drag Overlay */}
      <DragOverlay dropAnimation={{
        duration: 200,
        easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
      }}>
        {activeId && activeZone ? (() => {
          const [zone, field] = String(activeId).split('::');
          
          // If dragging from columns (metric)
          if (zone === 'columns') {
            const metric = localConfig.values.find(v => v.id === field);
            if (metric) {
              return <MetricChipOverlay metric={metric} />;
            }
          }
          
          // If dragging dimension (groupBy, splitBy, or allColumns)
          const col = availableColumns.find(c => c.name === field);
          if (col) {
            return <DimensionChipOverlay label={col.label || col.name} type={col.type} />;
          }
          
          return null;
        })() : null}
      </DragOverlay>
    </DndContext>
  );
}

// Collapsible Section (Perspective.js style)
function Section({
  title,
  count,
  children,
  defaultOpen = false
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <div className="border-b border-gray-700">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-2 py-1.5 flex items-center justify-between hover:bg-gray-800 text-left"
      >
        <div className="flex items-center gap-1">
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <span className="font-semibold text-[11px] uppercase tracking-wide text-gray-300">
            {title}
          </span>
          {count > 0 && (
            <span className="text-[10px] text-gray-500">({count})</span>
          )}
        </div>
      </button>
      {open && (
        <div className="px-1 py-1">
          {children}
        </div>
      )}
    </div>
  );
}

// Droppable Zone wrapper
function DroppableZone({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id });
  
  return (
    <div ref={setNodeRef}>
      {children}
    </div>
  );
}

// Sortable Dimension Chip (for Group By and Split By)
function SortableDimensionChip({
  id,
  label,
  type,
  onRemove,
  forceGhost
}: {
  id: string;
  label: string;
  type: 'string' | 'number' | 'date';
  onRemove: () => void;
  forceGhost?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging || forceGhost ? 0.5 : 1
  };

  const typeIcon = type === 'number' ? '#' : type === 'date' ? '📅' : 'T';
  const typeColor = type === 'number' ? 'text-blue-400' : type === 'date' ? 'text-purple-400' : 'text-gray-400';

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="flex items-center gap-1 px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded border border-gray-600 cursor-grab active:cursor-grabbing"
    >
      <span className={`text-[10px] font-mono ${typeColor} w-3`}>{typeIcon}</span>
      <span className="flex-1 truncate text-[11px]">{label}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="hover:text-red-400 transition"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

// Sortable Metric Chip (for Columns section)
function SortableMetricChip({
  id,
  metric,
  onRemove,
  onChangeAggregation,
  forceGhost
}: {
  id: string;
  metric: MetricConfig;
  onRemove: () => void;
  onChangeAggregation: (agg: MetricConfig['aggregation']) => void;
  forceGhost?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging || forceGhost ? 0.5 : 1
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="flex items-center gap-1 px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded border border-gray-600 cursor-grab active:cursor-grabbing"
    >
      <span className="text-[10px] font-mono text-green-400 w-3">#</span>

      {/* Aggregation Selector (like Perspective.js) */}
      <select
        value={metric.aggregation}
        onChange={(e) => onChangeAggregation(e.target.value as MetricConfig['aggregation'])}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className="text-[10px] px-1 py-0.5 bg-gray-900 border border-gray-600 rounded text-gray-300 font-mono cursor-pointer"
      >
        <option value="SUM">sum</option>
        <option value="AVG">avg</option>
        <option value="COUNT">count</option>
        <option value="MIN">min</option>
        <option value="MAX">max</option>
      </select>

      <span className="flex-1 truncate text-[11px]">{metric.name}</span>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="hover:text-red-400 transition"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

// Sortable Field Row (for All Columns section)
function SortableFieldRow({
  id,
  column,
  forceGhost
}: {
  id: string;
  column: ColumnInfo;
  forceGhost?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging || forceGhost ? 0.5 : 1
  };

  const typeIcon = column.type === 'number' ? '#' : column.type === 'date' ? '📅' : 'T';
  const typeColor = column.type === 'number' ? 'text-blue-400' : column.type === 'date' ? 'text-purple-400' : 'text-gray-400';

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="flex items-center gap-1 px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded border border-gray-600 cursor-grab active:cursor-grabbing"
    >
      <span className={`text-[10px] font-mono ${typeColor} w-3`}>{typeIcon}</span>
      <span className="flex-1 truncate text-[11px]">{column.label || column.name}</span>
      <div style={{ width: 44 }} />
    </div>
  );
}

// Drag Overlay Components
function DimensionChipOverlay({
  label,
  type
}: {
  label: string;
  type: 'string' | 'number' | 'date';
}) {
  const typeIcon = type === 'number' ? '#' : type === 'date' ? '📅' : 'T';
  const typeColor = type === 'number' ? 'text-blue-400' : type === 'date' ? 'text-purple-400' : 'text-gray-400';

  return (
    <div 
      className="flex items-center gap-1 px-3 py-2 bg-gray-800 text-white rounded border border-gray-600 shadow-2xl cursor-grabbing"
      style={{ transform: 'rotate(-3deg) scale(1.05)' }}
    >
      <span className={`text-[11px] font-mono ${typeColor} w-3`}>{typeIcon}</span>
      <span className="flex-1 truncate text-[11px]">{label}</span>
    </div>
  );
}

function MetricChipOverlay({ metric }: { metric: MetricConfig }) {
  return (
    <div 
      className="flex items-center gap-1 px-3 py-2 bg-gray-800 text-white rounded border border-gray-600 shadow-2xl cursor-grabbing"
      style={{ transform: 'rotate(-3deg) scale(1.05)' }}
    >
      <span className="text-[11px] font-mono text-green-400 w-3">#</span>
      <span className="text-[10px] px-1.5 py-0.5 bg-gray-900 border border-gray-600 rounded text-gray-300 font-mono">
        {metric.aggregation.toLowerCase()}
      </span>
      <span className="flex-1 truncate text-[11px]">{metric.name}</span>
    </div>
  );
}
