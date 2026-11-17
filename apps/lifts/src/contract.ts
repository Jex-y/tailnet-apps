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

/** Zero records a missed attempt. */
export const Reps = z.number().int().min(0).max(100);

/** A timed set's length; zero records a missed attempt, as zero reps does. */
export const Seconds = z.number().int().min(0).max(3600);

export const Rpe = z.number().min(1).max(10).multipleOf(0.5);

/** What a prescribed weight is rounded down to: the smallest jump the plates on hand allow. */
export const WeightStep = z.number().min(0.25).max(10).multipleOf(0.25);
export const DEFAULT_WEIGHT_STEP_KG = 2.5;

const Name = z.string().trim().min(1).max(100);

/** What a set of an exercise counts: repetitions, or seconds held or carried. */
export const MEASURES = ["reps", "seconds"] as const;
export type Measure = (typeof MEASURES)[number];

export const Exercise = z.object({
  id: Id,
  name: Name,
  lift: z.enum(COMPETITION_LIFTS).nullable(),
  weightStepKg: WeightStep,
  /**
   * Fixed once the exercise is logged or programmed, since its sets and prescriptions count in it. The defaults here
   * and on sets let a device's changes queued before timed and bodyweight exercises still land.
   */
  measure: z.enum(MEASURES).default("reps"),
  /**
   * Whether the lifter's bodyweight is part of the load, as in a pull-up. A set's weight is then what is added to it,
   * and its load the two together, from the bodyweight logged with the workout or the nearest one logged.
   */
  bodyweight: z.boolean().default(false),
});
export type Exercise = z.infer<typeof Exercise>;

/** What a workout is called, as Claude names it once it is finished or as the lifter renames it. */
export const WorkoutName = z.string().trim().min(1).max(80);

export const Workout = z.object({
  id: Id,
  /** The training day, wherever in the world it was. */
  date: LocalDate,
  /**
   * `null` until named. A device's write never clears a name: a row it wrote before the name was given still
   * lands without losing it. The default lets changes queued before names still land.
   */
  name: WorkoutName.nullable().default(null),
  /** `null` while the session is still being logged. */
  finishedAt: Instant.nullable(),
  notes: Notes,
  bodyweightKg: Kilograms.nullable(),
});
export type Workout = z.infer<typeof Workout>;

/** Exactly one of a set's or prescription's counts is given: the one its exercise's {@link Measure} names. */
const countedInOne = ({ reps, seconds }: { reps: number | null; seconds: number | null }) =>
  (reps === null) !== (seconds === null);
const COUNTED_IN_ONE = { message: "Give either reps or seconds, not both" };

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

export const LiftSet = z
  .object({
    id: Id,
    entryId: Id,
    /** Order within the entry; ties fall back to id. */
    position: Position,
    /** On top of bodyweight, for an exercise whose load includes it. */
    weightKg: Kilograms,
    /** `null` for a timed exercise. */
    reps: Reps.nullable(),
    /** `null` for an exercise counted in reps. */
    seconds: Seconds.nullable().default(null),
    rpe: Rpe.nullable(),
    kind: z.enum(SET_KINDS),
    /** When the set was written down, which for a backfilled session is not when it was lifted. */
    loggedAt: Instant,
  })
  .refine(countedInOne, COUNTED_IN_ONE);
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

/** Sets of the same reps (or seconds) and load, such as 4×5 at 77.5%. */
export const Prescription = z
  .object({
    id: Id,
    programExerciseId: Id,
    /** Order within the exercise; ties fall back to id. */
    position: Position,
    sets: z.number().int().min(1).max(20),
    /** `null` for a timed exercise. */
    reps: z.number().int().min(1).max(30).nullable(),
    /** `null` for an exercise counted in reps. */
    seconds: Seconds.min(1).nullable(),
    load: Load,
    kind: z.enum(SET_KINDS),
  })
  .refine(countedInOne, COUNTED_IN_ONE);
export type Prescription = z.infer<typeof Prescription>;

export const SESSION_STATES = ["planned", "skipped", "logged"] as const;

const SessionBase = z.object({ id: Id, programDayId: Id, date: LocalDate });

/** A program day given a date. Only a logged session has a workout, and each workout logs at most one session. */
export const ScheduledSession = z.discriminatedUnion("state", [
  SessionBase.extend({ state: z.literal("planned") }),
  SessionBase.extend({ state: z.literal("skipped") }),
  SessionBase.extend({ state: z.literal("logged"), workoutId: Id }),
]);
export type ScheduledSession = z.infer<typeof ScheduledSession>;

export const ExerciseList = z.array(Exercise);
export const WorkoutList = z.array(Workout);
export const EntryList = z.array(Entry);
export const LiftSetList = z.array(LiftSet);
export const ProgramList = z.array(Program);
export const TrainingMaxList = z.array(TrainingMax);
export const ProgramDayList = z.array(ProgramDay);
export const ProgramExerciseList = z.array(ProgramExercise);
export const PrescriptionList = z.array(Prescription);
export const ScheduledSessionList = z.array(ScheduledSession);

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
  put("session.put", ScheduledSession),
  remove("session.delete"),
]);
export type Mutation = z.infer<typeof Mutation>;

/** Changes applied in order, all or nothing. */
export const Push = z.object({ mutations: z.array(Mutation).min(1).max(1000) });
export type Push = z.infer<typeof Push>;

/** Names one push, so a device retrying it after a lost answer does not apply it twice. */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";
export const IdempotencyKey = z.string().min(1).max(200);
