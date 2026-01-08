/**
 * VirtualizedBiGrid - BiGrid with Row Virtualization
 * 
 * Handles 1M+ rows by rendering only visible rows using @tanstack/react-virtual
 */
import React, { useRef, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

interface ColumnDef {
  accessorKey?: string;
  header: string;
  size: number;
  meta?: {
    isGroupColumn?: boolean;
    isTreeColumn?: boolean;
    isNumber?: boolean;
    isColumnGroup?: boolean;
    level?: number;
  };
  columns?: ColumnDef[];
}

interface VirtualizedBiGridProps {
  columns: ColumnDef[];
  data: any[];
  grouping: string[];
  expandedRows: Set<string>;
  onToggleRow: (key: string) => void;
  estimatedRowHeight?: number;
}

export function VirtualizedBiGrid({
  columns,
  data,
  grouping,
  expandedRows,
  onToggleRow,
  estimatedRowHeight = 35
}: VirtualizedBiGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  // Flatten data (includes expanded children)
  const flatData = React.useMemo(() => {
    const result: any[] = [];
    
    function traverse(rows: any[]) {
      rows.forEach(row => {
        result.push(row);
        if (row._isGroup && expandedRows.has(row._groupKey) && row._children) {
          traverse(row._children);
        }
      });
    }
    
    traverse(data);
    return result;
  }, [data, expandedRows]);

  // Create virtualizer
  const rowVirtualizer = useVirtualizer({
    count: flatData.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimatedRowHeight,
    overscan: 10 // Render 10 extra rows above/below for smooth scrolling
  });

  const flatColumns = React.useMemo(() => flattenColumns(columns), [columns]);
  const headerLevels = React.useMemo(() => getHeaderLevels(columns), [columns]);

  return (
    <div className="flex flex-col h-full">
      {/* Header (fixed) */}
      <div className="bigrid-header sticky top-0 z-10 bg-white border-b-2 border-gray-200">
        {renderHeaderLevels(headerLevels, flatColumns)}
      </div>

      {/* Virtualized Body */}
      <div
        ref={parentRef}
        className="flex-1 overflow-auto"
        style={{ position: 'relative' }}
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative'
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = flatData[virtualRow.index];
            return (
              <div
                key={virtualRow.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`
                }}
              >
                <VirtualRow
                  row={row}
                  columns={flatColumns}
                  grouping={grouping}
                  expandedRows={expandedRows}
                  onToggle={onToggleRow}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Helper: Render header levels
function renderHeaderLevels(levels: ColumnDef[][], flatColumns: ColumnDef[]) {
  const treeCol = levels[0]?.find(c => c.meta?.isTreeColumn);
  const treeColumnSize = treeCol?.size || 0;

  return levels.map((level, levelIdx) => (
    <div key={levelIdx} className="flex border-b border-gray-200">
      {level.map((cell, idx) => {
        const isTreeColumn = cell.meta?.isTreeColumn;
        const isColumnGroup = cell.meta?.isColumnGroup;
        const isNumber = cell.meta?.isNumber;

        if (isTreeColumn && levelIdx === 0) {
          return (
            <div
              key={idx}
              className="px-3 py-2 font-medium bg-gray-50 border-r border-gray-200 sticky left-0 z-20"
              style={{ width: cell.size, minWidth: cell.size, maxWidth: cell.size }}
            >
              {cell.header}
            </div>
          );
        }

        if (!isTreeColumn) {
          return (
            <div
              key={idx}
              className={`px-3 py-2 font-medium bg-gray-50 border-r border-gray-200 ${
                isNumber ? 'text-right' : ''
              } ${isColumnGroup ? 'text-center' : ''}`}
              style={{ width: cell.size, minWidth: cell.size, maxWidth: cell.size }}
            >
              {cell.header}
            </div>
          );
        }

        return null;
      })}
    </div>
  ));
}

// Helper: Render single row
interface VirtualRowProps {
  row: any;
  columns: ColumnDef[];
  grouping: string[];
  expandedRows: Set<string>;
  onToggle: (key: string) => void;
}

function VirtualRow({ row, columns, grouping, expandedRows, onToggle }: VirtualRowProps) {
  const isGroup = row._isGroup;
  const depth = row._depth || 0;
  const isExpanded = expandedRows.has(row._groupKey);
  const hasChildren = row._children && row._children.length > 0;

  return (
    <div className={`flex border-b border-gray-100 hover:bg-blue-50 ${isGroup ? 'bg-gray-50' : ''}`}>
      {columns.map((col, idx) => {
        const isTreeColumn = col.meta?.isTreeColumn;
        const isNumber = col.meta?.isNumber;

        if (isTreeColumn) {
          const indent = depth * 12;
          
          if (isGroup) {
            return (
              <div
                key={idx}
                className="px-3 py-2 border-r border-gray-100 sticky left-0 bg-inherit z-10"
                style={{ width: col.size, minWidth: col.size, maxWidth: col.size }}
              >
                <div style={{ paddingLeft: indent }} className="flex items-center gap-2">
                  {hasChildren ? (
                    <button
                      onClick={() => onToggle(row._groupKey)}
                      className="w-5 h-5 flex items-center justify-center hover:bg-gray-200 rounded"
                    >
                      {isExpanded ? '▼' : '▶'}
                    </button>
                  ) : (
                    <span className="w-5"></span>
                  )}
                  <span className="font-medium">{row._groupValue}</span>
                </div>
              </div>
            );
          } else {
            const value = row[col.accessorKey || ''] || '';
            return (
              <div
                key={idx}
                className="px-3 py-2 border-r border-gray-100 sticky left-0 bg-inherit z-10"
                style={{ 
                  width: col.size, 
                  minWidth: col.size, 
                  maxWidth: col.size,
                  paddingLeft: indent + 32
                }}
              >
                {value}
              </div>
            );
          }
        } else {
          const value = row[col.accessorKey || ''];
          const formatted = isNumber && typeof value === 'number' 
            ? value.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : (value || '');

          return (
            <div
              key={idx}
              className={`px-3 py-2 border-r border-gray-100 ${isNumber ? 'text-right' : ''}`}
              style={{ width: col.size, minWidth: col.size, maxWidth: col.size }}
            >
              {formatted}
            </div>
          );
        }
      })}
    </div>
  );
}

// Helper functions
function flattenColumns(columns: ColumnDef[]): ColumnDef[] {
  const result: ColumnDef[] = [];
  function traverse(cols: ColumnDef[]) {
    cols.forEach(col => {
      if (col.columns && col.columns.length > 0) {
        traverse(col.columns);
      } else {
        result.push(col);
      }
    });
  }
  traverse(columns);
  return result;
}

function getHeaderLevels(columns: ColumnDef[]): ColumnDef[][] {
  const levels: ColumnDef[][] = [];
  function traverse(cols: ColumnDef[], level: number) {
    if (!levels[level]) levels[level] = [];
    cols.forEach(col => {
      if (col.columns && col.columns.length > 0) {
        levels[level].push(col);
        traverse(col.columns, level + 1);
      } else {
        levels[level].push(col);
      }
    });
  }
  traverse(columns, 0);
  return levels;
}
