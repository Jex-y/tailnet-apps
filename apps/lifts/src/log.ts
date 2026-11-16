import type { Entry, Exercise, LiftSet, Workout } from "./contract";

/** Everything one person has logged. */
export type Log = {
  readonly exercises: readonly Exercise[];
  readonly workouts: readonly Workout[];
  readonly entries: readonly Entry[];
  readonly sets: readonly LiftSet[];
};

/**
 * A set with everything it moved: its weight, and for an exercise whose load includes bodyweight, that too. `null`
 * for such a set until some bodyweight has been logged.
 */
export type LoggedSet = LiftSet & { readonly loadKg: number | null };

export type EntryDetail = Entry & { readonly exercise: Exercise; readonly sets: readonly LoggedSet[] };
export type WorkoutDetail = Workout & { readonly entries: readonly EntryDetail[] };

type Placed = { readonly id: string; readonly position: number };

export const byPosition = (a: Placed, b: Placed): number => a.position - b.position || a.id.localeCompare(b.id);

/** Oldest first; workouts on the same day keep the order they were given in. */
export const byDate = (a: Workout, b: Workout): number => a.date.localeCompare(b.date);

/**
 * The bodyweight each workout's sets were lifted at, by workout id, for workouts oldest first: its own, else the
 * latest logged before it, else the first logged at all.
 */
const bodyweights = (workouts: readonly Workout[]): ReadonlyMap<string, number | null> => {
  let latest = workouts.find((workout) => workout.bodyweightKg !== null)?.bodyweightKg ?? null;
  return new Map(
    workouts.map((workout) => {
      latest = workout.bodyweightKg ?? latest;
      return [workout.id, latest];
    }),
  );
};

/** Everything a set moved, given the bodyweight it was lifted at. */
export const loadOf = (
  { weightKg }: Pick<LiftSet, "weightKg">,
  { bodyweight }: Pick<Exercise, "bodyweight">,
  bodyweightKg: number | null,
): number | null => (!bodyweight ? weightKg : bodyweightKg === null ? null : weightKg + bodyweightKg);

/** The bodyweight on `date`: the latest logged by then, else the first logged at all. */
export const bodyweightOn = (workouts: readonly Workout[], date: string): number | null => {
  const logged = workouts.filter((workout) => workout.bodyweightKg !== null).toSorted(byDate);
  return (logged.findLast((workout) => workout.date <= date) ?? logged[0])?.bodyweightKg ?? null;
};

type Writing = (kg: number) => string;

/** A set's weight, written by `kg`: as `BW` or `BW+20` for an exercise whose load includes bodyweight. */
export const describeWeight = (weightKg: number, { bodyweight }: Pick<Exercise, "bodyweight">, kg: Writing = String) =>
  !bodyweight ? kg(weightKg) : weightKg === 0 ? "BW" : `BW+${kg(weightKg)}`;

/** A set's reps, or its seconds as `60s`. */
export const describeCount = ({ reps, seconds }: Pick<LiftSet, "reps" | "seconds">): string =>
  reps === null ? `${seconds}s` : String(reps);

/** A set in brief, such as `100×5 @8`, `BW+20×5` or `40×60s`, its weight written by `kg`. */
export const describeSet = (
  set: Pick<LiftSet, "weightKg" | "reps" | "seconds" | "rpe">,
  exercise: Pick<Exercise, "bodyweight">,
  kg: Writing = String,
): string =>
  `${describeWeight(set.weightKg, exercise, kg)}×${describeCount(set)}${set.rpe === null ? "" : ` @${set.rpe}`}`;

/** Each workout with its exercises and their sets in order, oldest workout first. */
export const workoutDetails = ({ exercises, workouts, entries, sets }: Log): WorkoutDetail[] => {
  const exerciseOf = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  const setsOf = Map.groupBy(sets, (set) => set.entryId);
  const entriesOf = Map.groupBy(entries, (entry) => entry.workoutId);
  const sorted = workouts.toSorted(byDate);
  const bodyweightOf = bodyweights(sorted);

  return sorted.map((workout) => ({
    ...workout,
    entries: (entriesOf.get(workout.id) ?? []).toSorted(byPosition).flatMap((entry) => {
      const exercise = exerciseOf.get(entry.exerciseId);
      if (exercise === undefined) {
        return [];
      }
      const bodyweightKg = bodyweightOf.get(workout.id) ?? null;
      const logged = (setsOf.get(entry.id) ?? [])
        .toSorted(byPosition)
        .map((set) => ({ ...set, loadKg: loadOf(set, exercise, bodyweightKg) }));
      return [{ ...entry, exercise, sets: logged }];
    }),
  }));
};

export type Session = { readonly workout: Workout; readonly sets: readonly LoggedSet[] };

/** Each workout an exercise was trained in, with every set of it that day, oldest first. */
export const sessionsOf = (workouts: readonly WorkoutDetail[], exerciseId: string): Session[] =>
  workouts.flatMap((workout) => {
    const sets = workout.entries.filter((entry) => entry.exerciseId === exerciseId).flatMap((entry) => entry.sets);
    return sets.length === 0 ? [] : [{ workout, sets }];
  });

/** One past the last position in use, for appending. */
export const nextPosition = (placed: readonly Placed[]): number =>
  placed.reduce((next, { position }) => Math.max(next, position + 1), 0);
