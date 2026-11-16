import { LiftSet, type Measure, Reps, Rpe, Seconds } from "../../../../contract";
import type { SetValues } from "./plan";

/**
 * A set's figures as typed, before they are checked: its count is reps or seconds, as its exercise measures. An empty
 * RPE is no RPE.
 */
export type Draft = { readonly weightKg: string; readonly count: string; readonly rpe: string };

export type Field = keyof Draft;

export const FIELDS = ["weightKg", "count", "rpe"] as const satisfies readonly Field[];

/** Whether a field takes a decimal point: weights in fractions of a plate, RPEs in half steps. */
export const DECIMAL: Record<Field, boolean> = { weightKg: true, count: false, rpe: true };

export const DIGITS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "0"] as const;

export type Key = (typeof DIGITS)[number] | "." | "back";

/** The longest figure a field takes: 1000.00 kg is the most the log holds. */
const MAX_LENGTH = 7;

type Figures = Pick<SetValues, "weightKg" | "reps" | "seconds" | "rpe">;

export const draftOf = ({ weightKg, reps, seconds, rpe }: Figures): Draft => ({
  weightKg: String(weightKg),
  count: String(reps ?? seconds ?? ""),
  rpe: rpe === null ? "" : String(rpe),
});

/**
 * A key pressed into a field. The first key after the field is chosen replaces what it held, as on a calculator, so
 * typing a new weight never needs clearing first; later keys add to it. One decimal point, two places after it, and no
 * leading zeros.
 */
export const press = (text: string, key: Key, { fresh, decimal }: { fresh: boolean; decimal: boolean }): string => {
  const base = fresh ? "" : text;
  if (key === "back") {
    return base.slice(0, -1);
  }
  if (key === ".") {
    return !decimal || base.includes(".") ? base : `${base === "" ? "0" : base}.`;
  }
  const [, places] = base.split(".");
  if (base.length >= MAX_LENGTH || (places !== undefined && places.length >= 2)) {
    return base;
  }
  return base === "0" ? key : base + key;
};

export type Parsed =
  | { readonly ok: true; readonly values: Figures }
  | { readonly ok: false; readonly invalid: readonly Field[] };

const figure = (text: string): number => (text === "" || text.endsWith(".") ? Number.NaN : Number(text));

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
