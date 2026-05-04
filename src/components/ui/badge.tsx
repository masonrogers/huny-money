import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium tracking-tight",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--color-bg-card)] text-[var(--color-text-secondary)] border border-[var(--color-border)]",
        accent:
          "bg-[var(--color-accent-bg)] text-[var(--color-accent)] border border-[var(--color-accent)]/30",
        success:
          "bg-[var(--color-success-bg)] text-[var(--color-success)] border border-[var(--color-success)]/30",
        warning:
          "bg-[var(--color-warning-bg)] text-[var(--color-warning)] border border-[var(--color-warning)]/30",
        danger:
          "bg-[var(--color-danger-bg)] text-[var(--color-danger)] border border-[var(--color-danger)]/30",
        paper:
          "bg-[var(--color-mode-paper-bg)] text-[var(--color-mode-paper)] border border-[var(--color-mode-paper)]/40",
        live:
          "bg-[var(--color-mode-live-bg)] text-[var(--color-mode-live)] border border-[var(--color-mode-live)]/40",
      },
      size: {
        sm: "text-[0.65rem] px-1.5 py-0.5",
        md: "text-xs",
        lg: "text-sm px-2.5 py-1",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, size, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant, size }), className)} {...props} />
  ),
);
Badge.displayName = "Badge";

export { badgeVariants };
