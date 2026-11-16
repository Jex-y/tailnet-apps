import { HttpError } from "@apps/core";
import { and, count, eq, isNull, ne, or, type SQL } from "drizzle-orm";
import type {
  Entry,
  Exercise,
  LiftSet,
  Measure,
  Mutation,
  Prescription,
  Program,
  ProgramDay,
  ProgramExercise,
  ScheduledSession,
  TrainingMax,
  Workout,
} from "../contract";
import type { Log } from "../log";
import type { Plan } from "../program";
import type { LiftsDb } from "./db";
import {
  entries,
  exercises,
  prescriptions,
  programDays,
  programExercises,
  programs,
  pushes,
  scheduledSessions,
  sets,
  trainingMaxes,
  workouts,
} from "./schema";
import {
  loadColumns,
  readEntries,
  readExercises,
  readPrescriptions,
  readProgramDays,
  readProgramExercises,
  readPrograms,
  readSessions,
  readSets,
  readTrainingMaxes,
  readWorkouts,
} from "./views";

export type LiftsServiceDeps = { readonly db: LiftsDb };

type Tx = Parameters<Parameters<LiftsDb["transaction"]>[0]>[0];

/** A row written under an id that already belongs to someone else changes nothing, and is refused as if not there. */
const requireWritten = (written: readonly unknown[]) => {
  if (written.length === 0) {
    throw new HttpError(404, "Not found");
  }
};

const requireOwn = async (found: Promise<readonly unknown[]>, missing: string) => {
  if ((await found).length === 0) {
    throw new HttpError(409, missing);
  }
};

type Counted = { readonly reps: number | null; readonly seconds: number | null };

/** Whether any set matching `where` is counted otherwise than in `measure`. */
const setsCountedOtherwise = async (tx: Tx, owner: string, measure: Measure, where: SQL | undefined) =>
  (
    await tx
      .select({ id: sets.id })
      .from(sets)
      .innerJoin(entries, and(eq(entries.owner, owner), eq(entries.id, sets.entryId)))
      .where(and(eq(sets.owner, owner), where, isNull(measure === "reps" ? sets.reps : sets.seconds)))
      .limit(1)
  ).length > 0;

/** Whether any prescription matching `where` is counted otherwise than in `measure`. */
const prescriptionsCountedOtherwise = async (tx: Tx, owner: string, measure: Measure, where: SQL | undefined) =>
  (
    await tx
      .select({ id: prescriptions.id })
      .from(prescriptions)
      .innerJoin(
        programExercises,
        and(eq(programExercises.owner, owner), eq(programExercises.id, prescriptions.programExerciseId)),
      )
      .where(
        and(
          eq(prescriptions.owner, owner),
          where,
          isNull(measure === "reps" ? prescriptions.reps : prescriptions.seconds),
        ),
      )
      .limit(1)
  ).length > 0;

type Measured = { readonly name: string; readonly measure: Measure };

/** Refuses a set or prescription not counted in its exercise's measure. */
const requireCountedIn = (exercise: Measured, { reps, seconds }: Counted) => {
  if ((reps === null) === (seconds === null)) {
    throw new HttpError(400, "Give either reps or seconds, not both");
  }
  const given: Measure = reps === null ? "seconds" : "reps";
  if (given !== exercise.measure) {
    throw new HttpError(409, `"${exercise.name}" is counted in ${exercise.measure}, not ${given}`);
  }
};

const putExercise = async (tx: Tx, owner: string, { id, ...fields }: Exercise) => {
  if (fields.lift !== null) {
    const [holder] = await tx
      .select({ id: exercises.id, name: exercises.name })
      .from(exercises)
      .where(and(eq(exercises.owner, owner), eq(exercises.lift, fields.lift)));
    if (holder !== undefined && holder.id !== id) {
      throw new HttpError(409, `"${holder.name}" is already your ${fields.lift}`);
    }
  }
  const counted =
    (await setsCountedOtherwise(tx, owner, fields.measure, eq(entries.exerciseId, id))) ||
    (await prescriptionsCountedOtherwise(tx, owner, fields.measure, eq(programExercises.exerciseId, id)));
  if (counted) {
    throw new HttpError(
      409,
      `"${fields.name}" has been logged or programmed, so it cannot be counted in ${fields.measure}`,
    );
  }
  requireWritten(
    await tx
      .insert(exercises)
      .values({ id, owner, ...fields })
      .onConflictDoUpdate({ target: exercises.id, set: fields, setWhere: eq(exercises.owner, owner) })
      .returning({ id: exercises.id }),
  );
};

