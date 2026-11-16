import type { LiftSet } from "../../../../contract";
import { type LinearFit, meanInterval, t975 } from "../../../../fit";
import type { Session } from "../../../../log";
import { isWorkSet, maxShare } from "../../../../strength";
import { weeksFrom } from "../../../../trend";

export const REP_RANGES = [
  { label: "1–3", min: 1, max: 3 },
  { label: "4–6", min: 4, max: 6 },
  { label: "7+", min: 7, max: Number.POSITIVE_INFINITY },
] as const;

type Effort = Pick<LiftSet, "weightKg" | "reps" | "rpe" | "kind">;

export type ProfiledSet<S extends Effort = Effort> = S & { readonly share: number };

export type RangeReading = {
  readonly label: string;
  readonly n: number;
  /** The range's sets against the fitted max, in per cent: positive where they were heavier than it predicts. */
  readonly meanPct: number | null;
  readonly halfWidthPct: number | null;
  /** `strong` or `weak` only when the interval leaves out zero. */
  readonly verdict: "strong" | "weak" | "level" | null;
};

export type RepProfile<S extends Effort = Effort> = {
  readonly maxKg: number;
  readonly halfWidth: number;
  readonly sets: readonly ProfiledSet<S>[];
  readonly ranges: readonly RangeReading[];
};

/**
 * One max fitted to every work set at once, by least squares on weight = max × share(reps, RPE) through the origin,
 * and how far each rep range sits from it. Ranges that read heavy are relatively strong; light ones under-trained.
 * `null` with fewer than two sets the RPE chart covers.
 */
export const repProfile = <S extends Effort>(sets: readonly S[]): RepProfile<S> | null => {
  const profiled = sets.flatMap((set) => {
    const share = isWorkSet(set) ? maxShare(set.reps, set.rpe) : null;
    return share === null ? [] : [{ ...set, share }];
  });
  const n = profiled.length;
  if (n < 2) {
    return null;
  }
  const sumSquares = profiled.reduce((sum, { share }) => sum + share ** 2, 0);
  const maxKg = profiled.reduce((sum, { weightKg, share }) => sum + weightKg * share, 0) / sumSquares;
  const sse = profiled.reduce((sum, { weightKg, share }) => sum + (weightKg - maxKg * share) ** 2, 0);
  const halfWidth = t975(n - 1) * Math.sqrt(sse / (n - 1) / sumSquares);

  const ranges = REP_RANGES.map(({ label, min, max }) => {
    const pcts = profiled
      .filter(({ reps }) => reps >= min && reps <= max)
      .map(({ weightKg, share }) => (weightKg / (maxKg * share) - 1) * 100);
    const interval = meanInterval(pcts);
    const halfWidthPct = interval?.halfWidth ?? null;
    const meanPct = interval?.mean ?? null;
    const verdict =
      meanPct === null || halfWidthPct === null
        ? null
        : meanPct - halfWidthPct > 0
          ? "strong"
          : meanPct + halfWidthPct < 0
            ? "weak"
            : "level";
    return { label, n: pcts.length, meanPct, halfWidthPct, verdict } as const;
  });
  return { maxKg, halfWidth, sets: profiled, ranges };
};

/**
 * Each set's weight carried to today's level along the trend, so sets from weeks apart can be compared: without it a
 * profile pooled over a span of progress reads the span's average, and whichever rep range was trained most recently
 * looks strongest. Left as lifted where there is no trend.
 */
export const atTodaysLevel = (sessions: readonly Session[], fit: LinearFit | null, today: string): LiftSet[] =>
  sessions.flatMap(({ workout, sets }) => {
    const scale = fit === null ? 1 : fit.at(0) / fit.at(weeksFrom(workout.date, today));
    return sets.map((set) => ({ ...set, weightKg: set.weightKg * scale }));
  });
