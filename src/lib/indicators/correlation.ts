/**
 * Compute the Pearson correlation coefficient between two series of
 * daily returns.
 *
 * Each input is a series of prices (not returns). The function computes
 * daily percentage returns internally, then calculates correlation on those
 * returns. Both series must have the same length and at least 3 elements
 * (to produce at least 2 return values).
 *
 * Returns a value between -1 and 1, or NaN if the inputs are invalid or
 * either series has zero variance.
 */
export function computeCorrelation(
  seriesA: number[],
  seriesB: number[],
): number {
  if (seriesA.length !== seriesB.length) return NaN;
  if (seriesA.length < 3) return NaN;

  // Compute daily returns
  const returnsA: number[] = [];
  const returnsB: number[] = [];

  for (let i = 1; i < seriesA.length; i++) {
    if (seriesA[i - 1] === 0 || seriesB[i - 1] === 0) return NaN;
    returnsA.push((seriesA[i] - seriesA[i - 1]) / seriesA[i - 1]);
    returnsB.push((seriesB[i] - seriesB[i - 1]) / seriesB[i - 1]);
  }

  const n = returnsA.length;

  // Means
  const meanA = returnsA.reduce((s, v) => s + v, 0) / n;
  const meanB = returnsB.reduce((s, v) => s + v, 0) / n;

  // Covariance and standard deviations
  let cov = 0;
  let varA = 0;
  let varB = 0;

  for (let i = 0; i < n; i++) {
    const dA = returnsA[i] - meanA;
    const dB = returnsB[i] - meanB;
    cov += dA * dB;
    varA += dA * dA;
    varB += dB * dB;
  }

  if (varA === 0 || varB === 0) return NaN;

  return cov / (Math.sqrt(varA) * Math.sqrt(varB));
}
