import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import {
  COMPETITION_LIFTS,
  DEFAULT_WEIGHT_STEP_KG,
  LOAD_KINDS,
  MEASURES,
  SESSION_STATES,
  SET_KINDS,
} from "../contract";

export const liftsSchema = pgSchema("lifts");

export const competitionLift = liftsSchema.enum("competition_lift", COMPETITION_LIFTS);
export const setKind = liftsSchema.enum("set_kind", SET_KINDS);
export const loadKind = liftsSchema.enum("load_kind", LOAD_KINDS);
export const sessionState = liftsSchema.enum("session_state", SESSION_STATES);
export const measure = liftsSchema.enum("measure", MEASURES);

const instant = (name: string) => timestamp(name, { withTimezone: true });
const kilograms = (name: string) => numeric(name, { precision: 6, scale: 2, mode: "number" });

/**
 * Ids come from whoever creates the row, so a device can write while offline. Every child names its parent together
 * with the owner, which is why each table is unique on (owner, id): nothing can hang off another person's rows.
 */
const identity = () => ({
  id: uuid("id").primaryKey(),
  owner: text("owner").notNull(),
});

export const exercises = liftsSchema.table(
  "exercises",
  {
    ...identity(),
    name: text("name").notNull(),
    lift: competitionLift("lift"),
    weightStepKg: numeric("weight_step_kg", { precision: 4, scale: 2, mode: "number" })
      .notNull()
      .default(DEFAULT_WEIGHT_STEP_KG),
    measure: measure("measure").notNull().default("reps"),
    bodyweight: boolean("bodyweight").notNull().default(false),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.owner, table.id),
    unique().on(table.owner, table.lift),
    check("weight_step_positive", sql`${table.weightStepKg} > 0`),
  ],
);

export const workouts = liftsSchema.table(
  "workouts",
  {
    ...identity(),
    date: date("date", { mode: "string" }).notNull(),
    finishedAt: instant("finished_at"),
    notes: text("notes").notNull().default(""),
    bodyweightKg: kilograms("bodyweight_kg"),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [unique().on(table.owner, table.id), index().on(table.owner, table.date)],
);

export const entries = liftsSchema.table(
  "entries",
  {
    ...identity(),
    workoutId: uuid("workout_id").notNull(),
    exerciseId: uuid("exercise_id").notNull(),
    position: integer("position").notNull(),
    notes: text("notes").notNull().default(""),
  },
  (table) => [
    unique().on(table.owner, table.id),
    foreignKey({ columns: [table.owner, table.workoutId], foreignColumns: [workouts.owner, workouts.id] }).onDelete(
      "cascade",
    ),
    foreignKey({ columns: [table.owner, table.exerciseId], foreignColumns: [exercises.owner, exercises.id] }),
    index().on(table.owner, table.workoutId),
    index().on(table.owner, table.exerciseId),
  ],
);

export const sets = liftsSchema.table(
  "sets",
  {
    ...identity(),
    entryId: uuid("entry_id").notNull(),
    position: integer("position").notNull(),
    weightKg: kilograms("weight_kg").notNull(),
    reps: integer("reps"),
    seconds: integer("seconds"),
    rpe: numeric("rpe", { precision: 3, scale: 1, mode: "number" }),
    kind: setKind("kind").notNull(),
    loggedAt: instant("logged_at").notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.owner, table.entryId], foreignColumns: [entries.owner, entries.id] }).onDelete(
      "cascade",
    ),
    index().on(table.owner, table.entryId),
    check("weight_not_negative", sql`${table.weightKg} >= 0`),
    check("reps_not_negative", sql`${table.reps} >= 0`),
    check("seconds_not_negative", sql`${table.seconds} >= 0`),
    check("counted_in_one", sql`(${table.reps} is null) <> (${table.seconds} is null)`),
    check("rpe_in_half_steps", sql`${table.rpe} between 1 and 10 and ${table.rpe} * 2 = trunc(${table.rpe} * 2)`),
  ],
);

