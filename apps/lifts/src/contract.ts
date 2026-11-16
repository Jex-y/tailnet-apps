import { z } from "zod";

export const LIFTS_API = "/lifts/api";

/** The lifts contested in powerlifting. At most one of a person's exercises stands for each. */
export const COMPETITION_LIFTS = ["squat", "bench", "deadlift"] as const;
export type CompetitionLift = (typeof COMPETITION_LIFTS)[number];

/** Warm-ups are logged but never count towards estimated maxes, records or volume. */
export const SET_KINDS = ["warmup", "work"] as const;
export type SetKind = (typeof SET_KINDS)[number];

const Id = z.uuid();
const LocalDate = z.iso.date();
const Instant = z.iso.datetime();
const Position = z.number().int().min(0).max(10_000);
const Notes = z.string().max(10_000);
const Kilograms = z.number().min(0).max(1000).multipleOf(0.01);

export const Rpe = z.number().min(1).max(10).multipleOf(0.5);

/** What a prescribed weight is rounded down to: the smallest jump the plates on hand allow. */
export const WeightStep = z.number().min(0.25).max(10).multipleOf(0.25);
export const DEFAULT_WEIGHT_STEP_KG = 2.5;

const Name = z.string().trim().min(1).max(100);

export const Exercise = z.object({
  id: Id,
  name: Name,
  lift: z.enum(COMPETITION_LIFTS).nullable(),
  weightStepKg: WeightStep,
});
export type Exercise = z.infer<typeof Exercise>;

export const Workout = z.object({
  id: Id,
  /** The training day, wherever in the world it was. */
  date: LocalDate,
  /** `null` while the session is still being logged. */
  finishedAt: Instant.nullable(),
  notes: Notes,
  bodyweightKg: Kilograms.nullable(),
});
export type Workout = z.infer<typeof Workout>;

/** One exercise as performed in one workout, holding its sets. */
export const Entry = z.object({
  id: Id,
  workoutId: Id,
  exerciseId: Id,
  /** Order within the workout; ties fall back to id. */
  position: Position,
  notes: Notes,
});
export type Entry = z.infer<typeof Entry>;

export const LiftSet = z.object({
  id: Id,
  entryId: Id,
  /** Order within the entry; ties fall back to id. */
  position: Position,
  weightKg: Kilograms,
  /** Zero records a missed attempt. */
  reps: z.number().int().min(0).max(100),
  rpe: Rpe.nullable(),
  kind: z.enum(SET_KINDS),
  /** When the set was written down, which for a backfilled session is not when it was lifted. */
  loggedAt: Instant,
});
export type LiftSet = z.infer<typeof LiftSet>;

/** A block of training: weeks of days, each day exercises, each exercise its prescriptions. */
export const Program = z.object({ id: Id, name: Name, notes: Notes });
export type Program = z.infer<typeof Program>;

/** The max a program's percentage loads of one exercise are taken from, fixed rather than following progress. */
export const TrainingMax = z.object({ id: Id, programId: Id, exerciseId: Id, kg: Kilograms.min(1) });
export type TrainingMax = z.infer<typeof TrainingMax>;

export const ProgramDay = z.object({
  id: Id,
  programId: Id,
  week: z.number().int().min(1).max(52),
  /** Order within the week; ties fall back to id. */
  position: Position,
  name: Name,
});
export type ProgramDay = z.infer<typeof ProgramDay>;

/** One exercise on a program day, holding its prescriptions. */
export const ProgramExercise = z.object({
  id: Id,
  programDayId: Id,
  exerciseId: Id,
  /** Order within the day; ties fall back to id. */
  position: Position,
  notes: Notes,
});
export type ProgramExercise = z.infer<typeof ProgramExercise>;

export const LOAD_KINDS = ["kg", "percent", "rpe"] as const;
export type LoadKind = (typeof LOAD_KINDS)[number];

export const Load = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("kg"), kg: Kilograms }),
  /** Of the program's training max for the exercise. */
  z.object({ kind: z.literal("percent"), percent: z.number().min(10).max(110).multipleOf(0.5) }),
  /** Whatever weight the exercise's max on the day says the reps take at this RPE. */
  z.object({ kind: z.literal("rpe"), rpe: Rpe }),
]);
export type Load = z.infer<typeof Load>;

/** Sets of the same reps and load, such as 4×5 at 77.5%. */
export const Prescription = z.object({
  id: Id,
  programExerciseId: Id,
  /** Order within the exercise; ties fall back to id. */
  position: Position,
  sets: z.number().int().min(1).max(20),
  reps: z.number().int().min(1).max(30),
  load: Load,
  kind: z.enum(SET_KINDS),
});
export type Prescription = z.infer<typeof Prescription>;

export const ExerciseList = z.array(Exercise);
export const WorkoutList = z.array(Workout);
export const EntryList = z.array(Entry);
export const LiftSetList = z.array(LiftSet);
export const ProgramList = z.array(Program);
export const TrainingMaxList = z.array(TrainingMax);
export const ProgramDayList = z.array(ProgramDay);
export const ProgramExerciseList = z.array(ProgramExercise);
export const PrescriptionList = z.array(Prescription);

const put = <T extends string, R extends z.ZodType>(type: T, row: R) => z.object({ type: z.literal(type), row });
const remove = <T extends string>(type: T) => z.object({ type: z.literal(type), id: Id });

/**
 * One change to someone's log. A put writes the whole row, creating it or replacing what was there, and a delete of
 * something already gone succeeds, so replaying a change is harmless.
 */
export const Mutation = z.discriminatedUnion("type", [
  put("exercise.put", Exercise),
  remove("exercise.delete"),
  put("workout.put", Workout),
  remove("workout.delete"),
  put("entry.put", Entry),
  remove("entry.delete"),
  put("set.put", LiftSet),
  remove("set.delete"),
  put("program.put", Program),
  remove("program.delete"),
  put("trainingMax.put", TrainingMax),
  remove("trainingMax.delete"),
  put("programDay.put", ProgramDay),
  remove("programDay.delete"),
  put("programExercise.put", ProgramExercise),
  remove("programExercise.delete"),
  put("prescription.put", Prescription),
  remove("prescription.delete"),
]);
export type Mutation = z.infer<typeof Mutation>;

/** Changes applied in order, all or nothing. */
export const Push = z.object({ mutations: z.array(Mutation).min(1).max(1000) });
export type Push = z.infer<typeof Push>;

/** Names one push, so a device retrying it after a lost answer does not apply it twice. */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";
export const IdempotencyKey = z.string().min(1).max(200);
