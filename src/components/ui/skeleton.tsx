import * as React from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Lightweight loading skeleton. Used in place of "Loading..." empty states
 * during the initial SWR fetch so the layout doesn't jump on data arrival.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-[var(--color-bg-card-hover)]",
        className,
      )}
      {...props}
    />
  );
}

/** A row of stat-card skeletons matching the Overview top strip. */
export function MetricStripSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="surface-1 rounded-lg p-5 space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

/** Generic card skeleton with title bar and body lines. */
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="surface-1 rounded-lg p-5 space-y-3">
      <Skeleton className="h-4 w-32" />
      <div className="space-y-2 pt-2">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className={cn("h-3", i === lines - 1 ? "w-3/4" : "w-full")} />
        ))}
      </div>
    </div>
  );
}

/** Multi-row list skeleton (for activity feeds, position cards, etc.). */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="surface-1 rounded-lg p-4 flex items-center gap-3"
        >
          <Skeleton className="size-8 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}
