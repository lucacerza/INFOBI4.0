import { useState, useMemo, useEffect, useRef } from 'react';
import { 
  useReactTable, 
  getCoreRowModel, 
  getExpandedRowModel, 
  ColumnDef, 
  ExpandedState,
  Row,
  flexRender,
  ColumnResizeMode,
  ColumnSizingState
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronRight, ChevronDown, Loader2 } from 'lucide-react';
import { reportsApi } from '../services/api';

interface TreeDataGridProps {
  reportId: number;
  rowGroups: string[];
  valueCols: any[];
  pivotCols?: string[];
}

export default function TreeDataGrid({ reportId, rowGroups, valueCols, pivotCols = [] }: TreeDataGridProps) {
  // --- STATE ---
  const [data, setData] = useState<any[]>([]); 
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [loadingNodes, setLoadingNodes] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null);
  
  // Track unique values for pivot headers (e.g. Years: 2022, 2023)
  const [pivotHeaders, setPivotHeaders] = useState<string[]>([]);
  // Removed separate colSizes state in favor of columnSizing

  // --- DATA PROCESSING ---
  const processPivotData = (rows: any[]) => {
      // No pivoting if no pivot columns
      if (pivotCols.length === 0) {
          return { processedRows: rows, headers: [] };
      }

      // Case 1: SPLIT BY without GROUP BY (Flat table with hierarchical headers)
      if (rowGroups.length === 0) {
          // Extract unique pivot combinations for headers
          const pivotHeadersSet = new Set<string>();
          
          // Map rows to include pivoted fields: { Year: 2022, Sales: 100 } -> { ..., Sales_2022: 100 }
          const processed = rows.map(row => {
              const pivotKeyParts = pivotCols.map(p => row[p] || 'null');
              const pivotKey = pivotKeyParts.join(' - ');
              if (pivotKey) pivotHeadersSet.add(pivotKey);
              
              const newRow = { ...row };
              if (pivotKey) {
                  valueCols.forEach(vc => {
                      // Map the value to the specific pivot column
                      newRow[`${vc.field}_${pivotKey}`] = row[vc.field];
                  });
              }
              return newRow;
          });
          
          return { 
              processedRows: processed, 
              headers: Array.from(pivotHeadersSet).sort() 
          };
      }

      // Case 2: GROUP BY + SPLIT BY (Aggregated pivot table)
      const groupedMap = new Map<string, any>();
      const newPivotHeaders = new Set<string>();

      rows.forEach(row => {
          const key = row.key_val;
          
          // Initialize group if not exists
          if (!groupedMap.has(key)) {
              groupedMap.set(key, { 
                  key_val: key,
                  subRows: rowGroups.length > 1 ? [] : undefined,
                  _aggregated: {} // Track which fields have been aggregated
              });
          }
          const groupItem = groupedMap.get(key);
          
          // Generate Pivot Key from pivot columns
          const pivotKeyParts = pivotCols.map(p => row[p] || 'null');
          const pivotKey = pivotKeyParts.join(' - ');
          
          if (pivotKey) {
             newPivotHeaders.add(pivotKey);
             
             // Assign Metrics to this Pivot Key
             valueCols.forEach(vc => {
                 const newField = `${vc.field}_${pivotKey}`;
                 const value = row[vc.field];
                 
                 // If this field already exists, aggregate (sum)
                 if (groupItem[newField] !== undefined && typeof value === 'number') {
                     groupItem[newField] = (groupItem[newField] || 0) + value;
                 } else {
                     groupItem[newField] = value;
                 }
             });
          }
      });
      
      return { 
          processedRows: Array.from(groupedMap.values()), 
          headers: Array.from(newPivotHeaders).sort() 
      };
  };

  // --- AUTO RESIZE COLUMNS ---
  const autoResizeColumns = () => {
      if (!parentRef.current) return;
      
      const newSizing: ColumnSizingState = {};
      const columns = table.getAllColumns();
      
      columns.forEach(col => {
          const columnId = col.id;
          let maxWidth = 100; // Minimum width
          
          // Measure header
          const headerElement = parentRef.current?.querySelector(
              `[data-column-id="${columnId}"]`
          ) as HTMLElement;
          
          if (headerElement) {
              const headerText = headerElement.textContent || '';
              // Create temporary span to measure text width
              const tempSpan = document.createElement('span');
              tempSpan.style.visibility = 'hidden';
              tempSpan.style.position = 'absolute';
              tempSpan.style.whiteSpace = 'nowrap';
              tempSpan.style.font = window.getComputedStyle(headerElement).font;
              tempSpan.textContent = headerText;
              document.body.appendChild(tempSpan);
              const headerWidth = tempSpan.offsetWidth + 40; // Add padding
              document.body.removeChild(tempSpan);
              maxWidth = Math.max(maxWidth, headerWidth);
          }
          
          // Measure visible cells
          const cells = parentRef.current?.querySelectorAll(
              `[data-cell-column="${columnId}"]`
          );
          
          if (cells) {
              cells.forEach(cell => {
                  const cellElement = cell as HTMLElement;
                  const cellText = cellElement.textContent || '';
                  
                  // Create temporary span to measure text width
                  const tempSpan = document.createElement('span');
                  tempSpan.style.visibility = 'hidden';
                  tempSpan.style.position = 'absolute';
                  tempSpan.style.whiteSpace = 'nowrap';
                  tempSpan.style.font = window.getComputedStyle(cellElement).font;
                  tempSpan.textContent = cellText;
                  document.body.appendChild(tempSpan);
                  const cellWidth = tempSpan.offsetWidth + 24; // Add padding
                  document.body.removeChild(tempSpan);
                  
                  maxWidth = Math.max(maxWidth, cellWidth);
              });
          }
          
          // Cap at maximum width
          newSizing[columnId] = Math.min(maxWidth, 600);
      });
      
      setColumnSizing(newSizing);
  };

  // --- API FETCH ---
  const fetchNodeData = async (nodePath: string[], startRow = 0, endRow = 1000) => { // Increased chunk size to 1000
    try {
        const response = await reportsApi.executePivotDrill(reportId, {
            rowGroupCols: rowGroups,
            groupKeys: nodePath,
            valueCols: valueCols.map(v => ({ colId: v.field, aggFunc: v.aggregation })),
            pivotCols: pivotCols,
            filterModel: {},
            startRow, 
            endRow
        });
        
        const { processedRows, headers } = processPivotData(response.rows);
        
        // Merge headers globally to ensure we don't lose them on pagination
        if (headers.length > 0) {
             setPivotHeaders(prev => Array.from(new Set([...prev, ...headers])).sort());
        }

        return processedRows;
    } catch (err) {
        console.error("Error fetching pivot data", err);
        return [];
    }
  };

  // --- INITIAL LOAD ---
  useEffect(() => {
    const init = async () => {
        setIsLoading(true);
        setData([]); 
        setPivotHeaders([]); // Reset pivot headers
        setColumnSizing({});     // Reset sizes
        
        // Initial fetch - Load larger chunk for immediate fill
        let initialData = await fetchNodeData([], 0, 1000);
        
        if (rowGroups.length > 0) {
            initialData = initialData.map((r: any) => ({
                ...r,
                _path: [r.key_val],
                subRows: rowGroups.length > 1 ? [] : undefined 
            }));
        }

        setData(initialData);
        setIsLoading(false);
        
        // Trigger auto-resize after render
        autoResizeColumns();
    };
    init();
  }, [reportId, rowGroups, valueCols, pivotCols]); 

  // Auto-resize when data changes
  useEffect(() => {
    if (data.length > 0 && !isLoading) {
        autoResizeColumns();
    }
  }, [data, isLoading]);

  // --- EXPAND HANDLER ---
  const onExpand = async (row: Row<any>) => {
     if (row.getIsExpanded()) return; 
     
     if (row.original.subRows && row.original.subRows.length === 0 && row.depth < rowGroups.length - 1) {
         setLoadingNodes(prev => ({ ...prev, [row.id]: true }));
         
         const path: string[] = row.original._path || [];
         const children = await fetchNodeData(path);
         
         const childrenProcessed = children.map((r: any) => ({
             ...r,
             _path: [...path, r.key_val],
             subRows: row.depth + 2 < rowGroups.length ? [] : undefined
         }));

         setData(old => {
             const newData = [...old];
             const updateNode = (nodes: any[], depth: number): boolean => {
                 for (const node of nodes) {
                     let match = false;
                     if (depth < path.length && node.key_val === path[depth]) {
                         match = true;
                     }
                     if (match) {
                         if (depth === path.length - 1) {
                             node.subRows = childrenProcessed;
                             return true;
                         } else if (node.subRows) {
                            if (updateNode(node.subRows, depth + 1)) return true;
                         }
                     }
                 }
                 return false;
             };
             
             updateNode(newData, 0);
             return newData;
         });

         setLoadingNodes(prev => ({ ...prev, [row.id]: false }));
     }
  };


  // --- COLUMNS ---
  const columns = useMemo<ColumnDef<any>[]>(() => {
    const cols: ColumnDef<any>[] = [];

    // Helper to build nested pivot columns
    const buildPivotColumns = (headers: string[], currentDepth: number, prefix: string[]): ColumnDef<any>[] => {
        // Collect unique keys at this depth based on the prefix
        // Headers are like "2023 - A", "2023 - B", "2024 - A"
        // If prefix is [], we look for unique first parts: "2023", "2024"
        // If prefix is ["2023"], we look for unique second parts: "A", "B"
        
        const uniqueKeys = new Set<string>();
        const relevantHeaders = headers.filter(h => {
             const parts = h.split(' - ');
             if (parts.length <= currentDepth) return false;
             // Check if header matches prefix
             for (let i = 0; i < prefix.length; i++) {
                 if (parts[i] !== prefix[i]) return false;
             }
             return true;
        });

        relevantHeaders.forEach(h => {
            const parts = h.split(' - ');
            uniqueKeys.add(parts[currentDepth]);
        });

        return Array.from(uniqueKeys).sort().map(key => {
            const newPath = [...prefix, key];
            const isLeaf = currentDepth === pivotCols.length - 1;

            if (isLeaf) {
                const pivotKey = newPath.join(' - ');
                return {
                    header: key,
                    id: `group_${pivotKey}`,
                    columns: valueCols.map(metric => ({
                        id: `${metric.field}_${pivotKey}`,
                        accessorKey: `${metric.field}_${pivotKey}`,
                        header: metric.field,
                        cell: (info: any) => {
                             const val = info.getValue();
                             if (val === null || val === undefined) return '';
                             if (typeof val === 'number') return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
                             return String(val);
                        },
                        size: 120,
                        minSize: 80
                    }))
                };
            } else {
                return {
                    header: key,
                    id: `group_${newPath.join('_')}`,
                    columns: buildPivotColumns(headers, currentDepth + 1, newPath)
                };
            }
        });
    };

    // 1. Group Column
    if (rowGroups.length > 0) {
        cols.push({
            id: 'group',
            header: rowGroups.join(" > "),
            accessorFn: row => row.key_val,
            cell: ({ row, getValue }) => {
                const isLoading = loadingNodes[row.id];
                const canExpand = row.getCanExpand();
                
                return (
                    <div 
                        className="flex items-center gap-1"
                        style={{ paddingLeft: `${row.depth * 15}px`, whiteSpace: 'nowrap' }}
                    >
                        {canExpand ? (
                            <button 
                                onClick={async (e) => {
                                    e.stopPropagation();
                                    const wasExpanded = row.getIsExpanded();
                                    if (!wasExpanded) await onExpand(row);
                                    row.toggleExpanded();
                                }}
                                className="p-0.5 hover:bg-gray-200 rounded"
                            >
                                {isLoading ? (
                                    <Loader2 size={12} className="animate-spin text-blue-500"/>
                                ) : row.getIsExpanded() ? (
                                    <ChevronDown size={12} />
                                ) : (
                                    <ChevronRight size={12} />
                                )}
                            </button>
                        ) : <span className="w-3 h-3 mr-0.5" />}
                        
                        <span className="font-mono text-gray-800" title={getValue() as string}>
                            {getValue() as string}
                        </span>
                    </div>
                );
            },
            size: 250, // Group column usually doesn't need auto-size from content, but can try
            minSize: 100,
        });
    }

    // 2. Pivot Columns (When SPLIT BY is used without GROUP BY - flat table)
    // Show pivot columns as simple columns only if headers haven't been extracted yet
    if (rowGroups.length === 0 && pivotCols.length > 0 && pivotHeaders.length === 0) {
         pivotCols.forEach(p => {
             cols.push({
                 id: p,
                 accessorKey: p, 
                 header: p,
                 size: 150,
                 minSize: 100
             });
         });
    }

    // 3. Metric Columns with Hierarchical Headers
    if (pivotHeaders.length > 0 && pivotCols.length > 0) {
        // Create Hierarchical Header Groups for both Flat and Grouped modes
        // using the recursive builder
        const pivotColumns = buildPivotColumns(pivotHeaders, 0, []);
        cols.push(...pivotColumns);
    } else if (pivotHeaders.length === 0) {
        // Standard Columns (No pivot or pivot not processed yet)
        valueCols.forEach(metric => {
            cols.push({
                id: metric.field,
                accessorKey: metric.field,
                header: metric.field,
                cell: (info: any) => {
                     const val = info.getValue();
                     if (val === null || val === undefined) return '';
                     if (typeof val === 'number') return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
                     return String(val);
                },
                size: 150,
                minSize: 100
            });
        });
    }

    return cols;
  }, [rowGroups, valueCols, loadingNodes, pivotCols, pivotHeaders, columnSizing]);

  // Optimize row id generation for stability
  const getRowId = (row: any, relativeIndex: number, parent?: Row<any>) => {
      // In Tree Mode, use the key_val path. In Flat Mode, use index or a unique ID if available.
      // Using index for flat mode is safe if we append.
      if (rowGroups.length > 0) return row.key_val; 
      // If we have a primary key, use it. Otherwise, relativeIndex is unstable if we prepend.
      // But we only append. So relativeIndex + offset?
      // Actually TanStack table handles index fine.
      return parent ? `${parent.id}.${relativeIndex}` : `${relativeIndex}`;
  };

  const table = useReactTable({
    data,
    columns,
    columnResizeMode: 'onChange',
    state: { expanded, columnSizing },
    onExpandedChange: setExpanded,
    onColumnSizingChange: setColumnSizing,
    getSubRows: row => row.subRows,
    getRowCanExpand: row => row.original.subRows !== undefined,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    // getRowId, // Optional, default is index
    autoResetExpanded: false,
    defaultColumn: {
        minSize: 50,
        size: 150, // Default width for unconfigured columns
        maxSize: 600,
    }
  });

  const { rows } = table.getRowModel();

  // --- VIRTUALIZATION ---
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 24, 
    overscan: 10, // Optimized for performance (was 25, then 10, stick with 10)
  });
  
  // --- INFINITE SCROLL (FLAT) ---
  useEffect(() => {
     if (rowGroups.length === 0 && !isLoading && !isFetchingMore) {
         const lastItem = rowVirtualizer.getVirtualItems().slice(-1)[0];
         
         if (!lastItem) return;

         if (lastItem.index >= data.length - 1) {
             const loadMore = async () => {
                 setIsFetchingMore(true);
                 const nextRows = await fetchNodeData([], data.length, data.length + 100);
                 if (nextRows.length > 0) {
                     setData(prev => [...prev, ...nextRows]);
                 }
                 setIsFetchingMore(false);
             };
             loadMore();
         }
     }
  }, [rowVirtualizer.getVirtualItems(), rowGroups, data.length, isLoading, isFetchingMore]);


  // --- EMPTY STATE ---
  if (rowGroups.length === 0 && valueCols.length === 0 && pivotCols.length === 0) {
      return (
          <div className="flex h-full items-center justify-center text-xs text-gray-400 bg-gray-50 border border-dashed m-1 rounded font-mono">
              Configure rows and values...
          </div>
      );
  }

  const headerGroups = table.getHeaderGroups();
  const HEADER_ROW_HEIGHT = 28; 
  const TOTAL_HEADER_HEIGHT = headerGroups.length * HEADER_ROW_HEIGHT;

  return (
    <div className="h-full w-full bg-white relative font-mono text-xs overflow-hidden flex flex-col">
         {/* Single Scroll Container with Sticky Header support */}
         <div 
            ref={parentRef} 
            className="flex-1 w-full overflow-auto relative" 
            style={{ contain: 'strict' }} // CSS Performance Hint
         >
             <div 
                 style={{ 
                    width: table.getTotalSize(), 
                    minWidth: '100%',
                    height: `${rowVirtualizer.getTotalSize() + TOTAL_HEADER_HEIGHT}px`,
                    position: 'relative'
                 }}
             >
                 {/* STICKY HEADER */}
                 <div 
                    className="sticky top-0 z-10 bg-gray-50 border-b shadow-sm flex flex-col text-gray-700 font-bold select-none"
                    style={{ height: `${TOTAL_HEADER_HEIGHT}px`, width: '100%', minWidth: 'fit-content' }}
                 >
                        {headerGroups.map(headerGroup => (
                            <div key={headerGroup.id} className="flex" style={{ height: HEADER_ROW_HEIGHT }}>
                                {headerGroup.headers.map(header => (
                                    <div 
                                       key={header.id} 
                                       data-column-id={header.column.id}
                                       className="px-2 border-r border-gray-300 relative group flex items-center justify-between"
                                       style={{ width: header.getSize() }}
                                    >
                                        <span className="truncate flex-1" title={header.column.columnDef.header as string}>
                                            {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                                        </span>
                                        {/* Resize Handle only on bottom row leaf headers usually, but here on all for width control */}
                                        <div
                                            onMouseDown={header.getResizeHandler()}
                                            onTouchStart={header.getResizeHandler()}
                                            className={`absolute right-0 top-0 h-full w-1 cursor-col-resize touch-none hover:bg-blue-400 opacity-0 group-hover:opacity-100 ${
                                                header.column.getIsResizing() ? 'bg-blue-500 opacity-100' : ''
                                            }`}
                                        />
                                    </div>
                                ))}
                            </div>
                        ))}
                 </div>

                 {/* LOADING OVERLAY */}
                 {isLoading && (
                     <div className="absolute inset-0 flex items-center justify-center bg-white/60 z-20 h-40 mt-8">
                         <Loader2 className="animate-spin text-blue-500" size={24} />
                     </div>
                 )}

                 {/* VIRTUAL ROWS */}
                 {!isLoading && rowVirtualizer.getVirtualItems().map(virtualRow => {
                    const row = rows[virtualRow.index];
                    return (
                        <div
                            key={row.id}
                            className={`flex border-b border-gray-100 absolute left-0 ${row.getIsExpanded() ? 'bg-gray-50' : 'bg-white'} hover:bg-blue-50 w-full`}
                            style={{
                                height: `${virtualRow.size}px`,
                                transform: `translateY(${virtualRow.start + TOTAL_HEADER_HEIGHT}px)`, 
                                top: 0, 
                            }}
                        >
                            {row.getVisibleCells().map(cell => (
                                <div 
                                    key={cell.id}
                                    data-cell-column={cell.column.id}
                                    className="px-2 border-r border-gray-100 flex items-center text-gray-600"
                                    style={{ width: cell.column.getSize(), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                >
                                    {cell.getIsPlaceholder() ? null : flexRender(cell.column.columnDef.cell, cell.getContext())}
                                </div>
                            ))}
                        </div>
                    );
                 })}
             </div>
         </div>

         
         {/* Footer Status */}
         <div className="border-t bg-gray-50 p-1 px-2 text-[10px] text-gray-500 flex justify-between shrink-0">
            <span>{rows.length} rows loaded {isFetchingMore && '...'}</span>
            <span>{valueCols.map(c => c.field).join(', ')}</span>
         </div>
    </div>
  );
}