const deleteExercise = async (tx: Tx, owner: string, id: string) => {
  const [exercise] = await tx
    .select({ name: exercises.name })
    .from(exercises)
    .where(and(eq(exercises.id, id), eq(exercises.owner, owner)));
  if (exercise === undefined) {
    return;
  }
  const [used] = await tx
    .select({ entries: count() })
    .from(entries)
    .where(and(eq(entries.owner, owner), eq(entries.exerciseId, id)));
  if (used !== undefined && used.entries > 0) {
    throw new HttpError(409, `"${exercise.name}" has been logged ${used.entries} times, so it cannot be deleted`);
  }
  const [planned] = await tx
    .selectDistinct({ name: programs.name })
    .from(programs)
    .leftJoin(programDays, and(eq(programDays.owner, owner), eq(programDays.programId, programs.id)))
    .leftJoin(
      programExercises,
      and(eq(programExercises.owner, owner), eq(programExercises.programDayId, programDays.id)),
    )
    .leftJoin(trainingMaxes, and(eq(trainingMaxes.owner, owner), eq(trainingMaxes.programId, programs.id)))
    .where(and(eq(programs.owner, owner), or(eq(programExercises.exerciseId, id), eq(trainingMaxes.exerciseId, id))));
  if (planned !== undefined) {
    throw new HttpError(409, `"${exercise.name}" is in the program "${planned.name}", so it cannot be deleted`);
  }
  await tx.delete(exercises).where(and(eq(exercises.id, id), eq(exercises.owner, owner)));
};

const ownProgram = (tx: Tx, owner: string, id: string) =>
  requireOwn(
    tx
      .select({ id: programs.id })
      .from(programs)
      .where(and(eq(programs.id, id), eq(programs.owner, owner))),
    "That program no longer exists",
  );

const ownExercise = async (tx: Tx, owner: string, id: string): Promise<Measured> => {
  const [exercise] = await tx
    .select({ name: exercises.name, measure: exercises.measure })
    .from(exercises)
    .where(and(eq(exercises.id, id), eq(exercises.owner, owner)));
  if (exercise === undefined) {
    throw new HttpError(409, "That exercise no longer exists");
  }
  return exercise;
};

const putWorkout = async (tx: Tx, owner: string, { id, finishedAt, ...fields }: Workout) => {
  const values = { ...fields, finishedAt: finishedAt === null ? null : new Date(finishedAt) };
  requireWritten(
    await tx
      .insert(workouts)
      .values({ id, owner, ...values })
      .onConflictDoUpdate({ target: workouts.id, set: values, setWhere: eq(workouts.owner, owner) })
      .returning({ id: workouts.id }),
  );
};

const putEntry = async (tx: Tx, owner: string, { id, ...fields }: Entry) => {
  await requireOwn(
    tx
      .select({ id: workouts.id })
      .from(workouts)
      .where(and(eq(workouts.id, fields.workoutId), eq(workouts.owner, owner))),
    "That workout no longer exists",
  );
  const exercise = await ownExercise(tx, owner, fields.exerciseId);
  if (await setsCountedOtherwise(tx, owner, exercise.measure, eq(entries.id, id))) {
    throw new HttpError(409, `"${exercise.name}" is counted in ${exercise.measure}, unlike the sets logged here`);
  }
  requireWritten(
    await tx
      .insert(entries)
      .values({ id, owner, ...fields })
      .onConflictDoUpdate({ target: entries.id, set: fields, setWhere: eq(entries.owner, owner) })
      .returning({ id: entries.id }),
  );
};

const putSet = async (tx: Tx, owner: string, { id, loggedAt, ...fields }: LiftSet) => {
  const [exercise] = await tx
    .select({ name: exercises.name, measure: exercises.measure })
    .from(entries)
    .innerJoin(exercises, and(eq(exercises.owner, owner), eq(exercises.id, entries.exerciseId)))
    .where(and(eq(entries.id, fields.entryId), eq(entries.owner, owner)));
  if (exercise === undefined) {
    throw new HttpError(409, "That exercise is no longer in the workout");
  }
  requireCountedIn(exercise, fields);
  const values = { ...fields, loggedAt: new Date(loggedAt) };
  requireWritten(
    await tx
      .insert(sets)
      .values({ id, owner, ...values })
      .onConflictDoUpdate({ target: sets.id, set: values, setWhere: eq(sets.owner, owner) })
      .returning({ id: sets.id }),
  );
};

const putProgram = async (tx: Tx, owner: string, { id, ...fields }: Program) => {
  requireWritten(
    await tx
      .insert(programs)
      .values({ id, owner, ...fields })
      .onConflictDoUpdate({ target: programs.id, set: fields, setWhere: eq(programs.owner, owner) })
      .returning({ id: programs.id }),
  );
};

