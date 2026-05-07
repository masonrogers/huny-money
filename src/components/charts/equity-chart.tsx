"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Equity-vs-BTC chart. Two lines:
 *   - bot equity (accent / success / danger depending on relative slope)
 *   - synthetic BTC buy-and-hold at the same starting capital (muted)
 *
 * Pure SVG, no Recharts. The point shape matches the equity-curve API:
 *   { ts: ISO string, equity: number, btcEquivalent: number | null }
 *
 * Renders nothing if there are zero points — caller decides what empty
 * state to show. Renders a single dot if there's exactly one point so the
 * operator sees something on day one.
 */

export interface EquityChartPoint {
  ts: string;
  equity: number;
  btcEquivalent: number | null;
}

export interface EquityChartProps {
  points: readonly EquityChartPoint[];
  startingCapital: number | null;
  width?: number;
  height?: number;
  className?: string;
  showAxis?: boolean;
}

export function EquityChart({
  points,
  startingCapital,
  width = 800,
  height = 240,
  className,
  showAxis = true,
}: EquityChartProps) {
  if (points.length === 0) return null;

  const padding = showAxis
    ? { top: 12, right: 12, bottom: 24, left: 56 }
    : { top: 4, right: 4, bottom: 4, left: 4 };
  const innerW = Math.max(1, width - padding.left - padding.right);
  const innerH = Math.max(1, height - padding.top - padding.bottom);

  const xs = points.map((p) => new Date(p.ts).getTime());
  const minX = xs[0]!;
  const maxX = xs[xs.length - 1]!;
  const xRange = Math.max(1, maxX - minX);

  const allY = points.flatMap((p) =>
    p.btcEquivalent != null ? [p.equity, p.btcEquivalent] : [p.equity],
  );
  if (startingCapital != null) allY.push(startingCapital);
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);
  const yPad = (maxY - minY) * 0.05 || Math.max(1, maxY * 0.02);
  const yMin = minY - yPad;
  const yMax = maxY + yPad;
  const yRange = Math.max(1, yMax - yMin);

  const x = (ts: number): number =>
    padding.left + ((ts - minX) / xRange) * innerW;
  const y = (v: number): number =>
    padding.top + innerH - ((v - yMin) / yRange) * innerH;

  const equityPath = lineFromPoints(points.map((p) => ({ x: x(new Date(p.ts).getTime()), y: y(p.equity) })));
  const btcPoints = points
    .map((p) => (p.btcEquivalent != null ? { x: x(new Date(p.ts).getTime()), y: y(p.btcEquivalent) } : null))
    .filter((p): p is { x: number; y: number } => p !== null);
  const btcPath = lineFromPoints(btcPoints);

  // Pick equity stroke color by overall direction: green if up, red if down,
  // accent if flat. Using the last point relative to the first.
  const equityColor =
    points.length >= 2
      ? points[points.length - 1]!.equity > points[0]!.equity
        ? "var(--color-success)"
        : points[points.length - 1]!.equity < points[0]!.equity
          ? "var(--color-danger)"
          : "var(--color-accent)"
      : "var(--color-accent)";

  // Y axis ticks: 4 evenly spaced.
  const yTicks = makeTicks(yMin, yMax, 4);
  const xTicks = makeTimeTicks(minX, maxX, 4);

  const fmtUsd = (n: number): string => {
    if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
    return `$${n.toFixed(0)}`;
  };
  const fmtTime = (t: number): string => {
    const d = new Date(t);
    const days = (maxX - minX) / 86_400_000;
    if (days <= 2) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("block", className)}
      role="img"
      aria-label="Equity curve vs BTC buy-and-hold"
    >
      {/* Axis grid */}
      {showAxis && (
        <g>
          {yTicks.map((t, i) => (
            <g key={`y-${i}`}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--color-border)"
                strokeWidth={0.5}
                strokeDasharray="3 3"
                opacity={0.5}
              />
              <text
                x={padding.left - 6}
                y={y(t) + 3}
                textAnchor="end"
                fontSize="10"
                fill="var(--color-text-faint)"
                className="tnum"
              >
                {fmtUsd(t)}
              </text>
            </g>
          ))}
          {xTicks.map((t, i) => (
            <text
              key={`x-${i}`}
              x={x(t)}
              y={height - 6}
              textAnchor="middle"
              fontSize="10"
              fill="var(--color-text-faint)"
            >
              {fmtTime(t)}
            </text>
          ))}
          {startingCapital != null && (
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={y(startingCapital)}
              y2={y(startingCapital)}
              stroke="var(--color-text-faint)"
              strokeWidth={0.75}
              strokeDasharray="2 4"
              opacity={0.6}
            />
          )}
        </g>
      )}

      {/* BTC buy-and-hold benchmark */}
      {btcPath && (
        <path
          d={btcPath}
          fill="none"
          stroke="var(--color-text-muted)"
          strokeWidth={1.25}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="4 3"
          opacity={0.65}
        />
      )}

      {/* Equity */}
      {equityPath && (
        <path
          d={equityPath}
          fill="none"
          stroke={equityColor}
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {/* Single-point fallback so day-one renders visibly */}
      {points.length === 1 && (
        <circle
          cx={x(new Date(points[0]!.ts).getTime())}
          cy={y(points[0]!.equity)}
          r={3}
          fill={equityColor}
        />
      )}
    </svg>
  );
}

function lineFromPoints(pts: Array<{ x: number; y: number }>): string | null {
  if (pts.length === 0) return null;
  const cmds: string[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    cmds.push(`${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`);
  }
  return cmds.join(" ");
}

function makeTicks(min: number, max: number, count: number): number[] {
  if (count <= 1) return [min];
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, i) => min + i * step);
}

function makeTimeTicks(min: number, max: number, count: number): number[] {
  if (count <= 1) return [min];
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, i) => min + i * step);
}

/**
 * Compact two-color legend for the chart.
 */
export function EquityChartLegend({
  trend,
  startingCapital,
}: {
  trend: "up" | "down" | "flat";
  startingCapital?: number | null;
}) {
  const equityColor =
    trend === "up"
      ? "var(--color-success)"
      : trend === "down"
        ? "var(--color-danger)"
        : "var(--color-accent)";
  return (
    <div className="flex items-center gap-4 text-xs text-[var(--color-text-muted)]">
      <span className="inline-flex items-center gap-1.5">
        <span
          className="inline-block w-6 h-0.5 rounded-full"
          style={{ background: equityColor }}
        />
        Bot equity
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="inline-block w-6 h-0.5 rounded-full border-t border-dashed"
          style={{ borderColor: "var(--color-text-muted)" }}
        />
        BTC buy-and-hold
      </span>
      {startingCapital != null && (
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block w-6 h-0 rounded-full border-t border-dashed"
            style={{ borderColor: "var(--color-text-faint)" }}
          />
          Starting capital
        </span>
      )}
    </div>
  );
}
