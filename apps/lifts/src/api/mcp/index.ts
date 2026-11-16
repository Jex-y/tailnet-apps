import type { AppMcp } from "@apps/core";
import type { LiftsService } from "../service";
import { registerLogTools } from "./log-tools";

export type LiftsMcpDeps = {
  readonly service: LiftsService;
  readonly now: () => Date;
};

const INSTRUCTIONS = `The connected person's own strength training log.

- A workout is one training day. It holds exercises in order, and each of those holds its sets in order.
- A set is a weight in kilograms, reps, an optional RPE (1 to 10 in half steps) and a kind: warmup or work. Zero reps
  records a missed attempt. Warm-ups never count towards estimated maxes, records or tonnage.
- Estimated one-rep maxes come from the RPE chart, taking a set without an RPE as all-out.
- An exercise may stand for one competition lift (squat, bench or deadlift); at most one exercise can stand for each.
- Ids are UUIDs: find exercises with list_exercises, workouts with list_workouts, and the ids of a workout's
  exercises and sets with get_workout. Every change to a workout answers with that workout as it now is.`;

/** Acts on the connected person's own log only. */
export const createLiftsMcp = (deps: LiftsMcpDeps): AppMcp => ({
  instructions: INSTRUCTIONS,
  registerTools: (server, viewer) => registerLogTools(deps, server, viewer.login),
});
