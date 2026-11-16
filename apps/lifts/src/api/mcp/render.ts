import type { Exercise, Prescription, ScheduledSession } from "../../contract";
import {
  bodyweightOn,
  describeSet,
  type EntryDetail,
  type Log,
  type LoggedSet,
  sessionsOf,
  type WorkoutDetail,
  workoutDetails,
} from "../../log";
import {
  loadText,
  type ProgramDayDetail,
  type ProgramDetail,
  type ProgramExerciseDetail,
  resolveLoad,
} from "../../program";
import type { SessionStatus } from "../../schedule";
import { bestEstimate, estimatedMax, isWorkSet, tonnage } from "../../strength";
import { maxOn } from "../../trend";
import { round } from "./inputs";

export const setText = (set: LoggedSet, exercise: Exercise) =>
  `${describeSet(set, exercise)}${isWorkSet(set) ? "" : " (warm-up)"}`;

/** How an exercise is logged, for Claude to log it the same way. */
export const briefExercise = ({ id, name, measure, bodyweight }: Exercise) => ({ id, name, measure, bodyweight });

export const maxOf = (sets: readonly LoggedSet[]) => {
  const best = bestEstimate(sets);
  return best === null ? null : round(best.maxKg);
};

export const briefWorkout = (workout: WorkoutDetail) => ({
  id: workout.id,
  date: workout.date,
  finished: workout.finishedAt !== null,
  ...(workout.bodyweightKg !== null && { bodyweightKg: workout.bodyweightKg }),
  ...(workout.notes !== "" && { notes: workout.notes }),
  exercises: workout.entries.map((entry) => ({
    name: entry.exercise.name,
    sets: entry.sets.map((set) => setText(set, entry.exercise)),
  })),
});

export const fullEntry = (entry: EntryDetail) => ({
  entryId: entry.id,
  exercise: briefExercise(entry.exercise),
  ...(entry.notes !== "" && { notes: entry.notes }),
  sets: entry.sets.map((set) => {
    const maxKg = isWorkSet(set) ? estimatedMax(set) : null;
    return {
      setId: set.id,
      weightKg: set.weightKg,
      ...(entry.exercise.bodyweight && set.loadKg !== null && { loadKg: set.loadKg }),
      ...(set.reps === null ? { seconds: set.seconds } : { reps: set.reps }),
      rpe: set.rpe,
      kind: set.kind,
      ...(maxKg !== null && { estimatedMaxKg: round(maxKg) }),
    };
  }),
});

export const fullWorkout = (workout: WorkoutDetail) => ({
  id: workout.id,
  date: workout.date,
  finishedAt: workout.finishedAt,
  bodyweightKg: workout.bodyweightKg,
  notes: workout.notes,
  tonnageKg: round(tonnage(workout.entries.flatMap((entry) => entry.sets))),
  exercises: workout.entries.map(fullEntry),
});

export const exerciseSummaries = (log: Log) => {
  const workouts = workoutDetails(log);
  return log.exercises.map((exercise) => {
    const sessions = sessionsOf(workouts, exercise.id);
    return {
      ...exercise,
      sessions: sessions.length,
      lastTrainedOn: sessions.at(-1)?.workout.date ?? null,
      bestEstimatedMaxKg: maxOf(sessions.flatMap((session) => session.sets)),
    };
  });
};

/** What loads are worked out from on a day: each exercise's estimated max, and the bodyweight. */
export type DayBasis = { readonly maxes: ReadonlyMap<string, number>; readonly bodyweightKg: number | null };

export const basisOn = (log: Log, date: string): DayBasis => {
  const workouts = workoutDetails(log);
  return {
    maxes: new Map(
      log.exercises.flatMap((exercise) => {
        const maxKg = maxOn(sessionsOf(workouts, exercise.id), date);
        return maxKg === null ? [] : [[exercise.id, maxKg] as const];
      }),
    ),
    bodyweightKg: bodyweightOn(log.workouts, date),
  };
};

const weeksOf = (program: ProgramDetail) => Map.groupBy(program.days, (day) => day.week);

export const briefProgram = (program: ProgramDetail, sessions: readonly ScheduledSession[]) => {
  const dates = sessions
    .filter((session) => program.days.some((day) => day.id === session.programDayId))
    .map((session) => session.date)
    .toSorted();
  const [first] = dates;
  return {
    id: program.id,
    name: program.name,
    ...(program.notes !== "" && { notes: program.notes }),
    weeks: [...weeksOf(program)].map(([week, days]) => ({ week, days: days.map((day) => day.name) })),
    ...(first !== undefined && { scheduled: { from: first, to: dates.at(-1) } }),
  };
};

const fullPrescription = (prescription: Prescription, exercise: Exercise, kg: number | null) => {
  const { sets, reps, seconds, load, kind } = prescription;
  return {
    prescriptionId: prescription.id,
    sets,
    ...(reps === null ? { seconds } : { reps }),
    kind,
    load,
    text: `${sets}×${reps ?? `${seconds}s`} ${loadText(load, exercise)}${kind === "warmup" ? " (warm-up)" : ""}`,
    ...(kg !== null && { kgToday: kg }),
  };
};

const fullSlot = (program: ProgramDetail, day: DayBasis) => (slot: ProgramExerciseDetail) => {
  const basis = {
    trainingMaxKg: program.trainingMaxes.find((max) => max.exerciseId === slot.exerciseId)?.kg ?? null,
    maxKg: day.maxes.get(slot.exerciseId) ?? null,
    weightStepKg: slot.exercise.weightStepKg,
    bodyweightKg: slot.exercise.bodyweight ? day.bodyweightKg : 0,
  };
  return {
    programExerciseId: slot.id,
    exercise: briefExercise(slot.exercise),
    ...(slot.notes !== "" && { notes: slot.notes }),
    prescriptions: slot.prescriptions.map((prescription) =>
      fullPrescription(prescription, slot.exercise, resolveLoad(prescription.load, prescription.reps, basis)),
    ),
  };
};

const fullDay = (program: ProgramDetail, basis: DayBasis) => (day: ProgramDayDetail) => ({
  dayId: day.id,
  name: day.name,
  exercises: day.exercises.map(fullSlot(program, basis)),
});

export const fullProgram = (program: ProgramDetail, basis: DayBasis) => {
  const nameOf = new Map(
    program.days.flatMap((day) => day.exercises.map((slot) => [slot.exerciseId, slot.exercise.name] as const)),
  );
  return {
    id: program.id,
    name: program.name,
    notes: program.notes,
    trainingMaxes: program.trainingMaxes.map((max) => ({
      exerciseId: max.exerciseId,
      ...(nameOf.has(max.exerciseId) && { name: nameOf.get(max.exerciseId) }),
      kg: max.kg,
    })),
    weeks: [...weeksOf(program)].map(([week, days]) => ({ week, days: days.map(fullDay(program, basis)) })),
  };
};

export const scheduledSession = (
  session: ScheduledSession,
  program: ProgramDetail,
  status: SessionStatus,
  basis: DayBasis,
) => {
  const day = program.days.find((other) => other.id === session.programDayId);
  return {
    sessionId: session.id,
    date: session.date,
    status,
    program: { id: program.id, name: program.name },
    week: day?.week,
    day: day?.name,
    ...(session.state === "logged"
      ? { workoutId: session.workoutId }
      : day !== undefined && { exercises: day.exercises.map(fullSlot(program, basis)) }),
  };
};
