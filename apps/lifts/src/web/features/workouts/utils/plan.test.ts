import { describe, expect, test } from "bun:test";
import type { LiftSet } from "../../../../contract";
import type { WorkoutDetail } from "../../../../log";
import { doneRows, lastSession, NO_INTENT, openRows, type Row, startingPoints, valuesOf, withChange } from "./plan";

const exercise = (id: string) => ({ id, name: id, lift: null, weightStepKg: 2.5 });

const set = (weightKg: number, reps: number, fields: Partial<LiftSet> = {}): LiftSet => ({
  id: `${weightKg}x${reps}@${fields.position ?? 0}`,
  entryId: "entry",
  position: 0,
  weightKg,
  reps,
  rpe: 8,
  kind: "work",
  loggedAt: "2026-10-01T18:00:00.000Z",
  ...fields,
});

const workout = (id: string, date: string, trained: Record<string, LiftSet[]>, finished = true): WorkoutDetail => ({
  id,
  date,
  finishedAt: finished ? `${date}T19:00:00.000Z` : null,
  notes: "",
  bodyweightKg: null,
  entries: Object.entries(trained).map(([name, sets], position) => ({
    id: `${id}-${name}`,
    workoutId: id,
    exerciseId: name,
    position,
    notes: "",
    exercise: exercise(name),
    sets,
  })),
});

const brief = (rows: readonly Row[]) =>
  rows.map((row) =>
    row.kind === "logged"
      ? `done ${row.set.weightKg}x${row.set.reps}`
      : `${row.values.kind === "warmup" ? "warm " : ""}${row.values.weightKg}x${row.values.reps}`,
  );

const lastTime = [
  set(60, 5, { kind: "warmup", position: 0 }),
  set(140, 5, { position: 1 }),
  set(140, 5, { position: 2 }),
  set(140, 4, { position: 3, rpe: 9.5 }),
];

describe("lastSession", () => {
  const history = [
    workout("a", "2026-09-17", { squat: [set(130, 5)] }),
    workout("b", "2026-09-24", { squat: [set(135, 5)] }),
    workout("c", "2026-10-01", { squat: [] }),
    workout("d", "2026-10-08", { squat: [set(150, 1)] }),
  ];

  test("finds the latest earlier workout that trained the exercise", () => {
    expect(lastSession(history, { id: "c", date: "2026-10-01" }, "squat")?.workout.id).toBe("b");
    expect(lastSession(history, { id: "a", date: "2026-09-17" }, "squat")).toBeNull();
    expect(lastSession(history, { id: "c", date: "2026-10-01" }, "bench")).toBeNull();
  });
});

describe("openRows", () => {
  test("lays out last session's sets to do again, each without its RPE", () => {
    const rows = openRows([], lastTime, NO_INTENT);

    expect(brief(rows)).toEqual(["warm 60x5", "140x5", "140x5", "140x4"]);
    expect(rows.every((row) => row.kind === "planned" && row.values.rpe === null)).toBe(true);
    expect(rows.map((row) => row.previous)).toEqual(lastTime);
  });

  test("offers one set from the empty bar when the exercise is new", () => {
    expect(brief(openRows([], [], NO_INTENT))).toEqual(["20x5"]);
  });

  test("keeps sets done where they were logged, with the rest still to do around them", () => {
    const done = [set(60, 5, { kind: "warmup", position: 0 }), set(145, 5, { position: 2 })];

    expect(brief(openRows(done, lastTime, NO_INTENT))).toEqual(["done 60x5", "140x5", "done 145x5", "145x4"]);
  });

  test("moves the sets to do along with a set done at a new weight, and only those that shared its old one", () => {
    const done = [set(60, 5, { kind: "warmup", position: 0 }), set(142.5, 5, { position: 1 })];

    expect(brief(openRows(done, lastTime, NO_INTENT))).toEqual(["done 60x5", "done 142.5x5", "142.5x5", "142.5x4"]);
    expect(brief(openRows([set(70, 5, { kind: "warmup", position: 0 })], lastTime, NO_INTENT))).toEqual([
      "done 70x5",
      "140x5",
      "140x5",
      "140x4",
    ]);
  });

  test("gives sets logged at the same place a row each", () => {
    const done = [set(100, 5, { id: "a", position: 0 }), set(105, 5, { id: "b", position: 0 })];

    expect(brief(openRows(done, [], NO_INTENT))).toEqual(["done 100x5", "done 105x5"]);
  });

  test("adds sets beyond last session's as repeats of the row above", () => {
    const rows = openRows([set(150, 3, { position: 0 })], [set(140, 5)], { ...NO_INTENT, extra: 2 });

    expect(brief(rows)).toEqual(["done 150x3", "150x3", "150x3"]);
  });
});

describe("withChange", () => {
  test("carries a new weight down the matching sets still to do, leaving warm-ups and sets done alone", () => {
    const done = [set(140, 5, { position: 1 })];
    const rows = openRows(done, lastTime, NO_INTENT);

    const raised = withChange(rows, NO_INTENT, 2, { weightKg: 142.5 });

    expect(brief(openRows(done, lastTime, raised))).toEqual(["warm 60x5", "done 140x5", "142.5x5", "142.5x4"]);
  });

  test("carries reps only to sets that had the same count", () => {
    const rows = openRows([], lastTime, NO_INTENT);

    const fewer = withChange(rows, NO_INTENT, 1, { reps: 3 });

    expect(brief(openRows([], lastTime, fewer))).toEqual(["warm 60x5", "140x3", "140x3", "140x4"]);
  });
});

describe("doneRows", () => {
  test("lists only the sets done, in order, against last session's", () => {
    const done = [set(145, 5, { position: 2 }), set(60, 5, { position: 0 })];

    const rows = doneRows(done, lastTime);

    expect(brief(rows)).toEqual(["done 60x5", "done 145x5"]);
    expect(rows[1]?.previous).toBe(lastTime[1] ?? null);
  });
});

describe("startingPoints", () => {
  test("offers the latest finished workout of each distinct line-up of exercises actually trained", () => {
    const history = [
      workout("a", "2026-09-21", { squat: [set(1, 1)], bench: [set(1, 1)] }),
      workout("b", "2026-09-24", { deadlift: [set(1, 1)] }),
      workout("c", "2026-09-28", { squat: [set(1, 1)], bench: [set(1, 1)], row: [] }),
      workout("d", "2026-10-01", { deadlift: [set(1, 1)] }, false),
      workout("e", "2026-10-01", { press: [] }),
    ];

    expect(startingPoints(history, 3).map((each) => each.id)).toEqual(["c", "b"]);
    expect(startingPoints(history, 1).map((each) => each.id)).toEqual(["c"]);
  });
});

describe("valuesOf", () => {
  test("takes a logged set's values without its identity, so they can be logged afresh", () => {
    const logged = set(100, 5, { position: 3 });
    expect(valuesOf({ kind: "logged", index: 3, set: logged, previous: null })).toEqual({
      weightKg: 100,
      reps: 5,
      rpe: 8,
      kind: "work",
    });
  });
});
