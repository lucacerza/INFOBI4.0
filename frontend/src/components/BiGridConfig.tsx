/**
 * BiGridConfig - Pivot Configuration Sidebar (IDENTICAL TO PERSPECTIVE.JS)
 *
 * Layout matches Perspective.js EXACTLY:
 * - Group By (row dimensions)
 * - Split By (column dimensions - multi-level!)
 * - Where (filters)
 * - Columns (metrics/aggregations)
 * - All Columns (available fields)
 */
import React, { useState } from 'react';
import { X, ChevronDown, ChevronRight } from 'lucide-react';

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
  const [draggedField, setDraggedField] = useState<string | null>(null);
  const [draggedOperation, setDraggedOperation] = useState<MetricConfig['aggregation'] | null>(null);
  const [draggedFromColumns, setDraggedFromColumns] = useState<boolean>(false);

  // State for reordering within areas
  const [draggedFromZone, setDraggedFromZone] = useState<'groupBy' | 'splitBy' | 'columns' | 'allColumns' | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

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

  // Drag and Drop handlers
  const handleDragStart = (
    e: React.DragEvent,
    field: string,
    zone: 'groupBy' | 'splitBy' | 'columns' | 'allColumns',
    index?: number,
    operation?: MetricConfig['aggregation']
  ) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', field);
    setDraggedField(field);
    setDraggedFromZone(zone);
    setDraggedIndex(index ?? null);
    setDraggedOperation(operation || null);
    setDraggedFromColumns(zone === 'columns');
  };

  const handleDragEnd = () => {
    setDraggedField(null);
    setDraggedFromZone(null);
    setDraggedIndex(null);
    setDropTargetIndex(null);
    setDraggedOperation(null);
    setDraggedFromColumns(false);
  };

  const handleDrop = (zone: 'groupBy' | 'splitBy' | 'columns', targetIndex?: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (!draggedField) return;

    // CASE 1: Reordering within the same zone
    if (draggedFromZone === zone && draggedIndex !== null && targetIndex !== undefined) {
      switch (zone) {
        case 'groupBy':
          const newRows = [...config.rows];
          const [removed] = newRows.splice(draggedIndex, 1);
          newRows.splice(targetIndex, 0, removed);
          onChange({ ...config, rows: newRows });
          break;
        case 'splitBy':
          const newCols = [...config.columns];
          const [removedCol] = newCols.splice(draggedIndex, 1);
          newCols.splice(targetIndex, 0, removedCol);
          onChange({ ...config, columns: newCols });
          break;
        case 'columns':
          const newValues = [...config.values];
          const [removedVal] = newValues.splice(draggedIndex, 1);
          newValues.splice(targetIndex, 0, removedVal);
          onChange({ ...config, values: newValues });
          break;
      }
      handleDragEnd();
      return;
    }

    // CASE 2: Moving from another zone (existing behavior)
    const col = availableColumns.find(c => c.name === draggedField);
    if (!col) return;

    switch (zone) {
      case 'groupBy':
        // If dragging from Columns, remove it from Columns first
        if (draggedFromColumns) {
          onChange({
            ...config,
            rows: [...config.rows, draggedField],
            values: config.values.filter(v => v.field !== draggedField)
          });
        } else {
          addToGroupBy(draggedField);
        }
        break;
      case 'splitBy':
        // If dragging from Columns, remove it from Columns first
        if (draggedFromColumns) {
          onChange({
            ...config,
            columns: [...config.columns, draggedField],
            values: config.values.filter(v => v.field !== draggedField)
          });
        } else {
          addToSplitBy(draggedField);
        }
        break;
      case 'columns':
        // Only allow adding to Columns if not already there
        if (!draggedFromColumns) {
          addToColumns(draggedField, draggedOperation || undefined);
        }
        break;
    }

    handleDragEnd();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  // Show fields in "All Columns" - remove fields that are already in "Columns" (like Perspective.js)
  // BUT keep fields that are in Group By or Split By (user can use same field multiple times)
  const usedInColumns = new Set(config.values.map(v => v.field));
  const availableFields = availableColumns.filter(col => !usedInColumns.has(col.name));

  return (
    <div className="w-64 bg-[#1e1e1e] text-white border-r border-gray-700 flex flex-col h-full text-xs font-mono">
      {/* PERSPECTIVE.JS STYLE SECTIONS */}
      <div className="flex-1 overflow-auto">

        {/* GROUP BY (Row Dimensions) */}
        <Section title="Group By" count={config.rows.length} defaultOpen={true}>
          <div
            className="space-y-1 min-h-[40px]"
            onDrop={handleDrop('groupBy')}
            onDragOver={handleDragOver}
          >
            {config.rows.map((field, idx) => {
              const col = availableColumns.find(c => c.name === field);
              return (
                <DimensionChip
                  key={`${field}-${idx}`}
                  label={col?.label || field}
                  type={col?.type || 'string'}
                  onRemove={() => removeFromGroupBy(field)}
                  index={idx}
                  onDragStart={(e) => handleDragStart(e, field, 'groupBy', idx)}
                  onDragEnd={handleDragEnd}
                  onDrop={(e) => handleDrop('groupBy', idx)(e)}
                  onDragOver={handleDragOver}
                />
              );
            })}
            {config.rows.length === 0 && (
              <div className="text-gray-500 italic px-2 py-1 text-[10px]">
                Drag fields here
              </div>
            )}
          </div>
        </Section>

        {/* SPLIT BY (Column Dimensions - Multi-Level!) */}
        <Section title="Split By" count={config.columns.length} defaultOpen={true}>
          <div
            className="space-y-1 min-h-[40px]"
            onDrop={handleDrop('splitBy')}
            onDragOver={handleDragOver}
          >
            {config.columns.map((field, idx) => {
              const col = availableColumns.find(c => c.name === field);
              return (
                <DimensionChip
                  key={`${field}-${idx}`}
                  label={col?.label || field}
                  type={col?.type || 'string'}
                  onRemove={() => removeFromSplitBy(field)}
                  index={idx}
                  onDragStart={(e) => handleDragStart(e, field, 'splitBy', idx)}
                  onDragEnd={handleDragEnd}
                  onDrop={(e) => handleDrop('splitBy', idx)(e)}
                  onDragOver={handleDragOver}
                />
              );
            })}
            {config.columns.length === 0 && (
              <div className="text-gray-500 italic px-2 py-1 text-[10px]">
                Drag fields here
              </div>
            )}
          </div>
        </Section>

        {/* WHERE (Filters) - TODO */}
        <Section title="Where" count={0} defaultOpen={false}>
          <div className="text-gray-500 italic px-2 py-1 text-[10px]">
            No filters
          </div>
        </Section>

        {/* COLUMNS (Metrics/Aggregations) */}
        <Section title="Columns" count={config.values.length} defaultOpen={true}>
          <div
            className="space-y-1 min-h-[40px]"
            onDrop={handleDrop('columns')}
            onDragOver={handleDragOver}
          >
            {config.values.map((metric, idx) => (
              <MetricChip
                key={metric.id}
                metric={metric}
                index={idx}
                onRemove={() => removeFromColumns(metric.id)}
                onChangeAggregation={(agg) => changeAggregation(metric.id, agg)}
                onDragStart={(e) => handleDragStart(e, metric.field, 'columns', idx, metric.aggregation)}
                onDragEnd={handleDragEnd}
                onDrop={(e) => handleDrop('columns', idx)(e)}
                onDragOver={handleDragOver}
              />
            ))}
            {config.values.length === 0 && (
              <div className="text-gray-500 italic px-2 py-1 text-[10px]">
                Drag fields here
              </div>
            )}
          </div>
        </Section>

        {/* ALL COLUMNS (Available Fields) */}
        <Section title="All Columns" count={availableFields.length} defaultOpen={true}>
          <div className="space-y-0.5">
            {availableFields.map(col => (
              <FieldRow
                key={col.name}
                column={col}
                onDragStart={(e, op) => handleDragStart(e, col.name, 'allColumns', undefined, op)}
                onDragEnd={handleDragEnd}
              />
            ))}
          </div>
        </Section>
      </div>
    </div>
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

// Dimension Chip (for Group By and Split By)
function DimensionChip({
  label,
  type,
  onRemove,
  index,
  onDragStart,
  onDragEnd,
  onDrop,
  onDragOver
}: {
  label: string;
  type: 'string' | 'number' | 'date';
  onRemove: () => void;
  index: number;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
}) {
  const typeIcon = type === 'number' ? '#' : type === 'date' ? '📅' : 'T';
  const typeColor = type === 'number' ? 'text-blue-400' : type === 'date' ? 'text-purple-400' : 'text-gray-400';

  return (
    <div
      draggable="true"
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDrop={onDrop}
      onDragOver={onDragOver}
      className="flex items-center gap-1 px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded border border-gray-600 cursor-grab active:cursor-grabbing"
    >
      <span className={`text-[10px] font-mono ${typeColor} w-3`}>{typeIcon}</span>
      <span className="flex-1 truncate text-[11px]">{label}</span>
      <button
        onClick={onRemove}
        onMouseDown={(e) => e.stopPropagation()}
        className="hover:text-red-400 transition"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

// Metric Chip (for Columns section) - Draggable with select dropdown (Perspective.js style)
function MetricChip({
  metric,
  index,
  onRemove,
  onChangeAggregation,
  onDragStart,
  onDragEnd,
  onDrop,
  onDragOver
}: {
  metric: MetricConfig;
  index: number;
  onRemove: () => void;
  onChangeAggregation: (agg: MetricConfig['aggregation']) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
}) {
  return (
    <div
      draggable="true"
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDrop={onDrop}
      onDragOver={onDragOver}
      className="flex items-center gap-1 px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded border border-gray-600 cursor-grab active:cursor-grabbing"
    >
      <span className="text-[10px] font-mono text-green-400 w-3">#</span>

      {/* Aggregation Selector (like Perspective.js) */}
      <select
        value={metric.aggregation}
        onChange={(e) => onChangeAggregation(e.target.value as MetricConfig['aggregation'])}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
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
        onClick={onRemove}
        onMouseDown={(e) => e.stopPropagation()}
        className="hover:text-red-400 transition"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

// Field Row (for All Columns section) - Simple draggable field
function FieldRow({
  column,
  onDragStart,
  onDragEnd
}: {
  column: ColumnInfo;
  onDragStart: (e: React.DragEvent, operation?: MetricConfig['aggregation']) => void;
  onDragEnd: () => void;
}) {
  const typeIcon = column.type === 'number' ? '#' : column.type === 'date' ? '📅' : 'T';
  const typeColor = column.type === 'number' ? 'text-blue-400' : column.type === 'date' ? 'text-purple-400' : 'text-gray-400';

  // When dragging from "All Columns", no operation is pre-selected
  const handleDragStart = (e: React.DragEvent) => {
    onDragStart(e, undefined);
  };

  return (
    <div
      draggable="true"
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      className="flex items-center gap-1 px-2 py-0.5 hover:bg-gray-800 rounded cursor-grab active:cursor-grabbing"
    >
      <span className={`text-[10px] font-mono ${typeColor} w-3`}>{typeIcon}</span>
      <span className="flex-1 truncate text-[11px]">
        {column.label || column.name}
      </span>
    </div>
  );
}
