import { describe, expect, test } from "bun:test";
import type { Exercise } from "../../../../contract";
import type { LoggedSet, WorkoutDetail } from "../../../../log";
import { missingLifts, standings, summarise } from "./lifts";

const REPS = { measure: "reps", bodyweight: false } as const;
const squat: Exercise = { id: "squat", name: "Squat", lift: "squat", weightStepKg: 2.5, ...REPS };
const bench: Exercise = { id: "bench", name: "Bench press", lift: "bench", weightStepKg: 2.5, ...REPS };
const deadlift: Exercise = { id: "deadlift", name: "Deadlift", lift: "deadlift", weightStepKg: 2.5, ...REPS };
const curl: Exercise = { id: "curl", name: "Curl", lift: null, weightStepKg: 2.5, ...REPS };

const set = (weightKg: number, reps: number): LoggedSet => ({
  id: crypto.randomUUID(),
  entryId: "entry",
  position: 0,
  weightKg,
  loadKg: weightKg,
  reps,
  seconds: null,
  rpe: 10,
  kind: "work",
  loggedAt: "2026-10-01T18:00:00.000Z",
});

const workout = (date: string, trained: readonly (readonly [Exercise, LoggedSet[]])[]): WorkoutDetail => ({
  id: date,
  date,
  finishedAt: null,
  notes: "",
  bodyweightKg: null,
  entries: trained.map(([exercise, sets], position) => ({
    id: `${date}-${exercise.id}`,
    workoutId: date,
    exerciseId: exercise.id,
    position,
    notes: "",
    exercise,
    sets,
  })),
});

const workouts = [
  workout("2026-09-24", [[squat, [set(150, 1)]]]),
  workout("2026-10-01", [
    [squat, [set(140, 1)]],
    [bench, [set(100, 1)]],
  ]),
];

describe("summarise", () => {
  test("counts sessions and finds the latest day and best estimate", () => {
    expect(summarise([squat, curl], workouts)).toEqual([
      { exercise: squat, sessions: 2, lastTrainedOn: "2026-10-01", bestMaxKg: 150 },
      { exercise: curl, sessions: 0, lastTrainedOn: null, bestMaxKg: null },
    ]);
  });
});

describe("standings", () => {
  test("totals the three lifts only once each has an estimate", () => {
    expect(standings(summarise([squat, bench, deadlift], workouts))).toEqual({
      lifts: [
        { lift: "squat", maxKg: 150 },
        { lift: "bench", maxKg: 100 },
        { lift: "deadlift", maxKg: null },
      ],
      totalKg: null,
    });
    const all = [...workouts, workout("2026-10-02", [[deadlift, [set(200, 1)]]])];
    expect(standings(summarise([squat, bench, deadlift], all)).totalKg).toBe(450);
  });
});

describe("missingLifts", () => {
  test("names the competition lifts no exercise stands for", () => {
    expect(missingLifts([squat, curl])).toEqual(["bench", "deadlift"]);
  });
});
