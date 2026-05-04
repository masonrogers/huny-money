/**
 * Volume helpers.
 */

/** Average volume over the last `period` bars. */
export function avgVolume(volumes: readonly number[], period: number): number | null {
  if (volumes.length < period) return null;
  let sum = 0;
  for (let i = volumes.length - period; i < volumes.length; i++) sum += volumes[i]!;
  return sum / period;
}

/**
 * Ratio of recent (`recentPeriod`) avg volume vs. baseline (`baselinePeriod`)
 * avg volume. Used as a "is this asset getting attention?" signal in the
 * cycle entry criteria (STRATEGY.md §3.4 step 3 — needs > 1.20).
 */
export function volumeRatio(
  volumes: readonly number[],
  recentPeriod: number,
  baselinePeriod: number,
): number | null {
  if (volumes.length < baselinePeriod) return null;
  const recent = avgVolume(volumes, recentPeriod);
  const baseline = avgVolume(volumes, baselinePeriod);
  if (recent == null || baseline == null || baseline === 0) return null;
  return recent / baseline;
}
