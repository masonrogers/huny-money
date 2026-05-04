import * as React from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Informative empty states per STRATEGY.md §8.1 ("No open positions because
 * regime is bear and we're sitting in cash" beats a blank table).
 *
 * Always pair the heading with an explanation of WHY the state is empty.
 */

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 py-10 text-center gap-3",
        className,
      )}
    >
      {icon && (
        <div className="text-[var(--color-text-faint)] [&_svg]:size-8">{icon}</div>
      )}
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-[var(--color-text-primary)]">{title}</p>
        <p className="text-xs text-[var(--color-text-muted)] max-w-sm leading-relaxed">
          {description}
        </p>
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
