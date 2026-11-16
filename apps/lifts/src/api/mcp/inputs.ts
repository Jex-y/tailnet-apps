import { HttpError } from "@apps/core";
import { z } from "zod";
import { Entry, LiftSet } from "../../contract";

export const round = (value: number) => Math.round(value * 10) / 10;

export const WorkoutId = z.uuid().describe("The workout's id");
export const ExerciseId = z.uuid().describe("The exercise's id, from list_exercises");
export const EntryId = z.uuid().describe("The id of an exercise within a workout, from get_workout");
export const SetId = z.uuid().describe("The set's id, from get_workout");

export const SetInput = z.object({
  weightKg: LiftSet.shape.weightKg,
  reps: LiftSet.shape.reps,
  rpe: LiftSet.shape.rpe.default(null),
  kind: LiftSet.shape.kind.default("work"),
});
export type SetInput = z.infer<typeof SetInput>;

export const EntryInput = z.object({
  exerciseId: ExerciseId,
  notes: Entry.shape.notes.default(""),
  sets: z.array(SetInput).max(100).default([]),
});
export type EntryInput = z.infer<typeof EntryInput>;

export const notFound = (): never => {
  throw new HttpError(404, "Not found");
};

export const read = { readOnlyHint: true, openWorldHint: false } as const;
export const change = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
export const edit = { ...change, idempotentHint: true } as const;
export const destroy = { ...change, destructiveHint: true } as const;
