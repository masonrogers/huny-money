"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { Search, ArrowRight, Pause, Play, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { NAV_ITEMS } from "./nav-config";
import { cn } from "@/lib/utils/cn";

/**
 * Command palette opened by cmd/ctrl+K. Listens for the global
 * "hm:open-command-palette" event dispatched by KeyboardShortcuts.
 *
 * Provides quick navigation across the 9 dashboard views and a small set
 * of common actions. Type to filter; arrow keys to navigate; enter to run;
 * escape to close.
 *
 * Phase 8 ships nav + actions. AI-activity search across `evaluations` is a
 * follow-up — needs the `/api/dashboard/ai-activity?q=...` extension.
 */

interface CommandItem {
  id: string;
  label: string;
  group: "Navigate" | "Actions";
  shortcut?: string;
  icon: React.ComponentType<{ className?: string }>;
  run: () => void | Promise<void>;
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Listen for the global open event (dispatched by KeyboardShortcuts).
  React.useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("hm:open-command-palette", handler);
    return () => window.removeEventListener("hm:open-command-palette", handler);
  }, []);

  // Reset query + focus on open.
  React.useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  const items: CommandItem[] = React.useMemo(() => {
    const navItems: CommandItem[] = NAV_ITEMS.map((n) => ({
      id: `nav:${n.href}`,
      label: n.label,
      group: "Navigate" as const,
      shortcut: `g ${n.shortcut}`,
      icon: n.icon,
      run: () => router.push(n.href),
    }));

    const actions: CommandItem[] = [
      {
        id: "action:pause",
        label: "Pause trading",
        group: "Actions",
        icon: Pause,
        run: async () => {
          await fetch("/api/controls/pause", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paused: true }),
          });
        },
      },
      {
        id: "action:resume",
        label: "Resume trading",
        group: "Actions",
        icon: Play,
        run: async () => {
          await fetch("/api/controls/pause", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paused: false }),
          });
        },
      },
      {
        id: "action:force-brief",
        label: "Force morning brief",
        group: "Actions",
        icon: RefreshCw,
        run: async () => {
          await fetch("/api/controls/force-brief", { method: "POST" });
        },
      },
    ];

    return [...navItems, ...actions];
  }, [router]);

  const filtered = React.useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter((i) => i.label.toLowerCase().includes(q));
  }, [items, query]);

  React.useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[activeIndex];
      if (item) {
        void item.run();
        setOpen(false);
      }
    }
  };

  // Group items by group label for the rendered list.
  const grouped = React.useMemo(() => {
    const out: Record<string, CommandItem[]> = {};
    for (const item of filtered) {
      out[item.group] = [...(out[item.group] ?? []), item];
    }
    return out;
  }, [filtered]);

  let cursor = -1; // running index for keyboard navigation across groups

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent hideClose className="p-0 max-w-lg">
        <VisuallyHidden.Root>
          <DialogTitle>Command palette</DialogTitle>
          <DialogDescription>Navigate or run actions.</DialogDescription>
        </VisuallyHidden.Root>

        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--color-border)]">
          <Search className="size-4 text-[var(--color-text-muted)] shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search or jump to…"
            className="flex-1 bg-transparent text-sm placeholder:text-[var(--color-text-faint)] focus:outline-none"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="text-[0.65rem] font-mono text-[var(--color-text-faint)] bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-1.5 py-0.5">
            ESC
          </kbd>
        </div>

        <div className="max-h-80 overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-[var(--color-text-muted)]">
              No matches.
            </div>
          ) : (
            Object.entries(grouped).map(([group, groupItems]) => (
              <div key={group} className="mb-1.5 last:mb-0">
                <div className="px-2 py-1 text-[0.65rem] font-medium uppercase tracking-wider text-[var(--color-text-faint)]">
                  {group}
                </div>
                {groupItems.map((item) => {
                  cursor++;
                  const isActive = cursor === activeIndex;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        void item.run();
                        setOpen(false);
                      }}
                      onMouseMove={() => setActiveIndex(cursor)}
                      className={cn(
                        "w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm text-left transition-colors",
                        isActive
                          ? "bg-[var(--color-bg-card-hover)] text-[var(--color-text-primary)]"
                          : "text-[var(--color-text-secondary)]",
                      )}
                    >
                      <Icon
                        className={cn(
                          "size-4 shrink-0",
                          isActive
                            ? "text-[var(--color-accent)]"
                            : "text-[var(--color-text-muted)]",
                        )}
                      />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.shortcut && (
                        <kbd className="text-[0.6rem] font-mono text-[var(--color-text-faint)] bg-[var(--color-bg)] border border-[var(--color-border)] rounded px-1 py-0.5">
                          {item.shortcut}
                        </kbd>
                      )}
                      {isActive && (
                        <ArrowRight className="size-3 text-[var(--color-accent)] shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="border-t border-[var(--color-border)] px-3 py-2 flex items-center gap-3 text-[0.65rem] text-[var(--color-text-faint)]">
          <span>
            <kbd className="font-mono">↑↓</kbd> navigate
          </span>
          <span>
            <kbd className="font-mono">↵</kbd> run
          </span>
          <span>
            <kbd className="font-mono">esc</kbd> close
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
