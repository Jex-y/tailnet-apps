import { describe, expect, test } from "bun:test";
import type { LiftSet, Workout } from "../../../../contract";
import type { LoggedSet } from "../../../../log";
import { trend } from "../../../../trend";
import { niceTicks } from "./chart";

const workout = (date: string): Workout => ({ id: date, date, finishedAt: null, notes: "", bodyweightKg: null });
const set = (weightKg: number, reps: number, kind: LiftSet["kind"] = "work"): LoggedSet => ({
  id: `${weightKg}x${reps}`,
  entryId: "entry",
  position: 0,
  weightKg,
  loadKg: weightKg,
  reps,
  seconds: null,
  rpe: 10,
  kind,
  loggedAt: "2026-10-01T18:00:00.000Z",
});

describe("trend", () => {
  test("takes each session's best estimate, skipping sessions without one", () => {
    const top = set(150, 1);
    const points = trend([
      { workout: workout("2026-09-24"), sets: [set(140, 1), top] },
      { workout: workout("2026-09-27"), sets: [set(100, 5, "warmup"), set(160, 0)] },
      { workout: workout("2026-10-01"), sets: [set(155, 1)] },
    ]);

    expect(points.map(({ date, maxKg }) => [date, maxKg])).toEqual([
      ["2026-09-24", 150],
      ["2026-10-01", 155],
    ]);
    expect(points[0]?.set).toBe(top);
  });
});

describe("niceTicks", () => {
  test("brackets the range in round steps", () => {
    expect(niceTicks(152, 171, 4)).toEqual([150, 155, 160, 165, 170, 175]);
    expect(niceTicks(100, 100, 4)).toEqual([100, 120]);
  });
});
