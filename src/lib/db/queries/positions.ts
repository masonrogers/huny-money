import { and, eq, desc } from "drizzle-orm";
import { db } from "../index";
import { positions } from "../schema";
import type { NewPosition, Position } from "../schema";
import { getCurrentMode } from "@/lib/mode";

/**
 * Mode-aware position queries.
 *
 * The positions table holds rows for both paper and live modes (distinguished
 * by `paper_mode` boolean). Per STRATEGY.md §13.3, all production queries
 * MUST go through `positionsForCurrentMode()` which auto-filters by the
 * current execution mode.
 *
 * `positionsAllModes()` exists for analytics/diagnostics ONLY (e.g.,
 * cross-mode boot-rejection check, dashboard "show me both" views). It is
 * intentionally rare and grep-able. The CI lint rule (scripts/lint-queries.sh)
 * rejects any direct query of the `positions` table outside this file.
 */

// ---------------------------------------------------------------------------
// Mode-scoped (default)
// ---------------------------------------------------------------------------

export async function positionsForCurrentMode(): Promise<Position[]> {
  const mode = getCurrentMode();
  return db
    .select()
    .from(positions)
    .where(eq(positions.paperMode, mode === "paper"))
    .orderBy(desc(positions.entryTime));
}

export async function openPositionsForCurrentMode(): Promise<Position[]> {
  const mode = getCurrentMode();
  return db
    .select()
    .from(positions)
    .where(and(eq(positions.paperMode, mode === "paper"), eq(positions.status, "open")))
    .orderBy(desc(positions.entryTime));
}

export async function closedPositionsForCurrentMode(limit?: number): Promise<Position[]> {
  const mode = getCurrentMode();
  const q = db
    .select()
    .from(positions)
    .where(and(eq(positions.paperMode, mode === "paper"), eq(positions.status, "closed")))
    .orderBy(desc(positions.exitTime));
  return limit ? q.limit(limit) : q;
}

export async function positionByIdForCurrentMode(id: string): Promise<Position | null> {
  const mode = getCurrentMode();
  const rows = await db
    .select()
    .from(positions)
    .where(and(eq(positions.id, id), eq(positions.paperMode, mode === "paper")))
    .limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// All modes (analytics/diagnostics ONLY — rare, intentional, grep-able)
// ---------------------------------------------------------------------------

/**
 * Returns positions across BOTH paper and live modes.
 *
 * Use ONLY for:
 * - Cross-mode boot rejection check (boot in live mode discovers open paper
 *   positions, refuses to start)
 * - Analytics views that explicitly compare paper vs live history
 * - Dashboard pages that intentionally show both modes side-by-side
 *
 * Do NOT use for any code that takes trading action.
 */
export async function positionsAllModes(): Promise<Position[]> {
  return db.select().from(positions).orderBy(desc(positions.entryTime));
}

export async function openPositionsAllModes(): Promise<Position[]> {
  return db
    .select()
    .from(positions)
    .where(eq(positions.status, "open"))
    .orderBy(desc(positions.entryTime));
}

// ---------------------------------------------------------------------------
// Inserts/updates (always require explicit paperMode, no mode-scoping needed)
// ---------------------------------------------------------------------------

export async function insertPosition(row: NewPosition): Promise<Position> {
  const inserted = await db.insert(positions).values(row).returning();
  return inserted[0]!;
}

export async function updatePosition(
  id: string,
  patch: Partial<NewPosition>,
): Promise<Position | null> {
  const updated = await db
    .update(positions)
    .set(patch)
    .where(eq(positions.id, id))
    .returning();
  return updated[0] ?? null;
}
