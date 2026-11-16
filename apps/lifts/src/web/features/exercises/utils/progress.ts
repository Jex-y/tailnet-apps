import type { LiftSet } from "../../../../contract";
import type { Session } from "../../../../log";
import { isWorkSet, maxShare } from "../../../../strength";
import type { TrendPoint } from "./chart";
import { type LinearFit, linearFit, meanInterval, t975 } from "./fit";

/** The spans of history a trend can be fitted over; `null` weeks is all of it. */
export const WINDOWS = [
  { label: "4W", weeks: 4 },
  { label: "12W", weeks: 12 },
  { label: "6M", weeks: 26 },
  { label: "1Y", weeks: 52 },
  { label: "All", weeks: null },
] as const;

export type Window = (typeof WINDOWS)[number];

/** Twelve weeks: long enough for a dozen sessions or more, short enough that progress is close to a straight line. */
export const DEFAULT_WINDOW: Window = WINDOWS[1];

const WEEK_MS = 7 * 86_400_000;

/** How many weeks `date` is after `today`: negative for a day before it. */
export const weeksFrom = (date: string, today: string): number => (Date.parse(date) - Date.parse(today)) / WEEK_MS;

export type PlacedPoint = TrendPoint & { readonly x: number };

/**
 * The latest session held against the trend of those before it, so it cannot pull the line towards itself: it is
 * `above` only when it beats the 95% prediction interval, a rise the session-to-session scatter does not explain.
 */
export type LatestCheck = {
  readonly point: PlacedPoint;
  readonly expectedKg: number;
  readonly halfWidth: number;
  readonly verdict: "above" | "within" | "below";
};

export type Trend = {
  readonly points: readonly PlacedPoint[];
  /** Over every point in the window, with x in weeks from today, so the line at 0 is the estimate for today. */
  readonly fit: LinearFit | null;
  readonly latest: LatestCheck | null;
};

/** Each session's best estimated max within the window ending today, fitted as a straight line over time. */
export const trendOver = (points: readonly TrendPoint[], today: string, weeks: number | null): Trend => {
  const placed = points
    .map((point) => ({ ...point, x: weeksFrom(point.date, today) }))
    .filter(({ x }) => x <= 0 && (weeks === null || x >= -weeks));
  const fit = linearFit(placed.map(({ x, maxKg }) => ({ x, y: maxKg })));
  const last = placed.at(-1);
  const before = linearFit(placed.slice(0, -1).map(({ x, maxKg }) => ({ x, y: maxKg })));
  const latest =
    last === undefined || before === null
      ? null
      : (() => {
          const expectedKg = before.at(last.x);
          const halfWidth = before.predictionHalfWidth(last.x);
          const verdict =
            last.maxKg > expectedKg + halfWidth ? "above" : last.maxKg < expectedKg - halfWidth ? "below" : "within";
          return { point: last, expectedKg, halfWidth, verdict } as const;
        })();
  return { points: placed, fit, latest };
};

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
