import { describe, expect, test } from "bun:test";
import type { LiftSet } from "../../../../contract";
import type { Row } from "./plan";
import { currentEntry, nextPlanned, stepReps, stepWeight, summariseSets } from "./session";

type Shorthand = Pick<LiftSet, "weightKg" | "reps" | "rpe" | "kind">;
const work = (weightKg: number, reps: number, rpe: number | null = null): Shorthand => ({
  weightKg,
  reps,
  rpe,
  kind: "work",
});

const logged = (index: number): Row => ({
  kind: "logged",
  index,
  set: {
    id: `set-${index}`,
    entryId: "entry",
    position: index,
    weightKg: 100,
    reps: 5,
    rpe: 8,
    kind: "work",
    loggedAt: "2026-11-16T18:00:00.000Z",
  },
  previous: null,
});
const planned = (index: number): Row => ({
  kind: "planned",
  index,
  values: { weightKg: 100, reps: 5, rpe: null, kind: "work" },
  previous: null,
});

describe("stepWeight", () => {
  test("steps on the 10 g grid and stays within what the log takes", () => {
    expect(stepWeight(0.1, 0.2)).toBe(0.3);
    expect(stepWeight(100, -2.5)).toBe(97.5);
    expect(stepWeight(2.5, -5)).toBe(0);
    expect(stepWeight(999, 5)).toBe(1000);
    expect(stepReps(0, -1)).toBe(0);
    expect(stepReps(8, 1)).toBe(9);
  });
});

describe("currentEntry", () => {
  const entries = [
    { id: "squat", rows: [logged(0), logged(1)] },
    { id: "rdl", rows: [logged(0), planned(1)] },
    { id: "press", rows: [planned(0)] },
  ];
  const rowsOf = (entry: (typeof entries)[number]) => entry.rows;

  test("is the first exercise with a set still to do", () => {
    expect(currentEntry(entries, rowsOf, null)?.id).toBe("rdl");
    expect(nextPlanned(entries[1]?.rows ?? [])?.index).toBe(1);
  });

  test("is the one chosen while it is still there", () => {
    expect(currentEntry(entries, rowsOf, "squat")?.id).toBe("squat");
    expect(currentEntry(entries, rowsOf, "gone")?.id).toBe("rdl");
  });

  test("is the last when everything is done, and nothing in an empty workout", () => {
    expect(currentEntry(entries.slice(0, 1), rowsOf, null)?.id).toBe("squat");
    expect(currentEntry([], rowsOf, null)).toBeNull();
  });
});

describe("summariseSets", () => {
  test("runs equal sets together and gives the range of effort", () => {
    expect(summariseSets([work(140, 5, 7.5), work(140, 5, 8), work(140, 5, 8.5), work(130, 8)])).toBe(
      "3 × 140×5, 130×8 @7.5–8.5",
    );
    expect(summariseSets([work(100, 8, 8)])).toBe("100×8 @8");
    expect(summariseSets([{ ...work(60, 5), kind: "warmup" }])).toBe("");
  });
});
