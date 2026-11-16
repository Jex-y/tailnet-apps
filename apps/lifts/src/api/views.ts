import { asc, eq } from "drizzle-orm";
import type {
  Entry,
  Exercise,
  LiftSet,
  Load,
  Prescription,
  Program,
  ProgramDay,
  ProgramExercise,
  ScheduledSession,
  TrainingMax,
  Workout,
} from "../contract";
import type { LiftsDb } from "./db";
import {
  entries,
  exercises,
  prescriptions,
  programDays,
  programExercises,
  programs,
  scheduledSessions,
  sets,
  trainingMaxes,
  workouts,
} from "./schema";

export type LiftsReader = Pick<LiftsDb, "select">;

export const readExercises = (db: LiftsReader, owner: string): Promise<Exercise[]> =>
  db
    .select({
      id: exercises.id,
      name: exercises.name,
      lift: exercises.lift,
      weightStepKg: exercises.weightStepKg,
      measure: exercises.measure,
      bodyweight: exercises.bodyweight,
    })
    .from(exercises)
    .where(eq(exercises.owner, owner))
    .orderBy(asc(exercises.name), asc(exercises.id));

export const readWorkouts = async (db: LiftsReader, owner: string): Promise<Workout[]> => {
  const rows = await db
    .select({
      id: workouts.id,
      date: workouts.date,
      finishedAt: workouts.finishedAt,
      notes: workouts.notes,
      bodyweightKg: workouts.bodyweightKg,
    })
    .from(workouts)
    .where(eq(workouts.owner, owner))
    .orderBy(asc(workouts.date), asc(workouts.createdAt), asc(workouts.id));
  return rows.map((row) => ({ ...row, finishedAt: row.finishedAt?.toISOString() ?? null }));
};

export const readEntries = (db: LiftsReader, owner: string): Promise<Entry[]> =>
  db
    .select({
      id: entries.id,
      workoutId: entries.workoutId,
      exerciseId: entries.exerciseId,
      position: entries.position,
      notes: entries.notes,
    })
    .from(entries)
    .where(eq(entries.owner, owner))
    .orderBy(asc(entries.workoutId), asc(entries.position), asc(entries.id));

export const readSets = async (db: LiftsReader, owner: string): Promise<LiftSet[]> => {
  const rows = await db
    .select({
      id: sets.id,
      entryId: sets.entryId,
      position: sets.position,
      weightKg: sets.weightKg,
      reps: sets.reps,
      seconds: sets.seconds,
      rpe: sets.rpe,
      kind: sets.kind,
      loggedAt: sets.loggedAt,
    })
    .from(sets)
    .where(eq(sets.owner, owner))
    .orderBy(asc(sets.entryId), asc(sets.position), asc(sets.id));
  return rows.map((row) => ({ ...row, loggedAt: row.loggedAt.toISOString() }));
};

export const readPrograms = (db: LiftsReader, owner: string): Promise<Program[]> =>
  db
    .select({ id: programs.id, name: programs.name, notes: programs.notes })
    .from(programs)
    .where(eq(programs.owner, owner))
    .orderBy(asc(programs.createdAt), asc(programs.id));

export const readTrainingMaxes = (db: LiftsReader, owner: string): Promise<TrainingMax[]> =>
  db
    .select({
      id: trainingMaxes.id,
      programId: trainingMaxes.programId,
      exerciseId: trainingMaxes.exerciseId,
      kg: trainingMaxes.kg,
    })
    .from(trainingMaxes)
    .where(eq(trainingMaxes.owner, owner))
    .orderBy(asc(trainingMaxes.programId), asc(trainingMaxes.id));

export const readProgramDays = (db: LiftsReader, owner: string): Promise<ProgramDay[]> =>
  db
    .select({
      id: programDays.id,
      programId: programDays.programId,
      week: programDays.week,
      position: programDays.position,
      name: programDays.name,
    })
    .from(programDays)
    .where(eq(programDays.owner, owner))
    .orderBy(asc(programDays.programId), asc(programDays.week), asc(programDays.position), asc(programDays.id));

export const readProgramExercises = (db: LiftsReader, owner: string): Promise<ProgramExercise[]> =>
  db
    .select({
      id: programExercises.id,
      programDayId: programExercises.programDayId,
      exerciseId: programExercises.exerciseId,
      position: programExercises.position,
      notes: programExercises.notes,
    })
    .from(programExercises)
    .where(eq(programExercises.owner, owner))
    .orderBy(asc(programExercises.programDayId), asc(programExercises.position), asc(programExercises.id));

type LoadColumns = {
  readonly loadKind: Load["kind"];
  readonly loadKg: number | null;
  readonly loadPercent: number | null;
  readonly loadRpe: number | null;
};

/** The table's check constraint guarantees the column of the row's kind is set. */
const loadOf = ({ loadKind, loadKg, loadPercent, loadRpe }: LoadColumns): Load => {
  switch (loadKind) {
    case "kg":
      return { kind: "kg", kg: loadKg ?? 0 };
    case "percent":
      return { kind: "percent", percent: loadPercent ?? 0 };
    case "rpe":
      return { kind: "rpe", rpe: loadRpe ?? 0 };
  }
};

export const loadColumns = (load: Load): LoadColumns => ({
  loadKind: load.kind,
  loadKg: load.kind === "kg" ? load.kg : null,
  loadPercent: load.kind === "percent" ? load.percent : null,
  loadRpe: load.kind === "rpe" ? load.rpe : null,
});

export const readPrescriptions = async (db: LiftsReader, owner: string): Promise<Prescription[]> => {
  const rows = await db
    .select({
      id: prescriptions.id,
      programExerciseId: prescriptions.programExerciseId,
      position: prescriptions.position,
      sets: prescriptions.sets,
      reps: prescriptions.reps,
      seconds: prescriptions.seconds,
      kind: prescriptions.kind,
      loadKind: prescriptions.loadKind,
      loadKg: prescriptions.loadKg,
      loadPercent: prescriptions.loadPercent,
      loadRpe: prescriptions.loadRpe,
    })
    .from(prescriptions)
    .where(eq(prescriptions.owner, owner))
    .orderBy(asc(prescriptions.programExerciseId), asc(prescriptions.position), asc(prescriptions.id));
  return rows.map(({ loadKind, loadKg, loadPercent, loadRpe, ...row }) => ({
    ...row,
    load: loadOf({ loadKind, loadKg, loadPercent, loadRpe }),
  }));
};

export const readSessions = async (db: LiftsReader, owner: string): Promise<ScheduledSession[]> => {
  const rows = await db
    .select({
      id: scheduledSessions.id,
      programDayId: scheduledSessions.programDayId,
      date: scheduledSessions.date,
      state: scheduledSessions.state,
      workoutId: scheduledSessions.workoutId,
    })
    .from(scheduledSessions)
    .where(eq(scheduledSessions.owner, owner))
    .orderBy(asc(scheduledSessions.date), asc(scheduledSessions.id));
  return rows.map(
    ({ workoutId, state, ...row }): ScheduledSession =>
      // The table's check constraint guarantees a logged session has its workout.
      state === "logged" ? { ...row, state, workoutId: workoutId ?? "" } : { ...row, state },
  );
};
