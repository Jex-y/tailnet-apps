import type { LiftSet } from "./contract";
import { type LinearFit, linearFit } from "./fit";
import type { Session } from "./log";
import { bestEstimate } from "./strength";

export type TrendPoint = {
  readonly date: string;
  readonly maxKg: number;
  /** The set the estimate comes from. */
  readonly set: LiftSet;
};

/** The best estimated max of each session that has one, oldest first. */
export const trend = (sessions: readonly Session[]): TrendPoint[] =>
  sessions.flatMap(({ workout, sets }) => {
    const best = bestEstimate(sets);
    return best === null ? [] : [{ date: workout.date, maxKg: best.maxKg, set: best.set }];
  });

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

/**
 * The max an exercise's sessions put it at on `date`: where the trend over the default window says, with at least
 * three sessions in it, otherwise the best estimate of any session up to then.
 */
export const maxOn = (sessions: readonly Session[], date: string): number | null => {
  const before = sessions.filter(({ workout }) => workout.date <= date);
  const fit = trendOver(trend(before), date, DEFAULT_WINDOW.weeks).fit;
  return fit?.at(0) ?? bestEstimate(before.flatMap(({ sets }) => sets))?.maxKg ?? null;
};
