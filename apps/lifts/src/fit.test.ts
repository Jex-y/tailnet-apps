import { describe, expect, test } from "bun:test";
import { linearFit, meanInterval, sumOfEstimates, t975 } from "./fit";

/** A seeded uniform generator (mulberry32), so the simulations below are the same on every run. */
const uniform = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const normal = (next: () => number) => () =>
  Math.sqrt(-2 * Math.log(next() || Number.MIN_VALUE)) * Math.cos(2 * Math.PI * next());

describe("t975", () => {
  test("matches published quantiles, in the table and beyond it", () => {
    expect(t975(1)).toBe(12.706);
    expect(t975(10)).toBe(2.228);
    expect(t975(31)).toBeCloseTo(2.0395, 3);
    expect(t975(60)).toBeCloseTo(2.0003, 3);
    expect(t975(120)).toBeCloseTo(1.9799, 3);
    expect(t975(1e6)).toBeCloseTo(1.96, 3);
  });
});

describe("linearFit", () => {
  const fit = linearFit([
    { x: 0, y: 1 },
    { x: 1, y: 3 },
    { x: 2, y: 2 },
    { x: 3, y: 5 },
  ]);

  test("finds the least-squares line and its scatter", () => {
    expect(fit?.slope).toBeCloseTo(1.1, 10);
    expect(fit?.intercept).toBeCloseTo(1.1, 10);
    expect(fit?.residuals.map((residual) => Number(residual.toFixed(10)))).toEqual([-0.1, 0.8, -1.3, 0.6]);
    expect(fit?.residualSd).toBeCloseTo(Math.sqrt(1.35), 10);
    expect(fit?.r2).toBeCloseTo(1 - 2.7 / 8.75, 10);
  });

  test("gives t intervals on n − 2 degrees of freedom", () => {
    const s = Math.sqrt(1.35);
    expect(fit?.df).toBe(2);
    expect(fit?.slopeHalfWidth).toBeCloseTo((4.303 * s) / Math.sqrt(5), 10);
    expect(fit?.confidenceHalfWidth(1.5)).toBeCloseTo(4.303 * s * Math.sqrt(1 / 4), 10);
    expect(fit?.predictionHalfWidth(1.5)).toBeCloseTo(4.303 * s * Math.sqrt(1 + 1 / 4), 10);
    expect(fit?.confidenceHalfWidth(3)).toBeGreaterThan(fit?.confidenceHalfWidth(1.5) ?? 0);
  });

  test("needs three points and some spread in x", () => {
    expect(
      linearFit([
        { x: 0, y: 1 },
        { x: 1, y: 2 },
      ]),
    ).toBeNull();
    expect(
      linearFit([
        { x: 1, y: 1 },
        { x: 1, y: 2 },
        { x: 1, y: 3 },
      ]),
    ).toBeNull();
    expect(
      linearFit([
        { x: 0, y: 4 },
        { x: 1, y: 4 },
        { x: 2, y: 4 },
      ])?.r2,
    ).toBe(1);
  });

  test("its intervals cover the truth about 95% of the time", () => {
    const noise = normal(uniform(42));
    const xs = Array.from({ length: 12 }, (_, index) => -index);
    const runs = 4000;
    let lineCovered = 0;
    let slopeCovered = 0;
    let nextCovered = 0;
    for (let run = 0; run < runs; run++) {
      const truth = (x: number) => 150 + 0.8 * x;
      const line = linearFit(xs.map((x) => ({ x, y: truth(x) + 2 * noise() })));
      if (line === null) {
        throw new Error("twelve spread points always fit");
      }
      lineCovered += Number(Math.abs(line.at(0) - truth(0)) <= line.confidenceHalfWidth(0));
      slopeCovered += Number(Math.abs(line.slope - 0.8) <= line.slopeHalfWidth);
      nextCovered += Number(Math.abs(truth(1) + 2 * noise() - line.at(1)) <= line.predictionHalfWidth(1));
    }
    for (const covered of [lineCovered, slopeCovered, nextCovered]) {
      expect(covered / runs).toBeGreaterThan(0.935);
      expect(covered / runs).toBeLessThan(0.965);
    }
  });
});

describe("sumOfEstimates", () => {
  test("adds values and variances, on the fewest degrees of freedom", () => {
    const sum = sumOfEstimates([
      { value: 100, standardError: 3, df: 20 },
      { value: 50, standardError: 4, df: 10 },
    ]);
    expect(sum.value).toBe(150);
    expect(sum.halfWidth).toBeCloseTo(2.228 * 5, 10);
  });
});

describe("meanInterval", () => {
  test("gives the mean with a t interval", () => {
    const interval = meanInterval([1, 2, 3]);
    expect(interval?.mean).toBe(2);
    expect(interval?.halfWidth).toBeCloseTo(4.303 / Math.sqrt(3), 10);
  });

  test("has no interval for one value, nor anything for none", () => {
    expect(meanInterval([5])).toEqual({ mean: 5, halfWidth: null });
    expect(meanInterval([])).toBeNull();
  });
});
