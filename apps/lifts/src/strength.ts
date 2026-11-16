import type { LiftSet } from "./contract";

/**
 * The share of a one-rep max that can be lifted for n reps to failure, from n = 1: the RPE 10 column of the Reactive
 * Training Systems chart. A set at a lower RPE sits further down it by the reps left in reserve.
 */
const MAX_SHARE = [
  // biome-ignore lint/suspicious/noApproximativeNumericConstant: 0.707 is the chart at eleven reps, not √½
  1, 0.955, 0.922, 0.892, 0.863, 0.837, 0.811, 0.786, 0.762, 0.739, 0.707, 0.68, 0.653, 0.626, 0.599, 0.572,
] as const;

/**
 * What an estimate is worked out from. The load is all that was moved, bodyweight included for an exercise whose load
 * includes it, and `null` where that is not known. A timed set has no reps, and so no estimate.
 */
type Effort = { readonly loadKg: number | null } & Pick<LiftSet, "reps" | "rpe">;
type Graded = Effort & Pick<LiftSet, "kind">;

/**
 * The share of a one-rep max a set of `reps` at `rpe` takes, a set without an RPE being all-out. `null` for a missed
 * attempt, and for a set so far from failure that the chart says nothing about it.
 */
export const maxShare = (reps: number | null, rpe: number | null): number | null => {
  if (reps === null || reps < 1) {
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
export const estimatedMax = ({ loadKg, reps, rpe }: Effort): number | null => {
  const share = maxShare(reps, rpe);
  return share === null || loadKg === null ? null : loadKg / share;
};

export const isWorkSet = (set: Pick<LiftSet, "kind">): boolean => set.kind === "work";

export type Estimate<S> = { readonly set: S; readonly maxKg: number };

/** The work set implying the highest one-rep max; the earliest of equals. */
export const bestEstimate = <S extends Graded>(sets: readonly S[]): Estimate<S> | null =>
  sets.reduce<Estimate<S> | null>((best, set) => {
    const maxKg = isWorkSet(set) ? estimatedMax(set) : null;
    return maxKg !== null && (best === null || maxKg > best.maxKg) ? { set, maxKg } : best;
  }, null);

export type RepRecord<S> = { readonly reps: number; readonly loadKg: number; readonly set: S };

/**
 * The heaviest work set at each rep count, fewest reps first, leaving out any rep count beaten by an equal or heavier
 * set of more reps.
 */
export const repRecords = <S extends Graded>(sets: readonly S[]): RepRecord<S>[] => {
  const heaviest = new Map<number, RepRecord<S>>();
  for (const set of sets) {
    const { reps, loadKg } = set;
    const held = reps === null ? undefined : heaviest.get(reps);
    if (
      isWorkSet(set) &&
      reps !== null &&
      reps >= 1 &&
      loadKg !== null &&
      (held === undefined || loadKg > held.loadKg)
    ) {
      heaviest.set(reps, { reps, loadKg, set });
    }
  }
  const records: RepRecord<S>[] = [];
  for (const candidate of [...heaviest.values()].sort((a, b) => b.reps - a.reps)) {
    if (!records.some((record) => record.loadKg >= candidate.loadKg)) {
      records.push(candidate);
    }
  }
  return records.reverse();
};

/** Kilograms moved across the work sets counted in reps whose load is known. */
export const tonnage = (sets: readonly Graded[]): number =>
  sets.filter(isWorkSet).reduce((total, { loadKg, reps }) => total + (loadKg ?? 0) * (reps ?? 0), 0);

/**
 * Whether a work set implies a higher one-rep max than every set in `before`. Never on a first session, which has
 * nothing to beat.
 */
export const isRecord = (set: Graded, before: readonly Graded[]): boolean => {
  const best = bestEstimate(before);
  const maxKg = isWorkSet(set) ? estimatedMax(set) : null;
  return best !== null && maxKg !== null && maxKg > best.maxKg;
};
