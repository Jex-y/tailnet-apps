import type {
  Exercise,
  Load,
  LoadKind,
  Prescription,
  Program,
  ProgramDay,
  ProgramExercise,
  TrainingMax,
} from "./contract";
import { byPosition } from "./log";
import { maxShare } from "./strength";

/** Every program one person has written. */
export type Plan = {
  readonly programs: readonly Program[];
  readonly trainingMaxes: readonly TrainingMax[];
  readonly days: readonly ProgramDay[];
  readonly exercises: readonly ProgramExercise[];
  readonly prescriptions: readonly Prescription[];
};

export type ProgramExerciseDetail = ProgramExercise & {
  readonly exercise: Exercise;
  readonly prescriptions: readonly Prescription[];
};
export type ProgramDayDetail = ProgramDay & { readonly exercises: readonly ProgramExerciseDetail[] };
export type ProgramDetail = Program & {
  readonly trainingMaxes: readonly TrainingMax[];
  /** By week, then position within it. */
  readonly days: readonly ProgramDayDetail[];
};

export const byWeekAndPosition = (a: ProgramDay, b: ProgramDay): number => a.week - b.week || byPosition(a, b);

/** Each program with its days, their exercises and their prescriptions in order, oldest program first. */
export const programDetails = (plan: Plan, exercises: readonly Exercise[]): ProgramDetail[] => {
  const exerciseOf = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  const prescriptionsOf = Map.groupBy(plan.prescriptions, (prescription) => prescription.programExerciseId);
  const exercisesOf = Map.groupBy(plan.exercises, (slot) => slot.programDayId);
  const daysOf = Map.groupBy(plan.days, (day) => day.programId);
  const maxesOf = Map.groupBy(plan.trainingMaxes, (max) => max.programId);

  return plan.programs.map((program) => ({
    ...program,
    trainingMaxes: maxesOf.get(program.id) ?? [],
    days: (daysOf.get(program.id) ?? []).toSorted(byWeekAndPosition).map((day) => ({
      ...day,
      exercises: (exercisesOf.get(day.id) ?? []).toSorted(byPosition).flatMap((slot) => {
        const exercise = exerciseOf.get(slot.exerciseId);
        return exercise === undefined
          ? []
          : [{ ...slot, exercise, prescriptions: (prescriptionsOf.get(slot.id) ?? []).toSorted(byPosition) }];
      }),
    })),
  }));
};

/** What a percentage or RPE load is worked out from, and what it is rounded to. */
export type LoadBasis = {
  readonly trainingMaxKg: number | null;
  /** The exercise's estimated max on the day. */
  readonly maxKg: number | null;
  readonly weightStepKg: number;
};

/** Down to a whole number of steps; the hundredths absorb float error such as 0.1 + 0.2. */
export const roundDown = (kg: number, stepKg: number): number =>
  Math.round(Math.floor(Math.round((kg / stepKg) * 1e6) / 1e6) * stepKg * 100) / 100;

/** The weight to lift, or `null` when the basis a load needs is missing. */
export const resolveLoad = (load: Load, reps: number, basis: LoadBasis): number | null => {
  switch (load.kind) {
    case "kg":
      return load.kg;
    case "percent":
      return basis.trainingMaxKg === null
        ? null
        : roundDown((basis.trainingMaxKg * load.percent) / 100, basis.weightStepKg);
    case "rpe": {
      const share = maxShare(reps, load.rpe);
      return basis.maxKg === null || share === null ? null : roundDown(basis.maxKg * share, basis.weightStepKg);
    }
  }
};

/** An amount added to every load of one kind, as from one week of a program to the next. */
export type LoadStep = { readonly kind: LoadKind; readonly by: number };

export const steppedLoad = (load: Load, step: LoadStep): Load => {
  if (load.kind !== step.kind) {
    return load;
  }
  switch (load.kind) {
    case "kg":
      return { ...load, kg: load.kg + step.by };
    case "percent":
      return { ...load, percent: load.percent + step.by };
    case "rpe":
      return { ...load, rpe: load.rpe + step.by };
  }
};

export const loadText = (load: Load): string => {
  switch (load.kind) {
    case "kg":
      return `${load.kg} kg`;
    case "percent":
      return `${load.percent}%`;
    case "rpe":
      return `@${load.rpe}`;
  }
};
