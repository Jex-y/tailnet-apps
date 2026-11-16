import { COMPETITION_LIFTS, type CompetitionLift, type Exercise } from "../../../../contract";
import { sessionsOf, type WorkoutDetail } from "../../../../log";
import { bestEstimate } from "../../../../strength";

export const LIFT_NAMES: Record<CompetitionLift, string> = {
  squat: "Squat",
  bench: "Bench press",
  deadlift: "Deadlift",
};

/** The competition lifts no exercise stands for yet, to offer as a first exercise. */
export const missingLifts = (exercises: readonly Exercise[]): CompetitionLift[] =>
  COMPETITION_LIFTS.filter((lift) => !exercises.some((exercise) => exercise.lift === lift));

/** How an exercise is loaded and counted, chosen as one. */
export type Style = Pick<Exercise, "measure" | "bodyweight">;

export const STYLES = [
  { label: "Weight × reps", measure: "reps", bodyweight: false },
  { label: "Bodyweight + kg × reps", measure: "reps", bodyweight: true },
  { label: "Weight × time", measure: "seconds", bodyweight: false },
  { label: "Bodyweight + kg × time", measure: "seconds", bodyweight: true },
] as const satisfies readonly (Style & { readonly label: string })[];

export const DEFAULT_STYLE: Style = STYLES[0];

export const styleKey = ({ measure, bodyweight }: Style): string => `${measure}${bodyweight ? "+bodyweight" : ""}`;

export type ExerciseSummary = {
  readonly exercise: Exercise;
  readonly sessions: number;
  readonly lastTrainedOn: string | null;
  readonly bestMaxKg: number | null;
};

/** Each exercise with how often and how recently it was trained and its best estimated max, in the order given. */
export const summarise = (exercises: readonly Exercise[], workouts: readonly WorkoutDetail[]): ExerciseSummary[] =>
  exercises.map((exercise) => {
    const sessions = sessionsOf(workouts, exercise.id);
    return {
      exercise,
      sessions: sessions.length,
      lastTrainedOn: sessions.at(-1)?.workout.date ?? null,
      bestMaxKg: bestEstimate(sessions.flatMap((session) => session.sets))?.maxKg ?? null,
    };
  });

export type Standing = { readonly lift: CompetitionLift; readonly maxKg: number | null };

/** The best estimated max in each competition lift, and their total once all three have one. */
export const standings = (
  summaries: readonly ExerciseSummary[],
): { readonly lifts: readonly Standing[]; readonly totalKg: number | null } => {
  const lifts = COMPETITION_LIFTS.map((lift) => ({
    lift,
    maxKg: summaries.find((summary) => summary.exercise.lift === lift)?.bestMaxKg ?? null,
  }));
  return {
    lifts,
    totalKg: lifts.reduce<number | null>(
      (total, { maxKg }) => (total === null || maxKg === null ? null : total + maxKg),
      0,
    ),
  };
};
