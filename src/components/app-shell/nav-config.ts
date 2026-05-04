import {
  Activity,
  Bot,
  CalendarClock,
  GanttChart,
  Gauge,
  LineChart,
  ListChecks,
  Settings,
  TrendingUp,
} from "lucide-react";

/**
 * Navigation configuration for the AppShell.
 *
 * Order matches STRATEGY.md §8.2's view list. The Cycle Position view (7.5)
 * is the v3-specific addition that visualizes per-asset 6-month range
 * positions — central to evaluating AI judgment on cycle calls.
 */

export interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Single-letter shortcut for "g + letter" navigation (lowercase). */
  shortcut: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Overview", icon: Gauge, shortcut: "o" },
  { href: "/today", label: "Today's Plan", icon: CalendarClock, shortcut: "t" },
  { href: "/ai-activity", label: "AI Activity", icon: Bot, shortcut: "a" },
  { href: "/positions", label: "Positions", icon: GanttChart, shortcut: "p" },
  { href: "/cycles", label: "Cycle Position", icon: TrendingUp, shortcut: "y" },
  { href: "/decisions", label: "Decisions & Triggers", icon: ListChecks, shortcut: "d" },
  { href: "/performance", label: "Performance", icon: LineChart, shortcut: "m" },
  { href: "/system", label: "System", icon: Activity, shortcut: "s" },
  { href: "/controls", label: "Controls", icon: Settings, shortcut: "c" },
] as const;
