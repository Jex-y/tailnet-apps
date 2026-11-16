import { HttpError } from "@apps/core";
import { z } from "zod";
import { Entry, LiftSet, Load, Prescription, Program, ProgramDay, ProgramExercise, TrainingMax } from "../../contract";

export const round = (value: number) => Math.round(value * 10) / 10;

export const WorkoutId = z.uuid().describe("The workout's id");
export const ExerciseId = z.uuid().describe("The exercise's id, from list_exercises");
export const EntryId = z.uuid().describe("The id of an exercise within a workout, from get_workout");
export const SetId = z.uuid().describe("The set's id, from get_workout");

export const ProgramId = z.uuid().describe("The program's id, from list_programs");
export const ProgramDayId = z.uuid().describe("The id of a day in a program, from get_program");

export const PrescriptionInput = z.object({
  sets: Prescription.shape.sets.default(1),
  reps: Prescription.shape.reps,
  load: Load.describe(
    "kg: a fixed weight; percent: of the program's training max for the exercise; rpe: worked out from the exercise's estimated max on the day",
  ),
  kind: Prescription.shape.kind.default("work"),
});
export type PrescriptionInput = z.infer<typeof PrescriptionInput>;

export const ProgramExerciseInput = z.object({
  exerciseId: ExerciseId,
  notes: ProgramExercise.shape.notes.default(""),
  prescriptions: z.array(PrescriptionInput).min(1).max(20),
});

export const ProgramDayInput = z.object({
  week: ProgramDay.shape.week,
  name: ProgramDay.shape.name,
  exercises: z.array(ProgramExerciseInput).max(30),
});
export type ProgramDayInput = z.infer<typeof ProgramDayInput>;

export const TrainingMaxInput = z.object({ exerciseId: ExerciseId, kg: TrainingMax.shape.kg });

export const ProgramFields = { name: Program.shape.name, notes: Program.shape.notes };

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
