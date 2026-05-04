"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { NAV_ITEMS } from "./nav-config";

/**
 * "g + letter" navigation shortcuts. Press 'g', then within 1.5s press one
 * of the nav-letter keys to jump to that route.
 *
 * Cmd+K opens the command palette (Phase 8 wires up the actual palette;
 * this just dispatches the open intent for now).
 *
 * Listeners are attached at body level. Inputs and contenteditable elements
 * are explicitly ignored so typing in the dashboard doesn't trigger nav.
 */
export function KeyboardShortcuts() {
  const router = useRouter();
  const gPressedAt = useRef<number | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore when focus is on an input/textarea/contenteditable.
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select") return;
        if (target.isContentEditable) return;
      }

      // Cmd/Ctrl+K → command palette
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        // Phase 8 hook — for now just emit an event the palette can listen for.
        window.dispatchEvent(new CustomEvent("hm:open-command-palette"));
        return;
      }

      // 'g' starts a nav chord
      if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "g") {
        gPressedAt.current = Date.now();
        return;
      }

      // Letter following 'g' within 1500ms
      if (gPressedAt.current && Date.now() - gPressedAt.current < 1500) {
        const letter = e.key.toLowerCase();
        gPressedAt.current = null;
        const target = NAV_ITEMS.find((n) => n.shortcut === letter);
        if (target) {
          e.preventDefault();
          router.push(target.href);
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [router]);

  return null;
}
