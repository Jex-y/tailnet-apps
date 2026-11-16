import type { LiftSet, Prescription, ScheduledSession } from "../../contract";
import { type EntryDetail, type Log, sessionsOf, type WorkoutDetail, workoutDetails } from "../../log";
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

export const setText = (set: LiftSet) =>
  `${set.weightKg}×${set.reps}${set.rpe === null ? "" : ` @${set.rpe}`}${isWorkSet(set) ? "" : " (warm-up)"}`;

export const maxOf = (sets: readonly LiftSet[]) => {
  const best = bestEstimate(sets);
  return best === null ? null : round(best.maxKg);
};

export const briefWorkout = (workout: WorkoutDetail) => ({
  id: workout.id,
  date: workout.date,
  finished: workout.finishedAt !== null,
  ...(workout.bodyweightKg !== null && { bodyweightKg: workout.bodyweightKg }),
  ...(workout.notes !== "" && { notes: workout.notes }),
  exercises: workout.entries.map((entry) => ({ name: entry.exercise.name, sets: entry.sets.map(setText) })),
});

export const fullEntry = (entry: EntryDetail) => ({
  entryId: entry.id,
  exercise: { id: entry.exercise.id, name: entry.exercise.name },
  ...(entry.notes !== "" && { notes: entry.notes }),
  sets: entry.sets.map((set) => {
    const maxKg = isWorkSet(set) ? estimatedMax(set) : null;
    return {
      setId: set.id,
      weightKg: set.weightKg,
      reps: set.reps,
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

/** Each exercise's estimated max on `date`, for loads worked out from it. */
export const maxesOn = (log: Log, date: string): ReadonlyMap<string, number> => {
  const workouts = workoutDetails(log);
  return new Map(
    log.exercises.flatMap((exercise) => {
      const maxKg = maxOn(sessionsOf(workouts, exercise.id), date);
      return maxKg === null ? [] : [[exercise.id, maxKg] as const];
    }),
  );
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

const fullPrescription = (prescription: Prescription, kg: number | null) => ({
  prescriptionId: prescription.id,
  sets: prescription.sets,
  reps: prescription.reps,
  kind: prescription.kind,
  load: prescription.load,
  text: `${prescription.sets}×${prescription.reps} ${loadText(prescription.load)}${prescription.kind === "warmup" ? " (warm-up)" : ""}`,
  ...(kg !== null && { kgToday: kg }),
});

const fullSlot = (program: ProgramDetail, maxes: ReadonlyMap<string, number>) => (slot: ProgramExerciseDetail) => {
  const basis = {
    trainingMaxKg: program.trainingMaxes.find((max) => max.exerciseId === slot.exerciseId)?.kg ?? null,
    maxKg: maxes.get(slot.exerciseId) ?? null,
    weightStepKg: slot.exercise.weightStepKg,
  };
  return {
    programExerciseId: slot.id,
    exercise: { id: slot.exercise.id, name: slot.exercise.name },
    ...(slot.notes !== "" && { notes: slot.notes }),
    prescriptions: slot.prescriptions.map((prescription) =>
      fullPrescription(prescription, resolveLoad(prescription.load, prescription.reps, basis)),
    ),
  };
};

const fullDay = (program: ProgramDetail, maxes: ReadonlyMap<string, number>) => (day: ProgramDayDetail) => ({
  dayId: day.id,
  name: day.name,
  exercises: day.exercises.map(fullSlot(program, maxes)),
});

export const fullProgram = (program: ProgramDetail, maxes: ReadonlyMap<string, number>) => {
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
    weeks: [...weeksOf(program)].map(([week, days]) => ({ week, days: days.map(fullDay(program, maxes)) })),
  };
};

export const scheduledSession = (
  session: ScheduledSession,
  program: ProgramDetail,
  status: SessionStatus,
  maxes: ReadonlyMap<string, number>,
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
      : day !== undefined && { exercises: day.exercises.map(fullSlot(program, maxes)) }),
  };
};
