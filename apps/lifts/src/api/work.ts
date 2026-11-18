import { defineJob, defineSchedule, insertJob, type JobInserter, type RegisteredJob, type Schedule } from "@apps/core";
import { and, asc, eq, isNotNull, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { workoutDetails } from "../log";
import type { LiftsDb } from "./db";
import { describeWorkout, type WorkoutNamer } from "./namer";
import { pushes, workouts } from "./schema";
import { readEntries, readExercises, readSets, readWorkouts } from "./views";

export type LiftsWorkDeps = {
  readonly db: LiftsDb;
  readonly namer: WorkoutNamer | null;
  readonly now: () => Date;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How long a push is remembered. A device retries one within minutes of the answer it lost, never weeks. */
export const PUSH_MEMORY_MS = 30 * DAY;

/** A workout is named this long after it is finished, so sets a device sends just after the finish are in it. */
export const NAME_AFTER_MS = 2 * MINUTE;

/** The most workouts the daily sweep names, so a long unnamed log is caught up on over days rather than at once. */
export const NAMES_PER_SWEEP = 50;

export const createLiftsWork = ({ db, namer, now }: LiftsWorkDeps) => {
  const forgetPushes = defineJob({
    name: "lifts.forget-pushes",
    payload: z.object({}),
    handle: async () => {
      await db.delete(pushes).where(lt(pushes.appliedAt, new Date(now().getTime() - PUSH_MEMORY_MS)));
    },
  });

  /** Names a finished workout from what was lifted in it, unless it has been named or reopened since. */
  const nameWorkout = defineJob({
    name: "lifts.name-workout",
    payload: z.object({ owner: z.string(), workoutId: z.uuid() }),
    maxAttempts: 3,
    handle: async ({ owner, workoutId }, { signal }) => {
      if (namer === null) {
        return;
      }
      const all = workoutDetails({
        exercises: await readExercises(db, owner),
        workouts: await readWorkouts(db, owner),
        entries: await readEntries(db, owner),
        sets: await readSets(db, owner),
      });
      const workout = all.find((other) => other.id === workoutId);
      if (workout === undefined || workout.name !== null || workout.finishedAt === null) {
        return;
      }
      const name = await namer.name(describeWorkout(workout, all), signal);
      await db
        .update(workouts)
        .set({ name })
        .where(and(eq(workouts.owner, owner), eq(workouts.id, workoutId), isNull(workouts.name)));
    },
  });

  /** Names the workout once it has settled; nothing, when no namer is configured. */
  const scheduleNaming = async (tx: JobInserter, owner: string, workoutId: string): Promise<void> => {
    if (namer !== null) {
      await insertJob(
        tx,
        nameWorkout,
        { owner, workoutId },
        { dedupeKey: workoutId, runAt: new Date(now().getTime() + NAME_AFTER_MS) },
      );
    }
  };

  /** Catches up on finished workouts left unnamed: those from before names, or whose naming failed. */
  const nameUnnamed = defineJob({
    name: "lifts.name-unnamed",
    payload: z.object({}),
    handle: async () => {
      if (namer === null) {
        return;
      }
      const unnamed = await db
        .select({ owner: workouts.owner, id: workouts.id })
        .from(workouts)
        .where(and(isNull(workouts.name), isNotNull(workouts.finishedAt)))
        .orderBy(asc(workouts.finishedAt))
        .limit(NAMES_PER_SWEEP);
      for (const { owner, id } of unnamed) {
        await insertJob(db, nameWorkout, { owner, workoutId: id }, { dedupeKey: id });
      }
    },
  });

  const jobs: readonly RegisteredJob[] = [forgetPushes, nameWorkout, nameUnnamed];

  const schedules: readonly Schedule[] = [
    defineSchedule({ name: "lifts.forget-pushes", everyMs: DAY, jitterMs: HOUR, job: forgetPushes, payload: {} }),
    defineSchedule({ name: "lifts.name-unnamed", everyMs: DAY, jitterMs: HOUR, job: nameUnnamed, payload: {} }),
  ];

  return { jobs, schedules, scheduleNaming, definitions: { forgetPushes, nameWorkout, nameUnnamed } };
};

export type LiftsWork = ReturnType<typeof createLiftsWork>;
