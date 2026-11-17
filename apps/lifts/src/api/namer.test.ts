import { describe, expect, test } from "bun:test";
import type { Exercise, Workout } from "../contract";
import type { WorkoutDetail } from "../log";
import { cleanName, describeWorkout } from "./namer";

describe("cleanName", () => {
  test("takes the name alone from a reply", () => {
    expect(cleanName("Heavy Squat Singles")).toBe("Heavy Squat Singles");
    expect(cleanName('"Upper Body Volume."')).toBe("Upper Body Volume");
    expect(cleanName("Name: **Deadlift  Day**\nBecause you pulled.")).toBe("Deadlift Day");
  });

  test("finds none in an empty or overlong reply", () => {
    expect(cleanName("  \n")).toBeNull();
    expect(cleanName("x".repeat(81))).toBeNull();
  });
});

describe("describeWorkout", () => {
  const squat: Exercise = {
    id: "squat",
    name: "Squat",
    lift: "squat",
    weightStepKg: 2.5,
    measure: "reps",
    bodyweight: false,
  };
  const workout = (id: string, date: string, weightKg: number, fields: Partial<Workout> = {}): WorkoutDetail => ({
    id,
    date,
    name: null,
    finishedAt: `${date}T19:00:00.000Z`,
    notes: "",
    bodyweightKg: null,
    ...fields,
    entries: [
      {
        id: `${id}-squat`,
        workoutId: id,
        exerciseId: squat.id,
        position: 0,
        notes: "",
        exercise: squat,
        sets: [
          {
            id: `${id}-set`,
            entryId: `${id}-squat`,
            position: 0,
            weightKg,
            loadKg: weightKg,
            reps: 3,
            seconds: null,
            rpe: 9,
            kind: "work",
            loggedAt: `${date}T18:00:00.000Z`,
          },
        ],
      },
    ],
  });

  test("lists the sets, flags a new best and shows the names before it", () => {
    const before = workout("a", "2026-11-10", 150, { name: "Squat Triples" });
    const today = workout("b", "2026-11-17", 160, { notes: "Moved well" });

    expect(describeWorkout(today, [before, today])).toBe(
      [
        "Exercises (weights in kg, sets as weight×reps @RPE):\n- Squat: 160×3 @9 (a new best estimated max)",
        "Notes:\nMoved well",
        "Earlier workouts were named:\nSquat Triples",
      ].join("\n\n"),
    );
  });
});
