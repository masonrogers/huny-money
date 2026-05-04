import * as React from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Tiny SVG sparkline. No deps, intentionally minimal — Recharts would be
 * overkill for an inline trend line.
 *
 * Usage:
 *   <Sparkline values={equityCurveLast30d} tone="success" />
 */

export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  tone?: "accent" | "success" | "danger" | "muted";
  /** Fill the area under the line. */
  fill?: boolean;
  className?: string;
  /** Aria label for screen readers. */
  ariaLabel?: string;
}

const TONE_TO_VAR: Record<NonNullable<SparklineProps["tone"]>, string> = {
  accent: "var(--color-accent)",
  success: "var(--color-success)",
  danger: "var(--color-danger)",
  muted: "var(--color-text-muted)",
};

export function Sparkline({
  values,
  width = 80,
  height = 24,
  tone = "accent",
  fill = false,
  className,
  ariaLabel,
}: SparklineProps) {
  if (values.length === 0) {
    return (
      <span
        aria-label={ariaLabel ?? "no data"}
        className={cn(
          "inline-block text-[var(--color-text-faint)] text-xs",
          className,
        )}
        style={{ width, height }}
      >
        —
      </span>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : 0;

  const points = values
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const color = TONE_TO_VAR[tone];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("inline-block align-middle", className)}
      role="img"
      aria-label={ariaLabel ?? `sparkline of ${values.length} values`}
    >
      {fill && (
        <polygon
          points={`0,${height} ${points} ${width},${height}`}
          fill={color}
          fillOpacity={0.15}
        />
      )}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
