import type { LiftSet } from "../../../../contract";
import { isWorkSet } from "../../../../strength";
import { formatKg } from "../../../utils/format";
import type { Row } from "./plan";

/** How long a rest is meant to last, for the bar that fills while resting. */
export const REST_TARGET_MS = 3 * 60_000;

/** The work set ratings offered, from a comfortable six to all-out, in the half steps the log keeps. */
export const RPES = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10] as const;

/** The weight steps beside the weight, one small and one large each way. */
export const WEIGHT_STEPS = [-5, -2.5, 2.5, 5] as const;

/** A weight moved by a step, kept on the 10 g grid the log stores and within what it accepts. */
export const stepWeight = (weightKg: number, step: number): number =>
  Math.min(1000, Math.max(0, Math.round((weightKg + step) * 100) / 100));

export const stepReps = (reps: number, step: number): number => Math.min(100, Math.max(0, reps + step));

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
 * Work sets in a line: runs of the same weight and reps as `3 × 100×8`, then the range of RPEs given, so a whole
 * exercise reads at a glance. Empty when there are no work sets.
 */
export const summariseSets = (sets: readonly Pick<LiftSet, "weightKg" | "reps" | "rpe" | "kind">[]): string => {
  const work = sets.filter(isWorkSet);
  const runs: { weightKg: number; reps: number; count: number }[] = [];
  for (const { weightKg, reps } of work) {
    const last = runs.at(-1);
    if (last !== undefined && last.weightKg === weightKg && last.reps === reps) {
      last.count += 1;
    } else {
      runs.push({ weightKg, reps, count: 1 });
    }
  }
  const rpes = work.flatMap(({ rpe }) => (rpe === null ? [] : [rpe]));
  const [low, high] = [Math.min(...rpes), Math.max(...rpes)];
  const effort = rpes.length === 0 ? "" : low === high ? ` @${low}` : ` @${low}–${high}`;
  return (
    runs
      .map(({ weightKg, reps, count }) => `${count > 1 ? `${count} × ` : ""}${formatKg(weightKg)}×${reps}`)
      .join(", ") + effort
  );
};
