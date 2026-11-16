/** The 0.975 quantile of Student's t for 1 to 30 degrees of freedom, where a series expansion is too rough. */
const T_975 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11,
  2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
] as const;

const Z_975 = 1.959964;

/**
 * The multiplier of a standard error that gives a two-sided 95% interval with `df` degrees of freedom: from the table
 * up to 30, then by the Cornish–Fisher expansion about the normal, which is within 0.001 of it from there.
 */
export const t975 = (df: number): number => {
  const tabled = T_975[Math.floor(df) - 1];
  if (tabled !== undefined) {
    return tabled;
  }
  const z = Z_975;
  return (
    z +
    (z ** 3 + z) / (4 * df) +
    (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2) +
    (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / (384 * df ** 3) +
    (79 * z ** 9 + 776 * z ** 7 + 1482 * z ** 5 - 1920 * z ** 3 - 945 * z) / (92160 * df ** 4)
  );
};

export type Point = { readonly x: number; readonly y: number };

/** An ordinary least-squares line, with the intervals that go with it. Half-widths are of 95% intervals. */
export type LinearFit = {
  readonly n: number;
  readonly df: number;
  readonly slope: number;
  readonly intercept: number;
  /** The residual standard deviation, the scatter of single points about the line. */
  readonly residualSd: number;
  /** The share of the variance in y the line accounts for; 1 when y does not vary. */
  readonly r2: number;
  /** Each point's distance above the line, in the order given. */
  readonly residuals: readonly number[];
  readonly slopeStandardError: number;
  readonly slopeHalfWidth: number;
  readonly at: (x: number) => number;
  /** The standard error of the line itself at x. */
  readonly standardError: (x: number) => number;
  /** Where the line itself lies at x. */
  readonly confidenceHalfWidth: (x: number) => number;
  /** Where one new point at x lies. */
  readonly predictionHalfWidth: (x: number) => number;
};

/** Fits y = intercept + slope · x. `null` with fewer than three points, or with every x the same. */
export const linearFit = (points: readonly Point[]): LinearFit | null => {
  const n = points.length;
  if (n < 3) {
    return null;
  }
  const meanX = points.reduce((sum, { x }) => sum + x, 0) / n;
  const meanY = points.reduce((sum, { y }) => sum + y, 0) / n;
  const sxx = points.reduce((sum, { x }) => sum + (x - meanX) ** 2, 0);
  if (sxx === 0) {
    return null;
  }
  const sxy = points.reduce((sum, { x, y }) => sum + (x - meanX) * (y - meanY), 0);
  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  const at = (x: number) => intercept + slope * x;
  const residuals = points.map(({ x, y }) => y - at(x));
  const sse = residuals.reduce((sum, residual) => sum + residual ** 2, 0);
  const sst = points.reduce((sum, { y }) => sum + (y - meanY) ** 2, 0);
  const df = n - 2;
  const residualSd = Math.sqrt(sse / df);
  const t = t975(df);
  const leverage = (x: number) => 1 / n + (x - meanX) ** 2 / sxx;
  const standardError = (x: number) => residualSd * Math.sqrt(leverage(x));
  const slopeStandardError = residualSd / Math.sqrt(sxx);

  return {
    n,
    df,
    slope,
    intercept,
    residualSd,
    r2: sst === 0 ? 1 : 1 - sse / sst,
    residuals,
    slopeStandardError,
    slopeHalfWidth: t * slopeStandardError,
    at,
    standardError,
    confidenceHalfWidth: (x) => t * standardError(x),
    predictionHalfWidth: (x) => t * residualSd * Math.sqrt(1 + leverage(x)),
  };
};

/** An estimate with its standard error and the degrees of freedom behind it. */
export type Estimate = { readonly value: number; readonly standardError: number; readonly df: number };

/**
 * The sum of independent estimates and the half-width of its 95% interval. The variances add; the interval takes
 * the fewest degrees of freedom among them, which errs wide rather than narrow.
 */
export const sumOfEstimates = (
  estimates: readonly Estimate[],
): { readonly value: number; readonly halfWidth: number } => ({
  value: estimates.reduce((sum, { value }) => sum + value, 0),
  halfWidth:
    t975(Math.min(...estimates.map(({ df }) => df))) *
    Math.sqrt(estimates.reduce((sum, { standardError }) => sum + standardError ** 2, 0)),
});

/** The mean of a sample and the half-width of its 95% t interval; `null` for a half-width with fewer than two. */
export const meanInterval = (
  values: readonly number[],
): { readonly mean: number; readonly halfWidth: number | null } | null => {
  const n = values.length;
  if (n === 0) {
    return null;
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  if (n < 2) {
    return { mean, halfWidth: null };
  }
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
  return { mean, halfWidth: (t975(n - 1) * Math.sqrt(variance)) / Math.sqrt(n) };
};