export const programs = liftsSchema.table(
  "programs",
  {
    ...identity(),
    name: text("name").notNull(),
    notes: text("notes").notNull().default(""),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [unique().on(table.owner, table.id)],
);

export const trainingMaxes = liftsSchema.table(
  "training_maxes",
  {
    ...identity(),
    programId: uuid("program_id").notNull(),
    exerciseId: uuid("exercise_id").notNull(),
    kg: kilograms("kg").notNull(),
  },
  (table) => [
    unique().on(table.owner, table.programId, table.exerciseId),
    foreignKey({ columns: [table.owner, table.programId], foreignColumns: [programs.owner, programs.id] }).onDelete(
      "cascade",
    ),
    foreignKey({ columns: [table.owner, table.exerciseId], foreignColumns: [exercises.owner, exercises.id] }),
    check("training_max_positive", sql`${table.kg} > 0`),
  ],
);

export const programDays = liftsSchema.table(
  "program_days",
  {
    ...identity(),
    programId: uuid("program_id").notNull(),
    week: integer("week").notNull(),
    position: integer("position").notNull(),
    name: text("name").notNull(),
  },
  (table) => [
    unique().on(table.owner, table.id),
    foreignKey({ columns: [table.owner, table.programId], foreignColumns: [programs.owner, programs.id] }).onDelete(
      "cascade",
    ),
    index().on(table.owner, table.programId),
    check("week_positive", sql`${table.week} >= 1`),
  ],
);

export const programExercises = liftsSchema.table(
  "program_exercises",
  {
    ...identity(),
    programDayId: uuid("program_day_id").notNull(),
    exerciseId: uuid("exercise_id").notNull(),
    position: integer("position").notNull(),
    notes: text("notes").notNull().default(""),
  },
  (table) => [
    unique().on(table.owner, table.id),
    foreignKey({
      columns: [table.owner, table.programDayId],
      foreignColumns: [programDays.owner, programDays.id],
    }).onDelete("cascade"),
    foreignKey({ columns: [table.owner, table.exerciseId], foreignColumns: [exercises.owner, exercises.id] }),
    index().on(table.owner, table.programDayId),
    index().on(table.owner, table.exerciseId),
  ],
);

/** A load is stored as its kind and exactly the one column that kind reads. */
export const prescriptions = liftsSchema.table(
  "prescriptions",
  {
    ...identity(),
    programExerciseId: uuid("program_exercise_id").notNull(),
    position: integer("position").notNull(),
    sets: integer("sets").notNull(),
    reps: integer("reps"),
    seconds: integer("seconds"),
    loadKind: loadKind("load_kind").notNull(),
    loadKg: kilograms("load_kg"),
    loadPercent: numeric("load_percent", { precision: 4, scale: 1, mode: "number" }),
    loadRpe: numeric("load_rpe", { precision: 3, scale: 1, mode: "number" }),
    kind: setKind("kind").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.owner, table.programExerciseId],
      foreignColumns: [programExercises.owner, programExercises.id],
    }).onDelete("cascade"),
    index().on(table.owner, table.programExerciseId),
    check("sets_positive", sql`${table.sets} >= 1`),
    check("reps_positive", sql`${table.reps} >= 1`),
    check("seconds_positive", sql`${table.seconds} >= 1`),
    check("counted_in_one", sql`(${table.reps} is null) <> (${table.seconds} is null)`),
    check(
      "load_matches_kind",
      sql`(${table.loadKg} is not null)::int + (${table.loadPercent} is not null)::int + (${table.loadRpe} is not null)::int = 1
        and case ${table.loadKind}
          when 'kg' then ${table.loadKg} is not null
          when 'percent' then ${table.loadPercent} is not null
          when 'rpe' then ${table.loadRpe} is not null
        end`,
    ),
  ],
);

/** A workout logging a session cannot be deleted until the session lets go of it. */
export const scheduledSessions = liftsSchema.table(
  "scheduled_sessions",
  {
    ...identity(),
    programDayId: uuid("program_day_id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    state: sessionState("state").notNull(),
    workoutId: uuid("workout_id"),
  },
  (table) => [
    foreignKey({
      columns: [table.owner, table.programDayId],
      foreignColumns: [programDays.owner, programDays.id],
    }).onDelete("cascade"),
    foreignKey({ columns: [table.owner, table.workoutId], foreignColumns: [workouts.owner, workouts.id] }),
    unique().on(table.owner, table.workoutId),
    index().on(table.owner, table.date),
    index().on(table.owner, table.programDayId),
    check("workout_only_when_logged", sql`(${table.workoutId} is not null) = (${table.state} = 'logged')`),
  ],
);

/** The pushes already applied, so a device retrying one after a lost answer changes nothing. */
export const pushes = liftsSchema.table(
  "pushes",
  {
    owner: text("owner").notNull(),
    key: text("key").notNull(),
    appliedAt: instant("applied_at").notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.owner, table.key] })],
);
