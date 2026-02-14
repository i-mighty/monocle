import { useEffect, useState, useMemo } from "react";

// ==================== TYPES ====================

interface TimeSeriesPoint {
  timestamp: string;
  value: number;
}

interface PerformancePoint {
  timestamp: string;
  avgLatencyMs: number;
  errorRate: number;
  callCount: number;
}

// ==================== UTILITY FUNCTIONS ====================

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function formatLamports(lamports: number): string {
  const sol = lamports / 1_000_000_000;
  if (sol >= 1) return `${sol.toFixed(2)} SOL`;
  return `${formatNumber(lamports)} lamports`;
}

function formatDate(timestamp: string): string {
  const d = new Date(timestamp);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTime(timestamp: string): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

// ==================== SPARKLINE CHART ====================

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  showArea?: boolean;
}

export function Sparkline({ 
  data, 
  width = 120, 
  height = 40, 
  color = "#3b82f6",
  showArea = true 
}: SparklineProps) {
  if (!data || data.length === 0) {
    return <div className="sparkline-empty" style={{ width, height }} />;
  }

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  }).join(" ");

  const areaPath = `M0,${height} L${data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  }).join(" L")} L${width},${height} Z`;

  return (
    <svg width={width} height={height} className="sparkline">
      {showArea && (
        <path d={areaPath} fill={color} fillOpacity={0.1} />
      )}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ==================== BAR CHART ====================

interface BarChartProps {
  data: { label: string; value: number; color?: string }[];
  height?: number;
  showValues?: boolean;
}

export function BarChart({ data, height = 200, showValues = true }: BarChartProps) {
  if (!data || data.length === 0) {
    return <div className="chart-empty">No data available</div>;
  }

  const max = Math.max(...data.map(d => d.value));
  
  return (
    <div className="bar-chart" style={{ height }}>
      {data.map((item, i) => {
        const barHeight = max > 0 ? (item.value / max) * 100 : 0;
        return (
          <div key={i} className="bar-container">
            <div 
              className="bar" 
              style={{ 
                height: `${barHeight}%`,
                backgroundColor: item.color || "#3b82f6"
              }}
            />
            {showValues && (
              <div className="bar-value">{formatNumber(item.value)}</div>
            )}
            <div className="bar-label">{item.label}</div>
          </div>
        );
      })}
      <style jsx>{`
        .bar-chart {
          display: flex;
          align-items: flex-end;
          gap: 8px;
          padding: 20px 0;
        }
        .bar-container {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          min-width: 40px;
        }
        .bar {
          width: 100%;
          max-width: 60px;
          border-radius: 4px 4px 0 0;
          transition: height 0.3s ease;
        }
        .bar-value {
          font-size: 12px;
          color: #6b7280;
          margin-top: 4px;
        }
        .bar-label {
          font-size: 11px;
          color: #9ca3af;
          text-align: center;
          margin-top: 4px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 60px;
        }
      `}</style>
    </div>
  );
}

// ==================== LINE CHART ====================

interface LineChartProps {
  data: TimeSeriesPoint[];
  height?: number;
  color?: string;
  showGrid?: boolean;
  formatValue?: (v: number) => string;
}

export function LineChart({ 
  data, 
  height = 200, 
  color = "#3b82f6",
  showGrid = true,
  formatValue = formatNumber
}: LineChartProps) {
  const width = 600;
  const padding = { top: 20, right: 20, bottom: 40, left: 60 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  if (!data || data.length === 0) {
    return <div className="chart-empty" style={{ height }}>No data available</div>;
  }

  const values = data.map(d => d.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;

  const points = data.map((d, i) => {
    const x = padding.left + (i / (data.length - 1)) * chartWidth;
    const y = padding.top + chartHeight - ((d.value - min) / range) * chartHeight;
    return { x, y, ...d };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const areaPath = `${linePath} L${points[points.length - 1].x},${height - padding.bottom} L${padding.left},${height - padding.bottom} Z`;

  // Y-axis labels
  const yLabels = [0, 0.25, 0.5, 0.75, 1].map(pct => ({
    value: min + pct * range,
    y: padding.top + chartHeight - pct * chartHeight,
  }));

  // X-axis labels (show ~5 labels)
  const step = Math.max(1, Math.floor(data.length / 5));
  const xLabels = data.filter((_, i) => i % step === 0 || i === data.length - 1);

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
      {/* Grid lines */}
      {showGrid && yLabels.map((label, i) => (
        <line
          key={i}
          x1={padding.left}
          y1={label.y}
          x2={width - padding.right}
          y2={label.y}
          stroke="#e5e7eb"
          strokeDasharray="4"
        />
      ))}

      {/* Area fill */}
      <path d={areaPath} fill={color} fillOpacity={0.1} />

      {/* Line */}
      <path d={linePath} fill="none" stroke={color} strokeWidth={2} />

      {/* Data points */}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill={color} />
      ))}

      {/* Y-axis labels */}
      {yLabels.map((label, i) => (
        <text
          key={i}
          x={padding.left - 10}
          y={label.y + 4}
          textAnchor="end"
          fontSize={11}
          fill="#6b7280"
        >
          {formatValue(label.value)}
        </text>
      ))}

      {/* X-axis labels */}
      {xLabels.map((d, i) => {
        const x = padding.left + (data.indexOf(d) / (data.length - 1)) * chartWidth;
        return (
          <text
            key={i}
            x={x}
            y={height - 10}
            textAnchor="middle"
            fontSize={11}
            fill="#6b7280"
          >
            {formatDate(d.timestamp)}
          </text>
        );
      })}
    </svg>
  );
}

// ==================== DUAL AXIS CHART (Latency + Error Rate) ====================

interface DualAxisChartProps {
  data: PerformancePoint[];
  height?: number;
}

export function DualAxisChart({ data, height = 250 }: DualAxisChartProps) {
  const width = 600;
  const padding = { top: 20, right: 60, bottom: 40, left: 60 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  if (!data || data.length === 0) {
    return <div className="chart-empty" style={{ height }}>No data available</div>;
  }

  const latencies = data.map(d => d.avgLatencyMs);
  const errors = data.map(d => d.errorRate);
  
  const maxLatency = Math.max(...latencies) || 100;
  const maxError = Math.max(...errors, 5); // Min 5% for visibility

  const latencyPoints = data.map((d, i) => {
    const x = padding.left + (i / (data.length - 1)) * chartWidth;
    const y = padding.top + chartHeight - (d.avgLatencyMs / maxLatency) * chartHeight;
    return { x, y };
  });

  const errorPoints = data.map((d, i) => {
    const x = padding.left + (i / (data.length - 1)) * chartWidth;
    const y = padding.top + chartHeight - (d.errorRate / maxError) * chartHeight;
    return { x, y };
  });

  const latencyPath = latencyPoints.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const errorPath = errorPoints.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
      {/* Grid */}
      {[0, 0.5, 1].map((pct, i) => (
        <line
          key={i}
          x1={padding.left}
          y1={padding.top + chartHeight - pct * chartHeight}
          x2={width - padding.right}
          y2={padding.top + chartHeight - pct * chartHeight}
          stroke="#e5e7eb"
          strokeDasharray="4"
        />
      ))}

      {/* Latency line */}
      <path d={latencyPath} fill="none" stroke="#3b82f6" strokeWidth={2} />
      
      {/* Error rate line */}
      <path d={errorPath} fill="none" stroke="#ef4444" strokeWidth={2} strokeDasharray="4" />

      {/* Legend */}
      <g transform={`translate(${padding.left}, 10)`}>
        <line x1={0} y1={0} x2={20} y2={0} stroke="#3b82f6" strokeWidth={2} />
        <text x={25} y={4} fontSize={11} fill="#6b7280">Latency (ms)</text>
        <line x1={120} y1={0} x2={140} y2={0} stroke="#ef4444" strokeWidth={2} strokeDasharray="4" />
        <text x={145} y={4} fontSize={11} fill="#6b7280">Error Rate (%)</text>
      </g>

      {/* Y-axis labels (left - latency) */}
      <text x={padding.left - 10} y={padding.top + 4} textAnchor="end" fontSize={11} fill="#3b82f6">
        {maxLatency.toFixed(0)}ms
      </text>
      <text x={padding.left - 10} y={height - padding.bottom} textAnchor="end" fontSize={11} fill="#3b82f6">
        0ms
      </text>

      {/* Y-axis labels (right - error rate) */}
      <text x={width - padding.right + 10} y={padding.top + 4} textAnchor="start" fontSize={11} fill="#ef4444">
        {maxError.toFixed(1)}%
      </text>
      <text x={width - padding.right + 10} y={height - padding.bottom} textAnchor="start" fontSize={11} fill="#ef4444">
        0%
      </text>

      {/* X-axis labels */}
      {data.filter((_, i) => i % Math.max(1, Math.floor(data.length / 5)) === 0).map((d, i) => {
        const x = padding.left + (data.indexOf(d) / (data.length - 1)) * chartWidth;
        return (
          <text key={i} x={x} y={height - 10} textAnchor="middle" fontSize={11} fill="#6b7280">
            {formatDate(d.timestamp)}
          </text>
        );
      })}
    </svg>
  );
}

// ==================== DONUT CHART ====================

interface DonutChartProps {
  data: { label: string; value: number; color: string }[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string | number;
}

export function DonutChart({ 
  data, 
  size = 200, 
  thickness = 30,
  centerLabel,
  centerValue
}: DonutChartProps) {
  if (!data || data.length === 0) {
    return <div className="chart-empty">No data</div>;
  }

  const total = data.reduce((sum, d) => sum + d.value, 0);
  const radius = size / 2;
  const innerRadius = radius - thickness;
  
  let currentAngle = -90; // Start from top

  const segments = data.map(d => {
    const angle = total > 0 ? (d.value / total) * 360 : 0;
    const startAngle = currentAngle;
    currentAngle += angle;
    
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = ((startAngle + angle) * Math.PI) / 180;
    
    const x1 = radius + Math.cos(startRad) * radius;
    const y1 = radius + Math.sin(startRad) * radius;
    const x2 = radius + Math.cos(endRad) * radius;
    const y2 = radius + Math.sin(endRad) * radius;
    const x3 = radius + Math.cos(endRad) * innerRadius;
    const y3 = radius + Math.sin(endRad) * innerRadius;
    const x4 = radius + Math.cos(startRad) * innerRadius;
    const y4 = radius + Math.sin(startRad) * innerRadius;
    
    const largeArc = angle > 180 ? 1 : 0;
    
    return {
      ...d,
      path: `M${x1},${y1} A${radius},${radius} 0 ${largeArc} 1 ${x2},${y2} L${x3},${y3} A${innerRadius},${innerRadius} 0 ${largeArc} 0 ${x4},${y4} Z`,
      percentage: total > 0 ? ((d.value / total) * 100).toFixed(1) : "0",
    };
  });

  return (
    <div className="donut-chart-container">
      <svg width={size} height={size}>
        {segments.map((seg, i) => (
          <path key={i} d={seg.path} fill={seg.color} />
        ))}
        {centerLabel && (
          <>
            <text x={radius} y={radius - 10} textAnchor="middle" fontSize={12} fill="#6b7280">
              {centerLabel}
            </text>
            <text x={radius} y={radius + 15} textAnchor="middle" fontSize={24} fontWeight="bold" fill="#111827">
              {centerValue}
            </text>
          </>
        )}
      </svg>
      <div className="donut-legend">
        {segments.map((seg, i) => (
          <div key={i} className="legend-item">
            <span className="legend-color" style={{ backgroundColor: seg.color }} />
            <span className="legend-label">{seg.label}</span>
            <span className="legend-value">{seg.percentage}%</span>
          </div>
        ))}
      </div>
      <style jsx>{`
        .donut-chart-container {
          display: flex;
          align-items: center;
          gap: 20px;
        }
        .donut-legend {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .legend-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
        }
        .legend-color {
          width: 12px;
          height: 12px;
          border-radius: 2px;
        }
        .legend-label {
          color: #374151;
        }
        .legend-value {
          color: #6b7280;
          margin-left: auto;
        }
      `}</style>
    </div>
  );
}

// ==================== STAT CARD ====================

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  change?: number;
  sparklineData?: number[];
  color?: string;
}

export function StatCard({ title, value, subtitle, change, sparklineData, color = "#3b82f6" }: StatCardProps) {
  const changeColor = change === undefined ? "inherit" : change >= 0 ? "#10b981" : "#ef4444";
  const changeIcon = change === undefined ? "" : change >= 0 ? "↑" : "↓";

  return (
    <div className="stat-card">
      <div className="stat-header">
        <span className="stat-title">{title}</span>
        {change !== undefined && (
          <span className="stat-change" style={{ color: changeColor }}>
            {changeIcon} {Math.abs(change).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="stat-value">{value}</div>
      {subtitle && <div className="stat-subtitle">{subtitle}</div>}
      {sparklineData && sparklineData.length > 0 && (
        <div className="stat-sparkline">
          <Sparkline data={sparklineData} width={100} height={30} color={color} />
        </div>
      )}
      <style jsx>{`
        .stat-card {
          background: white;
          border-radius: 8px;
          padding: 16px;
          border: 1px solid #e5e7eb;
        }
        .stat-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }
        .stat-title {
          font-size: 13px;
          color: #6b7280;
        }
        .stat-change {
          font-size: 12px;
          font-weight: 500;
        }
        .stat-value {
          font-size: 24px;
          font-weight: 600;
          color: #111827;
        }
        .stat-subtitle {
          font-size: 12px;
          color: #9ca3af;
          margin-top: 4px;
        }
        .stat-sparkline {
          margin-top: 12px;
        }
      `}</style>
    </div>
  );
}

// ==================== TRUST BADGE ====================

interface TrustBadgeProps {
  tier: "new" | "basic" | "verified" | "trusted" | "elite";
  score: number;
}

export function TrustBadge({ tier, score }: TrustBadgeProps) {
  const tierColors: Record<string, { bg: string; text: string; border: string }> = {
    new: { bg: "#f3f4f6", text: "#6b7280", border: "#d1d5db" },
    basic: { bg: "#dbeafe", text: "#1d4ed8", border: "#93c5fd" },
    verified: { bg: "#d1fae5", text: "#059669", border: "#6ee7b7" },
    trusted: { bg: "#fef3c7", text: "#d97706", border: "#fcd34d" },
    elite: { bg: "#ede9fe", text: "#7c3aed", border: "#c4b5fd" },
  };

  const colors = tierColors[tier] || tierColors.new;

  return (
    <span 
      className="trust-badge"
      style={{ 
        backgroundColor: colors.bg, 
        color: colors.text,
        borderColor: colors.border 
      }}
    >
      {tier.toUpperCase()} • {score}
      <style jsx>{`
        .trust-badge {
          display: inline-flex;
          align-items: center;
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 600;
          border: 1px solid;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
      `}</style>
    </span>
  );
}

// ==================== PLACEHOLDER (original export) ====================

export function Charts() {
  return (
    <div className="charts-placeholder">
      <p>Charts are now available as individual components.</p>
      <p>Import: Sparkline, BarChart, LineChart, DualAxisChart, DonutChart, StatCard, TrustBadge</p>
    </div>
  );
}

