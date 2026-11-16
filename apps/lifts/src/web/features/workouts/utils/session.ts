import type { Exercise, LiftSet } from "../../../../contract";
import { describeCount } from "../../../../log";
import { isWorkSet } from "../../../../strength";
import { formatWeight } from "../../../utils/format";
import { type Row, valuesOf } from "./plan";

/** How long a rest is meant to last, for the bar that fills while resting. */
export const REST_TARGET_MS = 3 * 60_000;

/** The work set ratings offered, from a comfortable six to all-out, in the half steps the log keeps. */
export const RPES = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10] as const;

/** How a row is called: warm-ups as such, work sets counted 1, 2, 3 among themselves. */
export const setName = (rows: readonly Row[], index: number): string =>
  rows[index] !== undefined && valuesOf(rows[index]).kind === "warmup"
    ? "warm-up"
    : `set ${rows.slice(0, index + 1).filter((row) => valuesOf(row).kind === "work").length}`;

/** The first set still to do, which the big button logs. */
export const nextPlanned = (rows: readonly Row[]): Extract<Row, { kind: "planned" }> | null =>
  rows.find((row) => row.kind === "planned") ?? null;

/**
 * The exercise being lifted: the one chosen, while it is still there, else the first with a set still to do, else
 * the last. `null` for a workout with no exercises.
 */
export const currentEntry = <E extends { readonly id: string }>(
  entries: readonly E[],
  rowsOf: (entry: E) => readonly Row[],
  chosen: string | null,
): E | null =>
  entries.find((entry) => entry.id === chosen) ??
  entries.find((entry) => nextPlanned(rowsOf(entry)) !== null) ??
  entries.at(-1) ??
  null;

/**
 * Work sets in a line: runs of the same weight and reps (or seconds) as `3 × 100×8`, then the range of RPEs given, so
 * a whole exercise reads at a glance. Empty when there are no work sets.
 */
export const summariseSets = (
  sets: readonly Pick<LiftSet, "weightKg" | "reps" | "seconds" | "rpe" | "kind">[],
  exercise: Pick<Exercise, "bodyweight">,
): string => {
  const work = sets.filter(isWorkSet);
  const runs: { weightKg: number; count: string; times: number }[] = [];
  for (const set of work) {
    const count = describeCount(set);
    const last = runs.at(-1);
    if (last !== undefined && last.weightKg === set.weightKg && last.count === count) {
      last.times += 1;
    } else {
      runs.push({ weightKg: set.weightKg, count, times: 1 });
    }
  }
  const rpes = work.flatMap(({ rpe }) => (rpe === null ? [] : [rpe]));
  const [low, high] = [Math.min(...rpes), Math.max(...rpes)];
  const effort = rpes.length === 0 ? "" : low === high ? ` @${low}` : ` @${low}–${high}`;
  return (
    runs
      .map(
        ({ weightKg, count, times }) => `${times > 1 ? `${times} × ` : ""}${formatWeight(weightKg, exercise)}×${count}`,
      )
      .join(", ") + effort
  );
};