const putTrainingMax = async (tx: Tx, owner: string, { id, ...fields }: TrainingMax) => {
  await ownProgram(tx, owner, fields.programId);
  await ownExercise(tx, owner, fields.exerciseId);
  const [other] = await tx
    .select({ id: trainingMaxes.id })
    .from(trainingMaxes)
    .where(
      and(
        eq(trainingMaxes.owner, owner),
        eq(trainingMaxes.programId, fields.programId),
        eq(trainingMaxes.exerciseId, fields.exerciseId),
        ne(trainingMaxes.id, id),
      ),
    );
  if (other !== undefined) {
    throw new HttpError(409, "That exercise already has a training max in this program");
  }
  requireWritten(
    await tx
      .insert(trainingMaxes)
      .values({ id, owner, ...fields })
      .onConflictDoUpdate({ target: trainingMaxes.id, set: fields, setWhere: eq(trainingMaxes.owner, owner) })
      .returning({ id: trainingMaxes.id }),
  );
};

const putProgramDay = async (tx: Tx, owner: string, { id, ...fields }: ProgramDay) => {
  await ownProgram(tx, owner, fields.programId);
  requireWritten(
    await tx
      .insert(programDays)
      .values({ id, owner, ...fields })
      .onConflictDoUpdate({ target: programDays.id, set: fields, setWhere: eq(programDays.owner, owner) })
      .returning({ id: programDays.id }),
  );
};

const putProgramExercise = async (tx: Tx, owner: string, { id, ...fields }: ProgramExercise) => {
  await requireOwn(
    tx
      .select({ id: programDays.id })
      .from(programDays)
      .where(and(eq(programDays.id, fields.programDayId), eq(programDays.owner, owner))),
    "That program day no longer exists",
  );
  const exercise = await ownExercise(tx, owner, fields.exerciseId);
  if (await prescriptionsCountedOtherwise(tx, owner, exercise.measure, eq(programExercises.id, id))) {
    throw new HttpError(409, `"${exercise.name}" is counted in ${exercise.measure}, unlike the prescriptions here`);
  }
  requireWritten(
    await tx
      .insert(programExercises)
      .values({ id, owner, ...fields })
      .onConflictDoUpdate({ target: programExercises.id, set: fields, setWhere: eq(programExercises.owner, owner) })
      .returning({ id: programExercises.id }),
  );
};

const putPrescription = async (tx: Tx, owner: string, { id, load, ...rest }: Prescription) => {
  const [exercise] = await tx
    .select({ name: exercises.name, measure: exercises.measure })
    .from(programExercises)
    .innerJoin(exercises, and(eq(exercises.owner, owner), eq(exercises.id, programExercises.exerciseId)))
    .where(and(eq(programExercises.id, rest.programExerciseId), eq(programExercises.owner, owner)));
  if (exercise === undefined) {
    throw new HttpError(409, "That exercise is no longer in the program");
  }
  requireCountedIn(exercise, rest);
  const fields = { ...rest, ...loadColumns(load) };
  requireWritten(
    await tx
      .insert(prescriptions)
      .values({ id, owner, ...fields })
      .onConflictDoUpdate({ target: prescriptions.id, set: fields, setWhere: eq(prescriptions.owner, owner) })
      .returning({ id: prescriptions.id }),
  );
};

const putSession = async (tx: Tx, owner: string, { id, ...session }: ScheduledSession) => {
  await requireOwn(
    tx
      .select({ id: programDays.id })
      .from(programDays)
      .where(and(eq(programDays.id, session.programDayId), eq(programDays.owner, owner))),
    "That program day no longer exists",
  );
  const workoutId = session.state === "logged" ? session.workoutId : null;
  if (workoutId !== null) {
    await requireOwn(
      tx
        .select({ id: workouts.id })
        .from(workouts)
        .where(and(eq(workouts.id, workoutId), eq(workouts.owner, owner))),
      "That workout no longer exists",
    );
    const [other] = await tx
      .select({ id: scheduledSessions.id })
      .from(scheduledSessions)
      .where(
        and(
          eq(scheduledSessions.owner, owner),
          eq(scheduledSessions.workoutId, workoutId),
          ne(scheduledSessions.id, id),
        ),
      );
    if (other !== undefined) {
      throw new HttpError(409, "That workout already logs another session");
    }
  }
  const fields = { programDayId: session.programDayId, date: session.date, state: session.state, workoutId };
  requireWritten(
    await tx
      .insert(scheduledSessions)
      .values({ id, owner, ...fields })
      .onConflictDoUpdate({ target: scheduledSessions.id, set: fields, setWhere: eq(scheduledSessions.owner, owner) })
      .returning({ id: scheduledSessions.id }),
  );
};

/** The session it logged goes back to planned, as if the workout had never been. */
const deleteWorkout = async (tx: Tx, owner: string, id: string) => {
  await tx
    .update(scheduledSessions)
    .set({ state: "planned", workoutId: null })
    .where(and(eq(scheduledSessions.owner, owner), eq(scheduledSessions.workoutId, id)));
  await tx.delete(workouts).where(and(eq(workouts.id, id), eq(workouts.owner, owner)));
};

