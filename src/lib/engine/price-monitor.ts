import { getTicker } from '@/lib/coinbase/market-data';
import { getState, setState, getMultipleStates } from '@/lib/db/queries/system-state';
import { createTimer } from '@/lib/db/queries/timers';
import { EMERGENCY_THRESHOLD_PCT } from '@/lib/constants';

// ─── Types ────────────────────────────────────────────────────────────────────

interface EmergencyTrigger {
  asset: string;
  priceChange: number;
  direction: string;
}

interface EmergencyCheckResult {
  triggered: boolean;
  triggers: EmergencyTrigger[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MONITORED_ASSETS = ['BTC-USD', 'ETH-USD', 'SOL-USD'] as const;

/** System state keys for last-known prices at eval time */
function lastPriceKey(asset: string): string {
  // Normalize: "BTC-USD" -> "last_btc_price_at_eval", "BTC" -> "last_btc_price_at_eval"
  const base = asset.replace('-USD', '').toLowerCase();
  return `last_${base}_price_at_eval`;
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export async function checkEmergencyThresholds(): Promise<EmergencyCheckResult> {
  const triggers: EmergencyTrigger[] = [];

  // Build the list of state keys we need
  const stateKeys = MONITORED_ASSETS.map((a) => lastPriceKey(a));
  const savedPrices = await getMultipleStates(stateKeys);

  for (const productId of MONITORED_ASSETS) {
    try {
      // 1. Get current price from Coinbase ticker
      const ticker = await getTicker(productId);
      const currentPrice = ticker.lastPrice > 0 ? ticker.lastPrice : ticker.bestBid;

      if (currentPrice <= 0) {
        console.warn(`[PriceMonitor] Invalid price for ${productId}: ${currentPrice}`);
        continue;
      }

      const key = lastPriceKey(productId);
      const savedPriceStr = savedPrices[key];

      // 2. If no saved price, store current and skip comparison
      if (!savedPriceStr) {
        await setState(key, String(currentPrice));
        continue;
      }

      const lastPrice = Number(savedPriceStr);

      if (lastPrice <= 0) {
        await setState(key, String(currentPrice));
        continue;
      }

      // 3. Compute % change
      const pctChange = (currentPrice - lastPrice) / lastPrice;
      const absPctChange = Math.abs(pctChange);

      // 4. Check against emergency threshold
      if (absPctChange > EMERGENCY_THRESHOLD_PCT) {
        const assetName = productId.replace('-USD', '');
        const direction = pctChange > 0 ? 'up' : 'down';

        triggers.push({
          asset: assetName,
          priceChange: pctChange,
          direction,
        });

        console.log(
          `[PriceMonitor] EMERGENCY: ${assetName} moved ${(pctChange * 100).toFixed(2)}% ` +
            `(${direction}) since last eval: $${lastPrice.toFixed(2)} -> $${currentPrice.toFixed(2)}`,
        );
      }

      // 5. Update saved price regardless of trigger
      await setState(key, String(currentPrice));
    } catch (err) {
      console.error(`[PriceMonitor] Error checking ${productId}:`, err);
    }
  }

  // 6. If any triggered, create an evaluation timer for NOW
  if (triggers.length > 0) {
    await createTimer({
      type: 'evaluation',
      target_time: new Date(), // NOW
      related_entity: JSON.stringify({
        reason: 'emergency_price_movement',
        triggers: triggers.map((t) => ({
          asset: t.asset,
          pct_change: (t.priceChange * 100).toFixed(2) + '%',
          direction: t.direction,
        })),
        threshold: `${(EMERGENCY_THRESHOLD_PCT * 100).toFixed(0)}%`,
      }),
    });

    console.log(
      `[PriceMonitor] Emergency evaluation timer created for ${triggers.length} trigger(s)`,
    );
  }

  return {
    triggered: triggers.length > 0,
    triggers,
  };
}
