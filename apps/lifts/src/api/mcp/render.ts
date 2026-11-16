import type { LiftSet } from "../../contract";
import { type EntryDetail, type Log, sessionsOf, type WorkoutDetail, workoutDetails } from "../../log";
import { bestEstimate, estimatedMax, isWorkSet, tonnage } from "../../strength";
import { round } from "./inputs";

export const setText = (set: LiftSet) =>
  `${set.weightKg}×${set.reps}${set.rpe === null ? "" : ` @${set.rpe}`}${isWorkSet(set) ? "" : " (warm-up)"}`;

export const maxOf = (sets: readonly LiftSet[]) => {
  const best = bestEstimate(sets);
  return best === null ? null : round(best.maxKg);
};

export const briefWorkout = (workout: WorkoutDetail) => ({
  id: workout.id,
  date: workout.date,
  finished: workout.finishedAt !== null,
  ...(workout.bodyweightKg !== null && { bodyweightKg: workout.bodyweightKg }),
  ...(workout.notes !== "" && { notes: workout.notes }),
  exercises: workout.entries.map((entry) => ({ name: entry.exercise.name, sets: entry.sets.map(setText) })),
});

export const fullEntry = (entry: EntryDetail) => ({
  entryId: entry.id,
  exercise: { id: entry.exercise.id, name: entry.exercise.name },
  ...(entry.notes !== "" && { notes: entry.notes }),
  sets: entry.sets.map((set) => {
    const maxKg = isWorkSet(set) ? estimatedMax(set) : null;
    return {
      setId: set.id,
      weightKg: set.weightKg,
      reps: set.reps,
      rpe: set.rpe,
      kind: set.kind,
      ...(maxKg !== null && { estimatedMaxKg: round(maxKg) }),
    };
  }),
});

export const fullWorkout = (workout: WorkoutDetail) => ({
  id: workout.id,
  date: workout.date,
  finishedAt: workout.finishedAt,
  bodyweightKg: workout.bodyweightKg,
  notes: workout.notes,
  tonnageKg: round(tonnage(workout.entries.flatMap((entry) => entry.sets))),
  exercises: workout.entries.map(fullEntry),
});

export const exerciseSummaries = (log: Log) => {
  const workouts = workoutDetails(log);
  return log.exercises.map((exercise) => {
    const sessions = sessionsOf(workouts, exercise.id);
    return {
      ...exercise,
      sessions: sessions.length,
      lastTrainedOn: sessions.at(-1)?.workout.date ?? null,
      bestEstimatedMaxKg: maxOf(sessions.flatMap((session) => session.sets)),
    };
  });
};
