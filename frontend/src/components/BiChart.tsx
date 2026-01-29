/**
 * BiChart Component - ECharts integration for INFOBI 4.0
 *
 * Uses the same pivot API as TreeDataGrid/BiGrid but renders as charts.
 * Supports: bar, line, pie, area, KPI card
 */
import { useEffect, useState, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';
import { Loader2, BarChart3, LineChart, PieChart, TrendingUp } from 'lucide-react';
import { reportsApi } from '../services/api';
import { logger } from '../utils/logger';

export type ChartType = 'bar' | 'line' | 'pie' | 'area' | 'kpi' | 'horizontal-bar';

interface MetricConfig {
  id: string;
  name: string;
  field: string;
  aggregation: 'SUM' | 'AVG' | 'COUNT' | 'MIN' | 'MAX';
}

interface BiChartProps {
  reportId: number;
  chartType: ChartType;
  groupBy: string[];           // Category axis (X or labels)
  metrics: MetricConfig[];     // Values to show
  splitBy?: string[];          // For stacked/grouped charts
  filters?: Record<string, any>;
  title?: string;
  height?: number | string;
  showLegend?: boolean;
  colorPalette?: string[];
  topN?: number;               // Limit items (default: 50)
  showDataZoom?: boolean;      // Enable scroll/zoom on axis (default: true for bar/line)
  onDrillDown?: (category: string, value: number, seriesName: string) => void; // Click handler for drill-down
}

// Default color palette (matching INFOBI style)
const DEFAULT_COLORS = [
  '#3b82f6', // blue-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#8b5cf6', // violet-500
  '#06b6d4', // cyan-500
  '#f97316', // orange-500
  '#ec4899', // pink-500
];

export default function BiChart({
  reportId,
  chartType,
  groupBy,
  metrics,
  splitBy = [],
  filters = {},
  title,
  height = 400,
  showLegend = true,
  colorPalette = DEFAULT_COLORS,
  topN,
  showDataZoom,
  onDrillDown
}: BiChartProps) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Default dataZoom for bar/line charts with many items (Power BI style scrolling)
  const effectiveDataZoom = showDataZoom ?? (chartType === 'bar' || chartType === 'line' || chartType === 'horizontal-bar' || chartType === 'area');

  // Load data from pivot API
  useEffect(() => {
    loadData();
  }, [reportId, JSON.stringify(groupBy), JSON.stringify(metrics), JSON.stringify(splitBy), JSON.stringify(filters)]);

  const loadData = async () => {
    if (!reportId || metrics.length === 0) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // For charts, only use the FIRST groupBy level for readability
      const chartGroupBy = groupBy.length > 0 ? [groupBy[0]] : [];

      // Use the same API as TreeDataGrid (pivot-drill) for consistent aggregation
      const response = await reportsApi.executePivotDrill(reportId, {
        rowGroupCols: chartGroupBy,
        groupKeys: [], // Top level, no parent keys
        pivotCols: splitBy,
        valueCols: metrics.map(m => ({
          colId: m.field,
          aggFunc: m.aggregation.toLowerCase()
        })),
        filterModel: filters || {},
        sortModel: [],
        startRow: 0,
        endRow: topN || 50
      });

      // Response is JSON with { rows, count }
      const rows = response.rows || [];

      // Debug: log first row
      if (rows.length > 0) {
        logger.debug('BiChart first row:', rows[0]);
      }

      setData(rows);
    } catch (err: any) {
      console.error('BiChart load error:', err);
      setError(err.message || 'Errore caricamento dati');
    } finally {
      setLoading(false);
    }
  };

  // Build ECharts options based on chart type
  const chartOptions = useMemo(() => {
    if (data.length === 0 || metrics.length === 0) return null;

    // Determine the category field - try multiple options
    // Backend returns 'key_val' for grouped queries
    let categoryField = 'key_val';
    if (!data[0]?.key_val && data[0]?.key_val !== 0) {
      // Fallback: try groupBy field name, then first string field
      if (groupBy.length > 0 && data[0]?.[groupBy[0]] !== undefined) {
        categoryField = groupBy[0];
      } else {
        // Find first non-numeric field
        const firstKey = Object.keys(data[0]).find(k =>
          typeof data[0][k] === 'string' || k.includes('key') || k.includes('name')
        ) || Object.keys(data[0])[0];
        categoryField = firstKey;
      }
    }

    const categories = data.map(row => {
      const val = row[categoryField];
      if (val === null || val === undefined || val === '') return 'N/A';
      return String(val);
    });

    logger.debug('BiChart categories:', categoryField, categories);

    // Format large numbers - Italian style (Mld for miliardi, Mln for milioni)
    const formatNumber = (value: number): string => {
      if (Math.abs(value) >= 1e9) return (value / 1e9).toFixed(1) + ' Mld';
      if (Math.abs(value) >= 1e6) return (value / 1e6).toFixed(1) + ' Mln';
      if (Math.abs(value) >= 1e3) return (value / 1e3).toFixed(0) + ' K';
      return value.toLocaleString('it-IT');
    };

    // Truncate long labels
    const truncateLabel = (label: string, maxLen: number = 10): string => {
      if (!label || label.length <= maxLen) return label;
      return label.substring(0, maxLen - 1) + '…';
    };

    // Truncated categories for axis (full names in tooltip)
    const truncatedCategories = categories.map(c => truncateLabel(c));

    // Common options
    const baseOptions: echarts.EChartsOption = {
      color: colorPalette,
      tooltip: {
        trigger: chartType === 'pie' ? 'item' : 'axis',
        axisPointer: { type: 'shadow' },
        formatter: chartType === 'pie' ? undefined : (params: any) => {
          if (!Array.isArray(params)) params = [params];
          // Get full category name (not truncated)
          const dataIndex = params[0]?.dataIndex ?? 0;
          const fullName = categories[dataIndex] || params[0]?.axisValue || '';
          let result = `<strong>${fullName}</strong><br/>`;
          params.forEach((p: any) => {
            const val = typeof p.value === 'number' ? p.value.toLocaleString('it-IT', { maximumFractionDigits: 2 }) : p.value;
            result += `${p.marker} ${p.seriesName}: <strong>€ ${val}</strong><br/>`;
          });
          return result;
        }
      },
      legend: showLegend ? {
        bottom: 0,
        type: 'scroll'
      } : undefined,
      grid: {
        left: '3%',
        right: '4%',
        bottom: showLegend ? '15%' : '3%',
        top: title ? '15%' : '10%',
        containLabel: true
      }
    };

    // Add title if provided
    if (title) {
      baseOptions.title = {
        text: title,
        left: 'center',
        textStyle: { fontSize: 14, fontWeight: 500 }
      };
    }

    // DataZoom config for scrollable charts (Power BI style)
    const dataZoomConfig = effectiveDataZoom && data.length > 8 ? [
      {
        type: 'slider',
        show: true,
        start: 0,
        end: Math.min(100, (8 / data.length) * 100), // Show ~8 items initially
        height: 20,
        bottom: showLegend ? 35 : 5,
        borderColor: 'transparent',
        backgroundColor: '#f1f5f9',
        fillerColor: 'rgba(59, 130, 246, 0.2)',
        handleStyle: { color: '#3b82f6' }
      },
      {
        type: 'inside', // Enable scroll with mouse wheel
        start: 0,
        end: Math.min(100, (8 / data.length) * 100)
      }
    ] : undefined;

    switch (chartType) {
      case 'bar':
      case 'horizontal-bar':
        const barGridBottom = effectiveDataZoom && data.length > 8 ? (showLegend ? '20%' : '15%') : (showLegend ? '15%' : '3%');
        return {
          ...baseOptions,
          grid: {
            left: '3%',
            right: '4%',
            bottom: barGridBottom,
            top: title ? '15%' : '10%',
            containLabel: true
          },
          dataZoom: chartType === 'bar' ? dataZoomConfig : undefined,
          xAxis: chartType === 'horizontal-bar' ? {
            type: 'value'
          } : {
            type: 'category',
            data: truncatedCategories,
            axisLabel: {
              rotate: categories.length > 5 ? 30 : 0,
              interval: 0,
              fontSize: 11
            }
          },
          yAxis: chartType === 'horizontal-bar' ? {
            type: 'category',
            data: truncatedCategories
          } : {
            type: 'value',
            axisLabel: {
              formatter: (value: number) => formatNumber(value)
            }
          },
          series: metrics.map(metric => ({
            name: metric.name,
            type: 'bar',
            data: data.map(row => {
              const val = row[metric.field] ?? row[`${metric.aggregation}(${metric.field})`] ?? 0;
              return typeof val === 'bigint' ? Number(val) : val;
            }),
            emphasis: { focus: 'series' }
          }))
        };

      case 'line':
      case 'area':
        const lineGridBottom = effectiveDataZoom && data.length > 8 ? (showLegend ? '20%' : '15%') : (showLegend ? '15%' : '3%');
        return {
          ...baseOptions,
          grid: {
            left: '3%',
            right: '4%',
            bottom: lineGridBottom,
            top: title ? '15%' : '10%',
            containLabel: true
          },
          dataZoom: dataZoomConfig,
          xAxis: {
            type: 'category',
            data: truncatedCategories,
            boundaryGap: false,
            axisLabel: {
              rotate: categories.length > 5 ? 30 : 0,
              fontSize: 11
            }
          },
          yAxis: {
            type: 'value',
            axisLabel: {
              formatter: (value: number) => formatNumber(value)
            }
          },
          series: metrics.map(metric => ({
            name: metric.name,
            type: 'line',
            smooth: true,
            areaStyle: chartType === 'area' ? { opacity: 0.3 } : undefined,
            data: data.map(row => {
              const val = row[metric.field] ?? row[`${metric.aggregation}(${metric.field})`] ?? 0;
              return typeof val === 'bigint' ? Number(val) : val;
            }),
            emphasis: { focus: 'series' }
          }))
        };

      case 'pie':
        // For pie, use first metric only
        const pieMetric = metrics[0];
        return {
          ...baseOptions,
          grid: undefined,
          series: [{
            type: 'pie',
            radius: ['40%', '70%'],
            center: ['50%', '50%'],
            avoidLabelOverlap: true,
            itemStyle: {
              borderRadius: 4,
              borderColor: '#fff',
              borderWidth: 2
            },
            label: {
              show: true,
              formatter: '{b}: {d}%'
            },
            emphasis: {
              label: { show: true, fontWeight: 'bold' }
            },
            data: data.map((row, idx) => {
              const val = row[pieMetric.field] ?? row[`${pieMetric.aggregation}(${pieMetric.field})`] ?? 0;
              return {
                name: row[categoryField] || `Item ${idx}`,
                value: typeof val === 'bigint' ? Number(val) : val
              };
            })
          }]
        };

      case 'kpi':
        // KPI card - show single aggregated value
        const kpiMetric = metrics[0];
        const totalValue = data.reduce((sum, row) => {
          const val = row[kpiMetric.field] ?? row[`${kpiMetric.aggregation}(${kpiMetric.field})`] ?? 0;
          return sum + (typeof val === 'bigint' ? Number(val) : val);
        }, 0);

        return {
          series: [{
            type: 'gauge',
            startAngle: 180,
            endAngle: 0,
            min: 0,
            max: totalValue * 1.2,
            progress: { show: true, width: 18 },
            pointer: { show: false },
            axisLine: {
              lineStyle: { width: 18 }
            },
            axisTick: { show: false },
            splitLine: { show: false },
            axisLabel: { show: false },
            detail: {
              valueAnimation: true,
              formatter: (value: number) => formatNumber(value),
              fontSize: 28,
              fontWeight: 'bold',
              offsetCenter: [0, '-20%']
            },
            title: {
              offsetCenter: [0, '20%'],
              fontSize: 14
            },
            data: [{
              value: totalValue,
              name: kpiMetric.name
            }]
          }]
        };

      default:
        return baseOptions;
    }
  }, [data, chartType, groupBy, metrics, title, showLegend, colorPalette, effectiveDataZoom]);

  // Loading state
  if (loading) {
    return (
      <div
        className="flex items-center justify-center bg-white rounded-lg border"
        style={{ height }}
      >
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div
        className="flex items-center justify-center bg-white rounded-lg border text-red-500"
        style={{ height }}
      >
        <p>{error}</p>
      </div>
    );
  }

  // Empty state
  if (!chartOptions || data.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center bg-white rounded-lg border text-slate-400"
        style={{ height }}
      >
        <BarChart3 className="w-12 h-12 mb-2 opacity-50" />
        <p>Nessun dato disponibile</p>
      </div>
    );
  }

  // KPI special rendering
  if (chartType === 'kpi' && metrics.length > 0) {
    const kpiMetric = metrics[0];
    const totalValue = data.reduce((sum, row) => {
      const val = row[kpiMetric.field] ?? row[`${kpiMetric.aggregation}(${kpiMetric.field})`] ?? 0;
      return sum + (typeof val === 'bigint' ? Number(val) : val);
    }, 0);

    return (
      <div
        className="flex flex-col items-center justify-center bg-white rounded-lg border p-6"
        style={{ height }}
      >
        <TrendingUp className="w-8 h-8 text-blue-500 mb-2" />
        <div className="text-3xl font-bold text-slate-800">
          {formatNumber(totalValue)}
        </div>
        <div className="text-sm text-slate-500 mt-1">
          {title || kpiMetric.name}
        </div>
      </div>
    );
  }

  // Click handler for drill-down
  const handleChartClick = (params: any) => {
    if (!onDrillDown) return;

    // Get full category name from data
    const categoryField = groupBy.length > 0 ? 'key_val' : Object.keys(data[0] || {})[0];
    const dataIndex = params.dataIndex ?? 0;
    const category = data[dataIndex]?.[categoryField] || params.name || '';
    const value = params.value ?? 0;
    const seriesName = params.seriesName || '';

    logger.debug('Chart click:', { category, value, seriesName, dataIndex });
    onDrillDown(category, value, seriesName);
  };

  const chartEvents = onDrillDown ? {
    click: handleChartClick
  } : undefined;

  return (
    <div
      className="bg-white rounded-lg border overflow-hidden"
      style={{ height, cursor: onDrillDown ? 'pointer' : 'default' }}
    >
      <ReactECharts
        echarts={echarts}
        option={chartOptions}
        style={{ height: '100%', width: '100%' }}
        opts={{ renderer: 'canvas' }}
        notMerge={true}
        onEvents={chartEvents}
      />
    </div>
  );
}

