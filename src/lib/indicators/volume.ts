/**
 * Compute volume ratio: current volume divided by the average volume
 * over the last `lookback` periods.
 *
 * "Current volume" is the last element in the array.
 * "Average volume" is the mean of the preceding `lookback` elements.
 *
 * Returns NaN if there are fewer than `lookback + 1` values (need at least
 * `lookback` historical values plus the current one).
 */
export function computeVolumeRatio(
  volumes: number[],
  lookback: number = 20,
): number {
  if (volumes.length < lookback + 1) return NaN;

  const current = volumes[volumes.length - 1];
  const historicalSlice = volumes.slice(-(lookback + 1), -1);
  const avg =
    historicalSlice.reduce((sum, v) => sum + v, 0) / historicalSlice.length;

  if (avg === 0) return current === 0 ? 1 : Infinity;

  return current / avg;
}
