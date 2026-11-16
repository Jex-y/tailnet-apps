import type { LiftSet } from "./contract";

/**
 * The share of a one-rep max that can be lifted for n reps to failure, from n = 1: the RPE 10 column of the Reactive
 * Training Systems chart. A set at a lower RPE sits further down it by the reps left in reserve.
 */
const MAX_SHARE = [
  // biome-ignore lint/suspicious/noApproximativeNumericConstant: 0.707 is the chart at eleven reps, not √½
  1, 0.955, 0.922, 0.892, 0.863, 0.837, 0.811, 0.786, 0.762, 0.739, 0.707, 0.68, 0.653, 0.626, 0.599, 0.572,
] as const;

type Effort = Pick<LiftSet, "weightKg" | "reps" | "rpe">;

/**
 * The share of a one-rep max a set of `reps` at `rpe` takes, a set without an RPE being all-out. `null` for a missed
 * attempt, and for a set so far from failure that the chart says nothing about it.
 */
export const maxShare = (reps: number, rpe: number | null): number | null => {
  if (reps < 1) {
    return null;
  }
  const repsToFailure = reps + (10 - (rpe ?? 10));
  const below = MAX_SHARE[Math.floor(repsToFailure) - 1];
  const above = MAX_SHARE[Math.ceil(repsToFailure) - 1];
  if (below === undefined || above === undefined) {
    return null;
  }
  return below + (above - below) * (repsToFailure - Math.floor(repsToFailure));
};

/** The one-rep max a set implies, by {@link maxShare}. */
export const estimatedMax = ({ weightKg, reps, rpe }: Effort): number | null => {
  const share = maxShare(reps, rpe);
  return share === null ? null : weightKg / share;
};

export const isWorkSet = (set: Pick<LiftSet, "kind">): boolean => set.kind === "work";

export type Estimate<S> = { readonly set: S; readonly maxKg: number };

/** The work set implying the highest one-rep max; the earliest of equals. */
export const bestEstimate = <S extends Effort & Pick<LiftSet, "kind">>(sets: readonly S[]): Estimate<S> | null =>
  sets.reduce<Estimate<S> | null>((best, set) => {
    const maxKg = isWorkSet(set) ? estimatedMax(set) : null;
    return maxKg !== null && (best === null || maxKg > best.maxKg) ? { set, maxKg } : best;
  }, null);

export type RepRecord<S> = { readonly reps: number; readonly set: S };

/**
 * The heaviest work set at each rep count, fewest reps first, leaving out any rep count beaten by an equal or heavier
 * set of more reps.
 */
export const repRecords = <S extends Effort & Pick<LiftSet, "kind">>(sets: readonly S[]): RepRecord<S>[] => {
  const heaviest = new Map<number, S>();
  for (const set of sets) {
    const held = heaviest.get(set.reps);
    if (isWorkSet(set) && set.reps >= 1 && (held === undefined || set.weightKg > held.weightKg)) {
      heaviest.set(set.reps, set);
    }
  }
  const byReps = [...heaviest].map(([reps, set]) => ({ reps, set })).sort((a, b) => b.reps - a.reps);
  const records: RepRecord<S>[] = [];
  for (const candidate of byReps) {
    const beaten = records.some((record) => record.set.weightKg >= candidate.set.weightKg);
    if (!beaten) {
      records.push(candidate);
    }
  }
  return records.reverse();
};

/** Kilograms moved across the work sets. */
export const tonnage = (sets: readonly (Effort & Pick<LiftSet, "kind">)[]): number =>
  sets.filter(isWorkSet).reduce((total, set) => total + set.weightKg * set.reps, 0);

/**
 * Whether a work set implies a higher one-rep max than every set in `before`. Never on a first session, which has
 * nothing to beat.
 */
export const isRecord = (
  set: Effort & Pick<LiftSet, "kind">,
  before: readonly (Effort & Pick<LiftSet, "kind">)[],
): boolean => {
  const best = bestEstimate(before);
  const maxKg = isWorkSet(set) ? estimatedMax(set) : null;
  return best !== null && maxKg !== null && maxKg > best.maxKg;
};
