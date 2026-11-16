import type { AppMcp } from "@apps/core";
import type { LiftsService } from "../service";
import { registerLogTools } from "./log-tools";
import { registerProgramTools } from "./program-tools";
import { registerScheduleTools } from "./schedule-tools";

export type LiftsMcpDeps = {
  readonly service: LiftsService;
  readonly now: () => Date;
};

const INSTRUCTIONS = `The connected person's own strength training log.

- A workout is one training day. It holds exercises in order, and each of those holds its sets in order.
- A set is a weight in kilograms, reps, an optional RPE (1 to 10 in half steps) and a kind: warmup or work. Zero reps
  records a missed attempt. Warm-ups never count towards estimated maxes, records or tonnage.
- An exercise measures reps or seconds. A timed exercise (a weighted plank, a carry) logs seconds instead of reps,
  and has no estimated max. An exercise may also take bodyweight as part of its load (a pull-up, a dip): its sets
  give the weight added, 0 for none, and its load is that plus the workout's bodyweight, or the nearest one logged.
- Estimated one-rep maxes come from the RPE chart on the whole load, taking a set without an RPE as all-out.
- An exercise may stand for one competition lift (squat, bench or deadlift); at most one exercise can stand for each.
- Ids are UUIDs: find exercises with list_exercises, workouts with list_workouts, and the ids of a workout's
  exercises and sets with get_workout. Every change to a workout answers with that workout as it now is.
- A program is weeks of days. Each day lists exercises, each with prescriptions: a number of sets of the same reps
  and load. A load is a fixed weight, a percentage of the program's training max for the exercise, or a target RPE
  worked out from the exercise's estimated max on the day. Worked-out weights round down to the exercise's weight
  step, 2.5 kg unless set; for a bodyweight exercise they are what to add to bodyweight. A timed exercise is
  prescribed seconds instead of reps. Every change to a program answers with that program as it now is.
- Scheduling a program dates each of its days as a session. A session is planned, skipped or logged by a workout;
  log_workout with its sessionId logs it. A planned session is due on its day and late after it, until it is moved,
  skipped or logged.`;

/** Acts on the connected person's own log only. */
export const createLiftsMcp = (deps: LiftsMcpDeps): AppMcp => ({
  instructions: INSTRUCTIONS,
  listing: "own",
  registerTools: (server, viewer) => {
    registerLogTools(deps, server, viewer.login);
    registerProgramTools(deps, server, viewer.login);
    registerScheduleTools(deps, server, viewer.login);
  },
});
