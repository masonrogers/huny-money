"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bitcoin } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { NAV_ITEMS } from "./nav-config";

/**
 * Persistent sidebar navigation. Always visible. Active route highlighted.
 *
 * Each item shows: icon, label, and a "g + letter" shortcut hint on the
 * right (rendered as a kbd-style chip). The shortcut framework that wires
 * these up lives in the AppShell client wrapper.
 */
export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary navigation"
      className="surface-2 flex flex-col w-60 shrink-0 px-3 py-4 gap-0.5"
    >
      {/* Brand */}
      <div className="px-2 mb-5 flex items-center gap-2">
        <div className="size-7 rounded-md bg-[var(--color-accent-bg)] grid place-items-center">
          <Bitcoin className="size-4 text-[var(--color-accent)]" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight">Huny Money</span>
          <span className="text-[0.65rem] text-[var(--color-text-muted)]">v3.0</span>
        </div>
      </div>

      {/* Nav items */}
      <ul className="flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-[var(--color-bg-card)] text-[var(--color-text-primary)] border border-[var(--color-border)]"
                    : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-card)] hover:text-[var(--color-text-primary)] border border-transparent",
                )}
              >
                <Icon
                  className={cn(
                    "size-4 shrink-0",
                    active
                      ? "text-[var(--color-accent)]"
                      : "text-[var(--color-text-muted)] group-hover:text-[var(--color-text-secondary)]",
                  )}
                />
                <span className="flex-1 truncate">{item.label}</span>
                <kbd
                  className="hidden md:inline-flex items-center justify-center min-w-5 px-1 h-4 rounded text-[0.6rem] font-mono text-[var(--color-text-faint)] bg-[var(--color-bg)] border border-[var(--color-border)] group-hover:text-[var(--color-text-muted)] group-hover:border-[var(--color-border-strong)]"
                  aria-hidden="true"
                >
                  g {item.shortcut}
                </kbd>
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Footer hint */}
      <div className="mt-auto px-2 pt-4 text-[0.65rem] text-[var(--color-text-faint)] leading-relaxed">
        <kbd className="font-mono mr-1">⌘ K</kbd> command palette
      </div>
    </nav>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
