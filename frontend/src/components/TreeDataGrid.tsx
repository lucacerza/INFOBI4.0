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
  previewMode?: boolean;  // Limit to 100 rows for preview
  /* STARTED NEW FEATURE: OrderBy/FilterBy */
  orderBy?: { field: string; direction: 'asc' | 'desc' }[];
  filters?: { field: string; type: string; value: any }[];
  /* END NEW FEATURE */
}

export default function TreeDataGrid({ reportId, rowGroups, valueCols, pivotCols = [], previewMode = false, orderBy = [], filters = [] }: TreeDataGridProps) {
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



  // --- API FETCH ---
  const PAGE_SIZE = previewMode ? 100 : 1000;
  
  const fetchNodeData = async (nodePath: string[], startRow = 0, endRow = PAGE_SIZE) => { 
    // In preview mode, block loading beyond first 100 rows total
    if (previewMode && startRow >= 100) {
      return [];
    }
    
    // In preview mode, cap endRow at 100
    if (previewMode && endRow > 100) {
      endRow = 100;
    }
    
    const tStart = performance.now();
    try {
        /* STARTED NEW FEATURE: OrderBy/FilterBy - Map props to API request */
        const sortModel = orderBy.map(o => ({ colId: o.field, sort: o.direction }));
        const filterModel: any = {};
        filters.forEach(f => {
            filterModel[f.field] = { filter: f.value, type: f.type };
        });
        /* END NEW FEATURE */

        const response = await reportsApi.executePivotDrill(reportId, {
            rowGroupCols: rowGroups,
            groupKeys: nodePath,
            valueCols: valueCols.map(v => ({ colId: v.field, aggFunc: v.aggregation })),
            pivotCols: pivotCols,
            filterModel: filterModel,
            sortModel: sortModel,
            startRow, 
            endRow
        });
        const tNet = performance.now();
        
        // Processing
        const { processedRows, headers } = processPivotData(response.rows);
        const tProc = performance.now();
        
        // Merge headers globally
        if (headers.length > 0) {
             setPivotHeaders(prev => Array.from(new Set([...prev, ...headers])).sort());
        }

        return processedRows;
    } catch (err) {
        console.error("Error fetching pivot data", err);
        return [];
    }
  };

  const onLoadMore = async (row: Row<any>) => {
      // row.original is the LoadMore placeholder
      const parentPath = row.original._parentPath;
      const currentCount = row.original._currentCount;
      const parentId = row.getParentRow()?.id;

      setLoadingNodes(prev => ({ ...prev, [row.id]: true }));
      
      const newChildren = await fetchNodeData(parentPath, currentCount, currentCount + PAGE_SIZE);
      
      const childrenProcessed = newChildren.map((r: any) => ({
             ...r,
             _path: [...parentPath, r.key_val],
             subRows: row.depth + 1 < rowGroups.length ? [] : undefined
      }));

      // If we got a full page, we might need another Load More button
      if (childrenProcessed.length === PAGE_SIZE) {
          childrenProcessed.push({
             key_val: 'LOAD_MORE',
             _isLoadMore: true,
             _parentPath: parentPath,
             _currentCount: currentCount + PAGE_SIZE
          });
      }

      setData(old => {
            const newData = [...old];
            
            // Helper to recursively find and update the list
            const updateList = (nodes: any[], depth: number): boolean => {
                 // Special case: Root level load more
                 if (parentPath.length === 0) {
                     // Find the load more node index
                     const idx = nodes.findIndex(n => n._isLoadMore && n._currentCount === currentCount);
                     if (idx !== -1) {
                         // Remove load more, add new items
                         nodes.splice(idx, 1, ...childrenProcessed);
                         return true;
                     }
                     return false;
                 }

                 for (const node of nodes) {
                     let match = false;
                     // Navigate down the path
                     if (depth < parentPath.length && node.key_val === parentPath[depth]) {
                         match = true;
                     }
                     
                     if (match) {
                         if (depth === parentPath.length - 1) {
                             // We found the parent node. Its subRows contain the Load More button.
                             if (node.subRows) {
                                 const idx = node.subRows.findIndex((n: any) => n._isLoadMore && n._currentCount === currentCount);
                                 if (idx !== -1) {
                                     node.subRows.splice(idx, 1, ...childrenProcessed);
                                     return true;
                                 }
                             }
                             return true;
                         } else if (node.subRows) {
                            if (updateList(node.subRows, depth + 1)) return true;
                         }
                     }
                 }
                 return false;
            };
            
            updateList(newData, 0);
            return newData;
      });

      setLoadingNodes(prev => ({ ...prev, [row.id]: false }));
  };



  // --- EXPAND HANDLER ---
  const onExpand = async (row: Row<any>) => {
     if (row.getIsExpanded()) return; 
     
     if (row.original.subRows && row.original.subRows.length === 0 && row.depth < rowGroups.length - 1) {
         setLoadingNodes(prev => ({ ...prev, [row.id]: true }));
         
         const path: string[] = row.original._path || [];
         const children = await fetchNodeData(path, 0, PAGE_SIZE);
         
         const childrenProcessed = children.map((r: any) => ({
             ...r,
             _path: [...path, r.key_val],
             subRows: row.depth + 2 < rowGroups.length ? [] : undefined
         }));

         if (childrenProcessed.length === PAGE_SIZE) {
             childrenProcessed.push({
                 key_val: 'LOAD_MORE',
                 _isLoadMore: true,
                 _parentPath: path,
                 _currentCount: PAGE_SIZE
             });
         }

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
                        accessorFn: (row: any) => row[`${metric.field}_${pivotKey}`],
                        header: metric.field,
                        cell: (info: any) => {
                             const val = info.getValue();
                             if (val === null || val === undefined) return '';
                             if (typeof val === 'number') return <div style={{ textAlign: 'right' }}>{val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>;
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
                const isLoadMore = row.original._isLoadMore;

                if (isLoadMore) {
                     return (
                         <div 
                             className="flex items-center gap-1"
                             style={{ paddingLeft: `${row.depth * 15}px` }}
                         >
                            <button
                               onClick={(e) => {
                                   e.stopPropagation();
                                   onLoadMore(row);
                               }}
                               disabled={isLoading}
                               className="text-blue-600 hover:text-blue-800 hover:underline font-semibold flex items-center gap-2"
                            >
                                {isLoading ? <Loader2 size={14} className="animate-spin"/> : null}
                                Load more...
                            </button>
                         </div>
                     )
                }
                
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
                     if (typeof val === 'number') return <div style={{ textAlign: 'right' }}>{val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>;
                     return String(val);
                },
                size: 150,
                minSize: 100
            });
        });
    }

    return cols;
  }, [rowGroups, valueCols, loadingNodes, pivotCols, pivotHeaders]);

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

  // --- AUTO RESIZE COLUMNS ---
  const autoResizeColumns = () => {
      // Use requestAnimationFrame to avoid blocking the main thread immediately
      requestAnimationFrame(() => {
          const t0 = performance.now();
          
          const newSizing: ColumnSizingState = {};
          const columns = table.getAllColumns();
          const activeRows = table.getRowModel().rows; // Get all active rows (flat list respecting expansion)
          
          // Use Canvas for high-performance text measurement
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          if (!context) return;

          // Estimate font - try to find ANY cell to measure font
          // Default fallback
          context.font = '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
          
          if (parentRef.current) {
               // Try to find a header or a cell
               const exampleElement = parentRef.current.querySelector('[data-column-id]') || parentRef.current.querySelector('[data-cell-column]');
               if (exampleElement) {
                   const computed = window.getComputedStyle(exampleElement);
                   if (computed.font && computed.font !== '') {
                       context.font = computed.font;
                   } else {
                       // Fallback construction
                       context.font = `500 12px ${computed.fontFamily || 'monospace'}`;
                   }
               }
          }
          
          let hasChanges = false;

          columns.forEach(col => {
              const columnId = col.id;
              let maxWidth = 80; // Minimum aesthetic width
              
              // 1. Measure Header
              let headerText = columnId;
              if (typeof col.columnDef.header === 'string') {
                  headerText = col.columnDef.header;
              }
              const headerMetrics = context.measureText(headerText);
              maxWidth = Math.max(maxWidth, headerMetrics.width + 32); 

              // 2. Measure Data (Sampling first 200 rows for speed)
              const sampleRows = activeRows.slice(0, 200);
              const hasGroupIndent = columnId === 'group';
              
              sampleRows.forEach(row => {
                  const value = row.getValue(columnId);
                  
                  // Handle indentation for Group column
                  let additionalWidth = 0;
                  if (hasGroupIndent) {
                      additionalWidth = (row.depth * 15) + 24; 
                  }

                  if (value !== null && value !== undefined) {
                      let text = String(value);
                      if (typeof value === 'number') {
                          text = value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                      }
                      const metrics = context.measureText(text);
                      maxWidth = Math.max(maxWidth, metrics.width + 24 + additionalWidth);
                  } else if (hasGroupIndent) {
                      maxWidth = Math.max(maxWidth, 24 + additionalWidth);
                  }
              });
              
              // Cap at maximum width
              const finWidth = Math.min(maxWidth, 800);
              newSizing[columnId] = finWidth;
          });
          
          setColumnSizing(newSizing);
      });
  };

  // --- INITIAL LOAD ---
  useEffect(() => {
    // Skip initial load if valueCols is empty (waiting for config to load)
    if (valueCols.length === 0) {
        setIsLoading(false);
        setData([]);
        return;
    }

    let cancelled = false; // Flag to prevent stale updates

    const init = async () => {
        setIsLoading(true);
        setData([]);
        setPivotHeaders([]);
        setColumnSizing({});
        setExpanded({}); // Reset expansion state when config changes

        let initialData = await fetchNodeData([], 0, PAGE_SIZE);

        // Check if this effect was superseded by a newer one
        if (cancelled) return;

        if (rowGroups.length > 0) {
            initialData = initialData.map((r: any) => ({
                ...r,
                _path: [r.key_val],
                subRows: rowGroups.length > 1 ? [] : undefined
            }));
        }

        // Add Load More if full page
        if (initialData.length === PAGE_SIZE) {
            initialData.push({
                key_val: 'LOAD_MORE',
                _isLoadMore: true,
                _parentPath: [],
                _currentCount: PAGE_SIZE
            });
        }

        setData(initialData);
        setIsLoading(false);
        autoResizeColumns();
    };
    init();

    // Cleanup: mark this effect as cancelled if dependencies change
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId, JSON.stringify(rowGroups), JSON.stringify(valueCols), JSON.stringify(pivotCols), JSON.stringify(orderBy), JSON.stringify(filters)]); 

  // Auto-resize when data changes or columns update
  useEffect(() => {
    if (data.length > 0 && !isLoading) {
        // Robust resize trigger
        const attemptResize = (attempt = 1) => {
            requestAnimationFrame(() => {
                const activeRows = table.getRowModel().rows;
                // If we have data but no active rows in the model yet, wait and retry
                if (data.length > 0 && activeRows.length === 0 && attempt < 10) {
                    setTimeout(() => attemptResize(attempt + 1), 100);
                    return;
                }
                autoResizeColumns();
            });
        };

        const timer = setTimeout(() => {
             attemptResize();
        }, 50);
        
        return () => clearTimeout(timer);
    }
  }, [data, isLoading, columns]); // removed table from deps to avoid loop if table ref causes issues, columns update should suffice

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
                    className="sticky top-0 z-30 bg-gray-50 shadow-sm flex flex-col text-gray-700 font-bold select-none"
                    style={{ height: `${TOTAL_HEADER_HEIGHT}px`, width: '100%', minWidth: 'fit-content' }}
                 >
                        {headerGroups.map((headerGroup, groupIndex) => (
                            <div key={headerGroup.id} className="flex" style={{ height: HEADER_ROW_HEIGHT }}>
                                {headerGroup.headers.map((header) => {
                                     // Uniform styling for all headers as requested
                                     const borderClass = "border-r border-b border-gray-300 bg-gray-50";
                                     
                                     // Sticky group column logic
                                     const isGroupCol = header.column.id === 'group';
                                     const stickyStyle = (rowGroups.length > 0 && isGroupCol) 
                                         ? { position: 'sticky' as const, left: 0, zIndex: 40 } 
                                         : {};

                                     // User Request: Remove horizontal separator (border-b) but keep vertical (border-r) for Group Column
                                     const cellBorderClass = isGroupCol 
                                        ? "border-r border-gray-300 bg-gray-50" // kept vertical, removed horizontal (border-b)
                                        : "border-r border-b border-gray-300 bg-gray-50";

                                     return (
                                    <div 
                                       key={header.id} 
                                       data-column-id={header.column.id}
                                       className={`px-2 relative group flex items-center justify-center ${cellBorderClass}`}
                                       style={{ width: header.getSize(), ...stickyStyle }}
                                    >
                                        <span className="truncate flex-1 text-center" title={header.column.columnDef.header as string}>
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
                                    );
                                })}
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
                            className={`flex border-b border-gray-100 absolute left-0 ${row.getIsExpanded() ? 'bg-gray-50' : 'bg-white'} hover:bg-blue-50 w-full font-medium`}
                            style={{
                                height: `${virtualRow.size}px`,
                                transform: `translateY(${virtualRow.start + TOTAL_HEADER_HEIGHT}px)`, 
                                top: 0, 
                            }}
                        >
                            {row.getVisibleCells().map(cell => {
                                const val = cell.getValue();
                                const isNumber = typeof val === 'number';
                                
                                // Sticky body cell logic
                                const isGroupCol = cell.column.id === 'group';
                                const stickyStyle = (rowGroups.length > 0 && isGroupCol)
                                    ? { position: 'sticky' as const, left: 0, zIndex: 20, backgroundColor: row.getIsExpanded() ? '#f9fafb' : '#ffffff' }
                                    : {};

                                return (
                                <div 
                                    key={cell.id}
                                    data-cell-column={cell.column.id}
                                    className={`px-2 border-r border-gray-200 flex items-center text-gray-700 ${isNumber ? 'justify-end' : 'justify-start'}`}
                                    style={{ width: cell.column.getSize(), overflow: 'hidden', whiteSpace: 'nowrap', ...stickyStyle }}
                                >
                                    <div className="truncate w-full">
                                    {cell.getIsPlaceholder() ? null : flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </div>
                                </div>
                                );
                            })}
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
