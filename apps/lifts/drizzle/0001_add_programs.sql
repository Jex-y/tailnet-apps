CREATE TYPE "lifts"."load_kind" AS ENUM('kg', 'percent', 'rpe');--> statement-breakpoint
CREATE TABLE "lifts"."prescriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"program_exercise_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"sets" integer NOT NULL,
	"reps" integer NOT NULL,
	"load_kind" "lifts"."load_kind" NOT NULL,
	"load_kg" numeric(6, 2),
	"load_percent" numeric(4, 1),
	"load_rpe" numeric(3, 1),
	"kind" "lifts"."set_kind" NOT NULL,
	CONSTRAINT "sets_positive" CHECK ("lifts"."prescriptions"."sets" >= 1),
	CONSTRAINT "reps_positive" CHECK ("lifts"."prescriptions"."reps" >= 1),
	CONSTRAINT "load_matches_kind" CHECK (("lifts"."prescriptions"."load_kg" is not null)::int + ("lifts"."prescriptions"."load_percent" is not null)::int + ("lifts"."prescriptions"."load_rpe" is not null)::int = 1
        and case "lifts"."prescriptions"."load_kind"
          when 'kg' then "lifts"."prescriptions"."load_kg" is not null
          when 'percent' then "lifts"."prescriptions"."load_percent" is not null
          when 'rpe' then "lifts"."prescriptions"."load_rpe" is not null
        end)
);
--> statement-breakpoint
CREATE TABLE "lifts"."program_days" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"program_id" uuid NOT NULL,
	"week" integer NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "program_days_owner_id_unique" UNIQUE("owner","id"),
	CONSTRAINT "week_positive" CHECK ("lifts"."program_days"."week" >= 1)
);
--> statement-breakpoint
CREATE TABLE "lifts"."program_exercises" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"program_day_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	CONSTRAINT "program_exercises_owner_id_unique" UNIQUE("owner","id")
);
--> statement-breakpoint
CREATE TABLE "lifts"."programs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "programs_owner_id_unique" UNIQUE("owner","id")
);
--> statement-breakpoint
CREATE TABLE "lifts"."training_maxes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"program_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"kg" numeric(6, 2) NOT NULL,
	CONSTRAINT "training_maxes_owner_program_id_exercise_id_unique" UNIQUE("owner","program_id","exercise_id"),
	CONSTRAINT "training_max_positive" CHECK ("lifts"."training_maxes"."kg" > 0)
);
--> statement-breakpoint
ALTER TABLE "lifts"."exercises" ADD COLUMN "weight_step_kg" numeric(4, 2) DEFAULT 2.5 NOT NULL;--> statement-breakpoint
ALTER TABLE "lifts"."prescriptions" ADD CONSTRAINT "prescriptions_owner_program_exercise_id_program_exercises_owner_id_fk" FOREIGN KEY ("owner","program_exercise_id") REFERENCES "lifts"."program_exercises"("owner","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifts"."program_days" ADD CONSTRAINT "program_days_owner_program_id_programs_owner_id_fk" FOREIGN KEY ("owner","program_id") REFERENCES "lifts"."programs"("owner","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifts"."program_exercises" ADD CONSTRAINT "program_exercises_owner_program_day_id_program_days_owner_id_fk" FOREIGN KEY ("owner","program_day_id") REFERENCES "lifts"."program_days"("owner","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifts"."program_exercises" ADD CONSTRAINT "program_exercises_owner_exercise_id_exercises_owner_id_fk" FOREIGN KEY ("owner","exercise_id") REFERENCES "lifts"."exercises"("owner","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifts"."training_maxes" ADD CONSTRAINT "training_maxes_owner_program_id_programs_owner_id_fk" FOREIGN KEY ("owner","program_id") REFERENCES "lifts"."programs"("owner","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifts"."training_maxes" ADD CONSTRAINT "training_maxes_owner_exercise_id_exercises_owner_id_fk" FOREIGN KEY ("owner","exercise_id") REFERENCES "lifts"."exercises"("owner","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prescriptions_owner_program_exercise_id_index" ON "lifts"."prescriptions" USING btree ("owner","program_exercise_id");--> statement-breakpoint
CREATE INDEX "program_days_owner_program_id_index" ON "lifts"."program_days" USING btree ("owner","program_id");--> statement-breakpoint
CREATE INDEX "program_exercises_owner_program_day_id_index" ON "lifts"."program_exercises" USING btree ("owner","program_day_id");--> statement-breakpoint
CREATE INDEX "program_exercises_owner_exercise_id_index" ON "lifts"."program_exercises" USING btree ("owner","exercise_id");--> statement-breakpoint
ALTER TABLE "lifts"."exercises" ADD CONSTRAINT "weight_step_positive" CHECK ("lifts"."exercises"."weight_step_kg" > 0);