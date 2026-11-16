import { describe, expect, test } from "bun:test";
import type { LiftSet } from "../../../../contract";
import type { Row } from "./plan";
import { currentEntry, nextPlanned, setName, summariseSets } from "./session";

type Shorthand = Pick<LiftSet, "weightKg" | "reps" | "seconds" | "rpe" | "kind">;
const work = (weightKg: number, reps: number, rpe: number | null = null): Shorthand => ({
  weightKg,
  reps,
  seconds: null,
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
    loadKg: 100,
    reps: 5,
    seconds: null,
    rpe: 8,
    kind: "work",
    loggedAt: "2026-11-16T18:00:00.000Z",
  },
  previous: null,
});
const planned = (index: number): Row => ({
  kind: "planned",
  index,
  values: { weightKg: 100, reps: 5, seconds: null, rpe: null, kind: "work" },
  previous: null,
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
  const barbell = { bodyweight: false };

  test("runs equal sets together and gives the range of effort", () => {
    expect(summariseSets([work(140, 5, 7.5), work(140, 5, 8), work(140, 5, 8.5), work(130, 8)], barbell)).toBe(
      "3 × 140×5, 130×8 @7.5–8.5",
    );
    expect(summariseSets([work(100, 8, 8)], barbell)).toBe("100×8 @8");
    expect(summariseSets([{ ...work(60, 5), kind: "warmup" }], barbell)).toBe("");
  });

  test("writes bodyweight loads and times as they were lifted", () => {
    const held = (seconds: number) => ({ ...work(0, 0), reps: null, seconds });
    expect(summariseSets([work(0, 8), work(10, 5), work(10, 5)], { bodyweight: true })).toBe("BW×8, 2 × BW+10×5");
    expect(summariseSets([held(60), held(60), held(45)], { bodyweight: true })).toBe("2 × BW×60s, BW×45s");
  });
});

describe("setName", () => {
  test("counts work sets among themselves and names warm-ups", () => {
    const warmup: Row = {
      kind: "planned",
      index: 0,
      values: { weightKg: 60, reps: 5, seconds: null, rpe: null, kind: "warmup" },
      previous: null,
    };
    const rows = [warmup, { ...logged(1), index: 1 }, planned(2)];
    expect(rows.map((row) => setName(rows, row.index))).toEqual(["warm-up", "set 1", "set 2"]);
  });
});
