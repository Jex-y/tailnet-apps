CREATE TYPE "lifts"."session_state" AS ENUM('planned', 'skipped', 'logged');--> statement-breakpoint
CREATE TABLE "lifts"."scheduled_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"program_day_id" uuid NOT NULL,
	"date" date NOT NULL,
	"state" "lifts"."session_state" NOT NULL,
	"workout_id" uuid,
	CONSTRAINT "scheduled_sessions_owner_workout_id_unique" UNIQUE("owner","workout_id"),
	CONSTRAINT "workout_only_when_logged" CHECK (("lifts"."scheduled_sessions"."workout_id" is not null) = ("lifts"."scheduled_sessions"."state" = 'logged'))
);
--> statement-breakpoint
ALTER TABLE "lifts"."scheduled_sessions" ADD CONSTRAINT "scheduled_sessions_owner_program_day_id_program_days_owner_id_fk" FOREIGN KEY ("owner","program_day_id") REFERENCES "lifts"."program_days"("owner","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifts"."scheduled_sessions" ADD CONSTRAINT "scheduled_sessions_owner_workout_id_workouts_owner_id_fk" FOREIGN KEY ("owner","workout_id") REFERENCES "lifts"."workouts"("owner","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_sessions_owner_date_index" ON "lifts"."scheduled_sessions" USING btree ("owner","date");--> statement-breakpoint
CREATE INDEX "scheduled_sessions_owner_program_day_id_index" ON "lifts"."scheduled_sessions" USING btree ("owner","program_day_id");