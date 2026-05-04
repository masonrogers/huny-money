import { stateRead, stateWriter } from "@/lib/db/utils";

/**
 * Wake-up trigger debounce state.
 *
 * Stored in the `state` table as one key per (triggerType, asset) pair.
 * Per STRATEGY.md §5.5:
 * - position_move: 60-min debounce per asset
 * - news_keyword: 30-min debounce per keyword
 * - stop_fill: NO debounce (every fill triggers a wake-up)
 *
 * State persists across restarts so a volatile asset doesn't bypass the
 * debounce by exploiting a deploy.
 */

export type TriggerKey = "position_move" | "news_keyword";

export const DEBOUNCE_WINDOW_MS: Record<TriggerKey, number> = {
  position_move: 60 * 60 * 1000, // 60 minutes
  news_keyword: 30 * 60 * 1000, // 30 minutes
};

function debounceStateKey(triggerType: TriggerKey, identifier: string): string {
  // Identifier is asset for position_move, keyword for news_keyword.
  return `last_wakeup_${triggerType}_${identifier.toLowerCase()}_at`;
}

export async function isDebounced(
  triggerType: TriggerKey,
  identifier: string,
  now: Date = new Date(),
): Promise<{ debounced: boolean; lastFiredAt: Date | null; remainingMs: number }> {
  const last = await stateRead<string>(debounceStateKey(triggerType, identifier));
  if (!last) {
    return { debounced: false, lastFiredAt: null, remainingMs: 0 };
  }
  const lastDate = new Date(last);
  const elapsed = now.getTime() - lastDate.getTime();
  const window = DEBOUNCE_WINDOW_MS[triggerType];
  if (elapsed >= window) {
    return { debounced: false, lastFiredAt: lastDate, remainingMs: 0 };
  }
  return { debounced: true, lastFiredAt: lastDate, remainingMs: window - elapsed };
}

export async function markFired(
  triggerType: TriggerKey,
  identifier: string,
  at: Date = new Date(),
): Promise<void> {
  await stateWriter({
    key: debounceStateKey(triggerType, identifier),
    value: at.toISOString(),
    changedBy: "triggers.debounce.markFired",
  });
}
