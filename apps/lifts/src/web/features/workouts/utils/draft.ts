import { LiftSet, type Measure, Reps, Rpe, Seconds } from "../../../../contract";
import type { SetValues } from "./plan";

/**
 * A set's figures as typed, before they are checked: its count is reps or seconds, as its exercise measures. An empty
 * RPE is no RPE.
 */
export type Draft = { readonly weightKg: string; readonly count: string; readonly rpe: string };

export type Field = keyof Draft;

export const FIELDS = ["weightKg", "count", "rpe"] as const satisfies readonly Field[];

/** Whether a field takes a decimal point, which picks its keyboard: weights in fractions of a plate, RPEs in half steps. */
export const DECIMAL: Record<Field, boolean> = { weightKg: true, count: false, rpe: true };

type Figures = Pick<SetValues, "weightKg" | "reps" | "seconds" | "rpe">;

export const draftOf = ({ weightKg, reps, seconds, rpe }: Figures): Draft => ({
  weightKg: String(weightKg),
  count: String(reps ?? seconds ?? ""),
  rpe: rpe === null ? "" : String(rpe),
});

export type Parsed =
  | { readonly ok: true; readonly values: Figures }
  | { readonly ok: false; readonly invalid: readonly Field[] };

/** A figure as typed on any keyboard, whose decimal point may be a comma. */
const figure = (text: string): number => {
  const typed = text.trim().replace(",", ".");
  return typed === "" ? Number.NaN : Number(typed);
};

/** The draft's figures if the log can hold them, else the fields that it cannot. */
export const parseDraft = (draft: Draft, measure: Measure): Parsed => {
  const weightKg = LiftSet.shape.weightKg.safeParse(figure(draft.weightKg));
  const count = (measure === "reps" ? Reps : Seconds).safeParse(figure(draft.count));
  const rpe = draft.rpe === "" ? null : Rpe.safeParse(figure(draft.rpe));
  if (weightKg.success && count.success && (rpe === null || rpe.success)) {
    return {
      ok: true,
      values: {
        weightKg: weightKg.data,
        reps: measure === "reps" ? count.data : null,
        seconds: measure === "seconds" ? count.data : null,
        rpe: rpe?.data ?? null,
      },
    };
  }
  return {
    ok: false,
    invalid: [
      ...(weightKg.success ? [] : (["weightKg"] as const)),
      ...(count.success ? [] : (["count"] as const)),
      ...(rpe === null || rpe.success ? [] : (["rpe"] as const)),
    ],
  };
};
