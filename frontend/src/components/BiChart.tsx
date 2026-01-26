/**
 * BiChart Component - ECharts integration for INFOBI 4.0
 *
 * Uses the same pivot API as TreeDataGrid/BiGrid but renders as charts.
 * Supports: bar, line, pie, area, KPI card
 */
import { useEffect, useState, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';
import * as arrow from 'apache-arrow';
import { Loader2, BarChart3, LineChart, PieChart, TrendingUp } from 'lucide-react';
import { pivotApi } from '../services/api';

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
  colorPalette = DEFAULT_COLORS
}: BiChartProps) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      const response = await pivotApi.execute(reportId, {
        group_by: groupBy,
        split_by: splitBy,
        metrics: metrics.map(m => ({
          name: m.name,
          field: m.field,
          type: m.aggregation.toLowerCase(),
          aggregation: m.aggregation
        })),
        filters,
        calculate_delta: false,
        limit: 1000 // Limit for charts
      });

      // Parse Arrow IPC buffer
      const table = arrow.tableFromIPC(response.data);
      const rows: any[] = [];

      for (let i = 0; i < table.numRows; i++) {
        const row: any = {};
        for (const field of table.schema.fields) {
          const column = table.getChild(field.name);
          if (column) {
            row[field.name] = column.get(i);
          }
        }
        rows.push(row);
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

    // Determine the category field (first groupBy or key_val)
    const categoryField = groupBy.length > 0 ? 'key_val' : Object.keys(data[0])[0];
    const categories = data.map(row => row[categoryField] || 'N/A');

    // Common options
    const baseOptions: echarts.EChartsOption = {
      color: colorPalette,
      tooltip: {
        trigger: chartType === 'pie' ? 'item' : 'axis',
        axisPointer: { type: 'shadow' }
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

    switch (chartType) {
      case 'bar':
      case 'horizontal-bar':
        return {
          ...baseOptions,
          xAxis: chartType === 'horizontal-bar' ? {
            type: 'value'
          } : {
            type: 'category',
            data: categories,
            axisLabel: {
              rotate: categories.length > 8 ? 45 : 0,
              interval: 0
            }
          },
          yAxis: chartType === 'horizontal-bar' ? {
            type: 'category',
            data: categories
          } : {
            type: 'value'
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
        return {
          ...baseOptions,
          xAxis: {
            type: 'category',
            data: categories,
            boundaryGap: false,
            axisLabel: {
              rotate: categories.length > 8 ? 45 : 0
            }
          },
          yAxis: { type: 'value' },
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
  }, [data, chartType, groupBy, metrics, title, showLegend, colorPalette]);

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

  return (
    <div className="bg-white rounded-lg border overflow-hidden" style={{ height }}>
      <ReactECharts
        echarts={echarts}
        option={chartOptions}
        style={{ height: '100%', width: '100%' }}
        opts={{ renderer: 'canvas' }}
        notMerge={true}
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