const applyOne = async (tx: Tx, owner: string, mutation: Mutation): Promise<void> => {
  switch (mutation.type) {
    case "exercise.put":
      return putExercise(tx, owner, mutation.row);
    case "exercise.delete":
      return deleteExercise(tx, owner, mutation.id);
    case "workout.put":
      return putWorkout(tx, owner, mutation.row);
    case "workout.delete":
      return deleteWorkout(tx, owner, mutation.id);
    case "entry.put":
      return putEntry(tx, owner, mutation.row);
    case "entry.delete":
      await tx.delete(entries).where(and(eq(entries.id, mutation.id), eq(entries.owner, owner)));
      return;
    case "set.put":
      return putSet(tx, owner, mutation.row);
    case "set.delete":
      await tx.delete(sets).where(and(eq(sets.id, mutation.id), eq(sets.owner, owner)));
      return;
    case "program.put":
      return putProgram(tx, owner, mutation.row);
    case "program.delete":
      await tx.delete(programs).where(and(eq(programs.id, mutation.id), eq(programs.owner, owner)));
      return;
    case "trainingMax.put":
      return putTrainingMax(tx, owner, mutation.row);
    case "trainingMax.delete":
      await tx.delete(trainingMaxes).where(and(eq(trainingMaxes.id, mutation.id), eq(trainingMaxes.owner, owner)));
      return;
    case "programDay.put":
      return putProgramDay(tx, owner, mutation.row);
    case "programDay.delete":
      await tx.delete(programDays).where(and(eq(programDays.id, mutation.id), eq(programDays.owner, owner)));
      return;
    case "programExercise.put":
      return putProgramExercise(tx, owner, mutation.row);
    case "programExercise.delete":
      await tx
        .delete(programExercises)
        .where(and(eq(programExercises.id, mutation.id), eq(programExercises.owner, owner)));
      return;
    case "prescription.put":
      return putPrescription(tx, owner, mutation.row);
    case "prescription.delete":
      await tx.delete(prescriptions).where(and(eq(prescriptions.id, mutation.id), eq(prescriptions.owner, owner)));
      return;
    case "session.put":
      return putSession(tx, owner, mutation.row);
    case "session.delete":
      await tx
        .delete(scheduledSessions)
        .where(and(eq(scheduledSessions.id, mutation.id), eq(scheduledSessions.owner, owner)));
      return;
  }
};

const applyAll = async (tx: Tx, owner: string, mutations: readonly Mutation[]) => {
  for (const mutation of mutations) {
    await applyOne(tx, owner, mutation);
  }
};

/**
 * Everything someone can do with their training log, shared by the HTTP API and the MCP server. Refusals are
 * {@link HttpError}s saying why. Nobody can see or touch another's log.
 */
export const createLiftsService = ({ db }: LiftsServiceDeps) => ({
  exercises: (owner: string) => readExercises(db, owner),
  workouts: (owner: string) => readWorkouts(db, owner),
  entries: (owner: string) => readEntries(db, owner),
  sets: (owner: string) => readSets(db, owner),
  programs: (owner: string) => readPrograms(db, owner),
  trainingMaxes: (owner: string) => readTrainingMaxes(db, owner),
  programDays: (owner: string) => readProgramDays(db, owner),
  programExercises: (owner: string) => readProgramExercises(db, owner),
  prescriptions: (owner: string) => readPrescriptions(db, owner),
  sessions: (owner: string) => readSessions(db, owner),

  log: async (owner: string): Promise<Log> => ({
    exercises: await readExercises(db, owner),
    workouts: await readWorkouts(db, owner),
    entries: await readEntries(db, owner),
    sets: await readSets(db, owner),
  }),

  plan: async (owner: string): Promise<Plan> => ({
    programs: await readPrograms(db, owner),
    trainingMaxes: await readTrainingMaxes(db, owner),
    days: await readProgramDays(db, owner),
    exercises: await readProgramExercises(db, owner),
    prescriptions: await readPrescriptions(db, owner),
    sessions: await readSessions(db, owner),
  }),

  /** Applies the changes in order, all or nothing. */
  apply: (owner: string, mutations: readonly Mutation[]): Promise<void> =>
    db.transaction((tx) => applyAll(tx, owner, mutations)),

  /** {@link apply}, at most once per key: a push that was refused may be sent again, one that landed is ignored. */
  push: (owner: string, key: string, mutations: readonly Mutation[]): Promise<void> =>
    db.transaction(async (tx) => {
      const claimed = await tx
        .insert(pushes)
        .values({ owner, key })
        .onConflictDoNothing()
        .returning({ key: pushes.key });
      if (claimed.length > 0) {
        await applyAll(tx, owner, mutations);
      }
    }),
});

export type LiftsService = ReturnType<typeof createLiftsService>;
