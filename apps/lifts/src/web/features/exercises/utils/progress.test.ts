import { describe, expect, test } from "bun:test";
import { linearFit } from "../../../../fit";
import type { LoggedSet } from "../../../../log";
import { maxShare } from "../../../../strength";
import { type TrendPoint, trendOver, weeksFrom } from "../../../../trend";
import { atTodaysLevel, repProfile } from "./progress";

const point = (date: string, maxKg: number): TrendPoint => ({
  date,
  maxKg,
  set: {
    id: date,
    entryId: "entry",
    position: 0,
    weightKg: maxKg,
    loadKg: maxKg,
    reps: 1,
    seconds: null,
    rpe: 10,
    kind: "work",
    loggedAt: `${date}T18:00:00.000Z`,
  },
});

/** A session every Monday for `count` weeks up to 2026-11-16, its max rising a kilo a week, with a little wobble. */
const weekly = (count: number) =>
  Array.from({ length: count }, (_, index) => {
    const weeksAgo = count - 1 - index;
    const date = new Date(Date.UTC(2026, 10, 16 - 7 * weeksAgo)).toISOString().slice(0, 10);
    return point(date, 170 - weeksAgo + (index % 2 === 0 ? 0.5 : -0.5));
  });

describe("weeksFrom", () => {
  test("counts weeks back from today as negative", () => {
    expect(weeksFrom("2026-11-02", "2026-11-16")).toBe(-2);
    expect(weeksFrom("2026-11-16", "2026-11-16")).toBe(0);
  });
});

describe("trendOver", () => {
  test("fits only the sessions within the window, with today at zero", () => {
    const trend = trendOver(weekly(20), "2026-11-16", 12);
    expect(trend.points).toHaveLength(13);
    expect(trend.points[0]?.x).toBe(-12);
    expect(trend.fit?.slope).toBeCloseTo(1, 1);
    expect(trend.fit?.at(0)).toBeCloseTo(170, 0);
  });

  test("takes every session for the whole history", () => {
    expect(trendOver(weekly(20), "2026-11-16", null).points).toHaveLength(20);
  });

  test("calls the latest session a rise only beyond the prediction interval of those before it", () => {
    const history = weekly(10);
    const ordinary = trendOver(history, "2026-11-16", null);
    expect(ordinary.latest?.verdict).toBe("within");
    expect(ordinary.latest?.expectedKg).toBeCloseTo(170, 0);

    const jump = trendOver([...history.slice(0, -1), point("2026-11-16", 180)], "2026-11-16", null);
    expect(jump.latest?.verdict).toBe("above");

    const slump = trendOver([...history.slice(0, -1), point("2026-11-16", 160)], "2026-11-16", null);
    expect(slump.latest?.verdict).toBe("below");
  });

  test("has nothing to fit or check with too few sessions", () => {
    const trend = trendOver(weekly(3), "2026-11-16", null);
    expect(trend.fit).not.toBeNull();
    expect(trend.latest).toBeNull();
    expect(trendOver(weekly(2), "2026-11-16", null).fit).toBeNull();
  });
});

type Effort = Pick<LoggedSet, "loadKg" | "reps" | "rpe" | "kind">;

/** A set that is exactly what a max implies, scaled by `bias`. */
const implied = (maxKg: number, reps: number, rpe: number, bias = 1): Effort => ({
  loadKg: maxKg * (maxShare(reps, rpe) ?? 0) * bias,
  reps,
  rpe,
  kind: "work",
});

describe("repProfile", () => {
  test("recovers the max the sets were drawn from", () => {
    const profile = repProfile([implied(200, 1, 9), implied(200, 3, 8), implied(200, 5, 8), implied(200, 8, 7)]);
    expect(profile?.maxKg).toBeCloseTo(200, 8);
    expect(profile?.halfWidth).toBeCloseTo(0, 8);
  });

  test("flags a range only when its interval leaves out zero", () => {
    const sets = [
      ...[0.94, 0.95, 0.96].map((bias) => implied(200, 1, 9, bias)),
      ...[0.99, 1, 1.01].map((bias) => implied(200, 5, 8, bias)),
      ...[1.03, 1.04, 1.05].map((bias) => implied(200, 8, 7, bias)),
    ];
    const ranges = repProfile(sets)?.ranges ?? [];
    expect(ranges.map(({ label, n, verdict }) => [label, n, verdict])).toEqual([
      ["1–3", 3, "weak"],
      ["4–6", 3, "level"],
      ["7+", 3, "strong"],
    ]);
  });

  test("leaves out warm-ups and sets the chart cannot read", () => {
    const profile = repProfile([
      implied(200, 3, 8),
      implied(200, 5, 8),
      { loadKg: 60, reps: 5, rpe: null, kind: "warmup" },
      { loadKg: 60, reps: 20, rpe: null, kind: "work" },
      { loadKg: 60, reps: null, rpe: null, kind: "work" },
      { loadKg: null, reps: 5, rpe: null, kind: "work" },
    ]);
    expect(profile?.sets).toHaveLength(2);
    expect(profile?.ranges.map(({ n }) => n)).toEqual([1, 1, 0]);
    expect(profile?.ranges[0]?.verdict).toBeNull();
    expect(repProfile([implied(200, 3, 8)])).toBeNull();
  });
});

describe("atTodaysLevel", () => {
  const session = (date: string, weightKg: number) => ({
    workout: { id: date, date, finishedAt: `${date}T19:00:00.000Z`, notes: "", bodyweightKg: null },
    sets: [{ ...point(date, weightKg).set }],
  });

  test("carries each set along the trend to today", () => {
    const fit = linearFit([
      { x: -2, y: 180 },
      { x: -1, y: 190 },
      { x: 0, y: 200 },
    ]);
    const sets = atTodaysLevel([session("2026-11-02", 90), session("2026-11-16", 100)], fit, "2026-11-16");
    expect(sets.map(({ loadKg }) => loadKg)).toEqual([100, 100]);
  });

  test("leaves sets as lifted without a trend", () => {
    expect(atTodaysLevel([session("2026-11-02", 90)], null, "2026-11-16")[0]?.loadKg).toBe(90);
  });
});
