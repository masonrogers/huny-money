import * as React from "react";
import { cn } from "@/lib/utils/cn";

/**
 * A colored dot for status indicators (regime, paused/halted, online/offline).
 * Pulses subtly when `pulse` is true to draw attention to live state.
 */

type StatusTone = "neutral" | "success" | "warning" | "danger" | "accent" | "paper" | "live";

const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: "bg-[var(--color-text-muted)]",
  success: "bg-[var(--color-success)]",
  warning: "bg-[var(--color-warning)]",
  danger: "bg-[var(--color-danger)]",
  accent: "bg-[var(--color-accent)]",
  paper: "bg-[var(--color-mode-paper)]",
  live: "bg-[var(--color-mode-live)]",
};

export interface StatusDotProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
  pulse?: boolean;
  size?: "sm" | "md";
}

export const StatusDot = React.forwardRef<HTMLSpanElement, StatusDotProps>(
  ({ tone = "neutral", pulse = false, size = "md", className, ...props }, ref) => {
    const sizeCls = size === "sm" ? "size-1.5" : "size-2";
    return (
      <span
        ref={ref}
        className={cn(
          "relative inline-block rounded-full",
          sizeCls,
          TONE_CLASSES[tone],
          className,
        )}
        {...props}
      >
        {pulse && (
          <span
            className={cn(
              "absolute inset-0 rounded-full animate-ping opacity-75",
              TONE_CLASSES[tone],
            )}
          />
        )}
      </span>
    );
  },
);
StatusDot.displayName = "StatusDot";
