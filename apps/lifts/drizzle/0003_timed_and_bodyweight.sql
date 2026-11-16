CREATE TYPE "lifts"."measure" AS ENUM('reps', 'seconds');--> statement-breakpoint
ALTER TABLE "lifts"."prescriptions" ALTER COLUMN "reps" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "lifts"."sets" ALTER COLUMN "reps" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "lifts"."exercises" ADD COLUMN "measure" "lifts"."measure" DEFAULT 'reps' NOT NULL;--> statement-breakpoint
ALTER TABLE "lifts"."exercises" ADD COLUMN "bodyweight" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lifts"."prescriptions" ADD COLUMN "seconds" integer;--> statement-breakpoint
ALTER TABLE "lifts"."sets" ADD COLUMN "seconds" integer;--> statement-breakpoint
ALTER TABLE "lifts"."prescriptions" ADD CONSTRAINT "seconds_positive" CHECK ("lifts"."prescriptions"."seconds" >= 1);--> statement-breakpoint
ALTER TABLE "lifts"."prescriptions" ADD CONSTRAINT "counted_in_one" CHECK (("lifts"."prescriptions"."reps" is null) <> ("lifts"."prescriptions"."seconds" is null));--> statement-breakpoint
ALTER TABLE "lifts"."sets" ADD CONSTRAINT "seconds_not_negative" CHECK ("lifts"."sets"."seconds" >= 0);--> statement-breakpoint
ALTER TABLE "lifts"."sets" ADD CONSTRAINT "counted_in_one" CHECK (("lifts"."sets"."reps" is null) <> ("lifts"."sets"."seconds" is null));