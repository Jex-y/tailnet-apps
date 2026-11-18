import { expect, test } from "bun:test";
import { drainJobs } from "@apps/core";
import { uniqueLogin } from "@apps/core/testing";
import { createLiftsTestContext, NOW } from "../../test/support";
import type { Mutation, Workout } from "../contract";
import { liftsDb } from "./db";
import type { WorkoutNamer } from "./namer";
import { pushes } from "./schema";
import { createLiftsService } from "./service";
import { createLiftsWork, NAME_AFTER_MS, PUSH_MEMORY_MS } from "./work";

const context = createLiftsTestContext();
const db = liftsDb(context.sql);

/** A namer that answers each description in turn with the next name, remembering what it was asked. */
const fakeNamer = (...names: string[]) => {
  const asked: string[] = [];
  const namer: WorkoutNamer = {
    name: async (description) => {
      asked.push(description);
      return names.shift() ?? "Another Session";
    },
  };
  return { namer, asked };
};

const setup = (namer: WorkoutNamer | null) => {
  const work = createLiftsWork({ db, namer, now: () => NOW });
  const service = createLiftsService({ db, work });
  // Jobs enqueued directly run at the database's clock, and naming at the adapter's, which is long past.
  const drain = (at?: Date) => drainJobs(context.sql, work.jobs, at);
  return { work, service, drain };
};

const workout = (fields: Partial<Workout> = {}): Workout => ({
  id: crypto.randomUUID(),
  date: "2026-10-01",
  name: null,
  finishedAt: NOW.toISOString(),
  notes: "",
  bodyweightKg: null,
  ...fields,
});

/** A workout with one exercise of two sets. */
const lifted = (row: Workout): Mutation[] => {
  const [exerciseId, entryId] = [crypto.randomUUID(), crypto.randomUUID()];
  const set = (position: number) => ({
    type: "set.put" as const,
    row: {
      id: crypto.randomUUID(),
      entryId,
      position,
      weightKg: 140,
      reps: 5,
      seconds: null,
      rpe: 8,
      kind: "work" as const,
      loggedAt: NOW.toISOString(),
    },
  });
  return [
    {
      type: "exercise.put",
      row: { id: exerciseId, name: "Squat", lift: null, weightStepKg: 2.5, measure: "reps", bodyweight: false },
    },
    { type: "workout.put", row: row },
    { type: "entry.put", row: { id: entryId, workoutId: row.id, exerciseId, position: 0, notes: "" } },
    set(0),
    set(1),
  ];
};

const nameOf = async (owner: string, id: string) =>
  (
    await db.query.workouts.findFirst({
      where: (workouts, { and, eq }) => and(eq(workouts.owner, owner), eq(workouts.id, id)),
    })
  )?.name;

test("forgets pushes once no device could still be retrying them", async () => {
  const owner = uniqueLogin();
  const ago = (ms: number) => new Date(NOW.getTime() - ms);
  await db.insert(pushes).values([
    { owner, key: "old", appliedAt: ago(PUSH_MEMORY_MS + 1000) },
    { owner, key: "recent", appliedAt: ago(PUSH_MEMORY_MS - 1000) },
  ]);
  const { work, drain } = setup(null);

  await context.jobs.enqueue(work.definitions.forgetPushes, {});
  await drain();

  expect((await db.select({ key: pushes.key }).from(pushes)).map((push) => push.key)).toEqual(["recent"]);
});

test("names a workout once it has settled after being finished, from what was lifted", async () => {
  const owner = uniqueLogin();
  const row = workout();
  const { namer, asked } = fakeNamer("Heavy Squat Fives");
  const { service, drain } = setup(namer);

  await service.apply(owner, lifted(row));
  await drain(new Date(NOW.getTime() + NAME_AFTER_MS - 1000));
  expect(await nameOf(owner, row.id)).toBeNull();

  await drain();
  expect(await nameOf(owner, row.id)).toBe("Heavy Squat Fives");
  expect(asked).toHaveLength(1);
  expect(asked[0]).toContain("- Squat: 140×5 @8, 140×5 @8");
});

test("leaves a workout still under way, or already named, as it is", async () => {
  const owner = uniqueLogin();
  const [open, named] = [workout({ finishedAt: null }), workout({ name: "My Own" })];
  const { namer, asked } = fakeNamer();
  const { service, drain } = setup(namer);

  await service.apply(owner, [...lifted(open), ...lifted(named)]);
  await drain();

  expect(asked).toEqual([]);
  expect(await nameOf(owner, open.id)).toBeNull();
  expect(await nameOf(owner, named.id)).toBe("My Own");
});

test("keeps the name when a device that has not seen it writes the workout again", async () => {
  const owner = uniqueLogin();
  const row = workout();
  const { namer } = fakeNamer("Squat Day");
  const { service, drain } = setup(namer);
  await service.apply(owner, lifted(row));
  await drain();

  await service.apply(owner, [{ type: "workout.put", row: { ...row, notes: "Felt quick" } }]);
  expect(await nameOf(owner, row.id)).toBe("Squat Day");

  await service.apply(owner, [{ type: "workout.put", row: { ...row, name: "Renamed" } }]);
  expect(await nameOf(owner, row.id)).toBe("Renamed");
});

test("catches up on finished workouts left unnamed", async () => {
  const owner = uniqueLogin();
  const row = workout();
  const { service } = setup(null);
  await service.apply(owner, lifted(row));
  const { work, drain } = setup(fakeNamer("Back Squats").namer);

  await context.jobs.enqueue(work.definitions.nameUnnamed, {});
  await drain();

  expect(await nameOf(owner, row.id)).toBe("Back Squats");
});
