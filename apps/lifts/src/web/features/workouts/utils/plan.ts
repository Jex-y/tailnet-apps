import type { Exercise, LiftSet, Workout } from "../../../../contract";
import { byPosition, type LoggedSet, type Session, sessionsOf, type WorkoutDetail } from "../../../../log";

export type SetValues = Pick<LiftSet, "weightKg" | "reps" | "seconds" | "rpe" | "kind">;

/** Just what a set's values are, without the identity and place of the set they were read from. */
export const setValues = ({ weightKg, reps, seconds, rpe, kind }: SetValues): SetValues => ({
  weightKg,
  reps,
  seconds,
  rpe,
  kind,
});

/** A row's values: those logged, or those planned. */
export const valuesOf = (row: Row): SetValues => (row.kind === "logged" ? setValues(row.set) : row.values);

/**
 * A first set when there is nothing to go on: the empty bar for five, or bodyweight alone, or held for half a
 * minute for a timed exercise.
 */
export const firstSet = ({ measure, bodyweight }: Pick<Exercise, "measure" | "bodyweight">): SetValues => ({
  weightKg: bodyweight ? 0 : 20,
  reps: measure === "reps" ? 5 : null,
  seconds: measure === "seconds" ? 30 : null,
  rpe: null,
  kind: "work",
});

/** The most recent other workout, no later than this one, in which the exercise was trained. */
export const lastSession = (
  workouts: readonly WorkoutDetail[],
  workout: Pick<Workout, "id" | "date">,
  exerciseId: string,
): Session | null =>
  sessionsOf(
    workouts.filter((other) => other.id !== workout.id && other.date <= workout.date),
    exerciseId,
  ).at(-1) ?? null;

/** What the lifter has said about the sets still to do: how many more than last time, and what differs. */
export type Intent = {
  readonly extra: number;
  /** By row, the values a set still to do was changed to. */
  readonly changes: ReadonlyMap<number, SetValues>;
};

export const NO_INTENT: Intent = { extra: 0, changes: new Map() };

/**
 * A line of an exercise's table: a set done, or one still to do. `previous` is the set in the same place last
 * session, to lift against.
 */
export type Row =
  | { readonly kind: "logged"; readonly index: number; readonly set: LoggedSet; readonly previous: LoggedSet | null }
  | {
      readonly kind: "planned";
      readonly index: number;
      readonly values: SetValues;
      readonly previous: LoggedSet | null;
    };

/** A set to do is what was done in its place last time, a miss made good; its RPE is left to be felt. */
const planned = ({ weightKg, reps, seconds, kind }: SetValues): SetValues => ({
  weightKg,
  reps: reps === null ? null : Math.max(reps, 1),
  seconds: seconds === null ? null : Math.max(seconds, 1),
  rpe: null,
  kind,
});

/**
 * An exercise's rows in a workout under way. Sets done sit where they were logged; around them are the sets still
 * to do, which follow last session's set for set until the lifter changes one, and number at least one. Where a set
 * done moved on from last session's weight, the sets to do that shared that weight move with it. A row beyond last
 * session's repeats the row above it, and the first ever is `first`.
 */
export const openRows = (
  logged: readonly LoggedSet[],
  lastTime: readonly LoggedSet[],
  intent: Intent,
  first: SetValues,
): Row[] => {
  const placed = new Map<number, LoggedSet>();
  let next = 0;
  for (const set of logged.toSorted(byPosition)) {
    const index = Math.max(set.position, next);
    placed.set(index, set);
    next = index + 1;
  }
  const count = Math.max(next, lastTime.length + intent.extra, 1);

  const rows: Row[] = [];
  // What each of last session's weights became in the sets done so far, by kind.
  const moved = new Map<string, number>();
  const was = ({ kind, weightKg }: SetValues) => `${kind} ${weightKg}`;
  let above = first;
  for (let index = 0; index < count; index++) {
    const set = placed.get(index);
    const previous = lastTime[index] ?? null;
    if (set !== undefined) {
      rows.push({ kind: "logged", index, set, previous });
      if (previous !== null && previous.kind === set.kind) {
        moved.set(was(previous), set.weightKg);
      }
      above = set;
    } else {
      const repeat = planned(previous ?? above);
      const values =
        intent.changes.get(index) ??
        (previous === null ? repeat : { ...repeat, weightKg: moved.get(was(previous)) ?? repeat.weightKg });
      rows.push({ kind: "planned", index, values, previous });
      above = values;
    }
  }
  return rows;
};

/** The rows of a finished workout: the sets done, in order, each against last session's. */
export const doneRows = (logged: readonly LoggedSet[], lastTime: readonly LoggedSet[]): Row[] =>
  logged.toSorted(byPosition).map((set, index) => ({ kind: "logged", index, set, previous: lastTime[index] ?? null }));

/**
 * The intent after changing a set still to do. A changed weight, rep count or time carries down to the sets to do
 * below it that matched the old one, so raising the first working set raises the rest.
 */
export const withChange = (rows: readonly Row[], intent: Intent, index: number, patch: Partial<SetValues>): Intent => {
  const target = rows.find((row) => row.index === index);
  if (target === undefined || target.kind !== "planned") {
    return intent;
  }
  const changes = new Map(intent.changes);
  changes.set(index, { ...target.values, ...patch });
  for (const row of rows) {
    if (row.kind !== "planned" || row.index <= index || row.values.kind !== target.values.kind) {
      continue;
    }
    const carried = {
      ...(patch.weightKg !== undefined &&
        row.values.weightKg === target.values.weightKg && { weightKg: patch.weightKg }),
      ...(patch.reps !== undefined && row.values.reps === target.values.reps && { reps: patch.reps }),
      ...(patch.seconds !== undefined && row.values.seconds === target.values.seconds && { seconds: patch.seconds }),
    };
    if (Object.keys(carried).length > 0) {
      changes.set(row.index, { ...row.values, ...carried });
    }
  }
  return { ...intent, changes };
};

/**
 * The sets still to do from `index` on, logged at once with `values` for the first, as when catching up on an
 * exercise after the fact. What was typed for the first carries down as {@link withChange} carries it, and its RPE
 * goes to every work set.
 */
export const plannedFrom = (
  rows: readonly Row[],
  intent: Intent,
  index: number,
  values: SetValues,
): { readonly values: SetValues; readonly position: number }[] => {
  const { weightKg, reps, seconds } = values;
  const { changes } = withChange(rows, intent, index, { weightKg, reps, seconds });
  return rows.flatMap((row) =>
    row.kind !== "planned" || row.index < index
      ? []
      : [
          {
            position: row.index,
            values:
              row.index === index
                ? values
                : {
                    ...(changes.get(row.index) ?? row.values),
                    rpe: row.values.kind === "work" && values.kind === "work" ? values.rpe : null,
                  },
          },
        ],
  );
};

/** Past workouts to start from: the latest of each distinct line-up of exercises, most recent first. */
export const startingPoints = (workouts: readonly WorkoutDetail[], limit: number): WorkoutDetail[] => {
  const seen = new Set<string>();
  return workouts
    .toReversed()
    .filter((workout) => {
      const lineUp = workout.entries
        .filter((entry) => entry.sets.length > 0)
        .map((entry) => entry.exerciseId)
        .join(" ");
      if (workout.finishedAt === null || lineUp === "" || seen.has(lineUp)) {
        return false;
      }
      seen.add(lineUp);
      return true;
    })
    .slice(0, limit);
};