// Helper: Format large numbers
function formatNumber(value: number): string {
  if (Math.abs(value) >= 1e9) {
    return (value / 1e9).toFixed(1) + 'B';
  }
  if (Math.abs(value) >= 1e6) {
    return (value / 1e6).toFixed(1) + 'M';
  }
  if (Math.abs(value) >= 1e3) {
    return (value / 1e3).toFixed(1) + 'K';
  }
  return value.toLocaleString('it-IT', { maximumFractionDigits: 2 });
}

// Chart type selector component
export function ChartTypeSelector({
  value,
  onChange
}: {
  value: ChartType;
  onChange: (type: ChartType) => void;
}) {
  const types: { type: ChartType; icon: React.ElementType; label: string }[] = [
    { type: 'bar', icon: BarChart3, label: 'Barre' },
    { type: 'horizontal-bar', icon: BarChart3, label: 'Barre Orizz.' },
    { type: 'line', icon: LineChart, label: 'Linee' },
    { type: 'area', icon: TrendingUp, label: 'Area' },
    { type: 'pie', icon: PieChart, label: 'Torta' },
    { type: 'kpi', icon: TrendingUp, label: 'KPI' },
  ];

  return (
    <div className="flex gap-1">
      {types.map(({ type, icon: Icon, label }) => (
        <button
          key={type}
          onClick={() => onChange(type)}
          className={`p-2 rounded-lg transition ${
            value === type
              ? 'bg-blue-100 text-blue-700'
              : 'hover:bg-slate-100 text-slate-500'
          }`}
          title={label}
        >
          <Icon className="w-4 h-4" />
        </button>
      ))}
    </div>
  );
}
