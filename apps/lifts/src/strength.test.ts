import { describe, expect, test } from "bun:test";
import type { LiftSet } from "./contract";
import { bestEstimate, estimatedMax, isRecord, repRecords, tonnage } from "./strength";

type Shorthand = { loadKg: number | null } & Pick<LiftSet, "reps" | "rpe" | "kind">;

const work = (loadKg: number, reps: number, rpe: number | null = null): Shorthand => ({
  loadKg,
  reps,
  rpe,
  kind: "work",
});
const warmup = (loadKg: number, reps: number): Shorthand => ({ loadKg, reps, rpe: null, kind: "warmup" });
const timed: Shorthand = { loadKg: 40, reps: null, rpe: null, kind: "work" };

describe("estimatedMax", () => {
  test("follows the RPE chart, in whole and half steps", () => {
    expect(estimatedMax(work(100, 1, 10))).toBe(100);
    expect(estimatedMax(work(86.3, 5, 10))).toBeCloseTo(100, 5);
    expect(estimatedMax(work(81.1, 5, 8))).toBeCloseTo(100, 5);
    expect(estimatedMax(work(93.85, 1, 8.5))).toBeCloseTo(100, 5);
    expect(estimatedMax(work(82.4, 4, 7.5))).toBeCloseTo(100, 5);
  });

  test("takes a set without an RPE as all-out", () => {
    expect(estimatedMax(work(140, 3))).toBe(estimatedMax(work(140, 3, 10)));
  });

  test("says nothing of a miss, or of a set beyond the chart", () => {
    expect(estimatedMax(work(200, 0))).toBeNull();
    expect(estimatedMax(work(60, 17))).toBeNull();
    expect(estimatedMax(work(60, 12, 5))).toBeNull();
    expect(estimatedMax(work(60, 16))).toBeCloseTo(60 / 0.572, 5);
  });

  test("says nothing of a timed set, or of one whose load is not known", () => {
    expect(estimatedMax(timed)).toBeNull();
    expect(estimatedMax({ ...work(0, 5), loadKg: null })).toBeNull();
  });
});

describe("bestEstimate", () => {
  test("picks the work set implying the most, ignoring warm-ups", () => {
    const top = work(140, 5, 8);
    expect(bestEstimate([warmup(180, 1), work(140, 1, 6), top, work(130, 5, 8)])?.set).toBe(top);
    expect(bestEstimate([warmup(100, 5), work(100, 0)])).toBeNull();
  });
});

describe("repRecords", () => {
  test("keeps the heaviest set at each rep count that no longer set matches", () => {
    const records = repRecords([
      work(100, 5),
      work(110, 3),
      work(100, 3),
      work(105, 1),
      work(120, 1),
      warmup(150, 1),
      work(90, 8),
      work(90, 6),
    ]);

    expect(records.map(({ reps, loadKg }) => [reps, loadKg])).toEqual([
      [1, 120],
      [3, 110],
      [5, 100],
      [8, 90],
    ]);
  });

  test("leaves out timed sets and sets of unknown load", () => {
    expect(repRecords([timed, { ...work(0, 5), loadKg: null }])).toEqual([]);
  });
});

describe("tonnage", () => {
  test("adds up the work sets", () => {
    expect(tonnage([warmup(60, 5), work(100, 5), work(102.5, 4)])).toBe(910);
  });

  test("leaves out timed sets and sets of unknown load", () => {
    expect(tonnage([work(100, 5), timed, { ...work(0, 5), loadKg: null }])).toBe(500);
  });
});

describe("isRecord", () => {
  test("holds for a work set that beats every earlier estimate, and never on a first session", () => {
    const before = [work(140, 5, 8), warmup(200, 1)];

    expect(isRecord(work(145, 5, 8), before)).toBe(true);
    expect(isRecord(work(140, 5, 8), before)).toBe(false);
    expect(isRecord(warmup(180, 5), before)).toBe(false);
    expect(isRecord(work(145, 5, 8), [])).toBe(false);
  });
});
