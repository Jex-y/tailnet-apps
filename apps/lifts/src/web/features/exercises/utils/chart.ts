import type { LiftSet } from "../../../../contract";
import type { Session } from "../../../../log";
import { bestEstimate } from "../../../../strength";

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

/**
 * Round values spanning `min` to `max` in about `count` steps of 1, 2 or 5 times a power of ten, the first at or
 * below `min` and the last at or above `max`.
 */
export const niceTicks = (min: number, max: number, count: number): readonly number[] => {
  const span = max - min || Math.abs(max) || 1;
  const rough = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const ratio = rough / magnitude;
  const step = (ratio < 1.5 ? 1 : ratio < 3 ? 2 : ratio < 7 ? 5 : 10) * magnitude;
  const first = Math.floor(min / step) * step;
  const steps = Math.max(1, Math.ceil((max - first) / step - 1e-9));
  return Array.from({ length: steps + 1 }, (_, index) => first + index * step);
};
