import { describe, expect, test } from "bun:test";
import { startTestServer, uniqueLogin } from "@apps/core/testing";
import { createLiftsTestContext, NOW } from "../../test/support";
import {
  type Entry,
  EntryList,
  type Exercise,
  ExerciseList,
  IDEMPOTENCY_HEADER,
  type LiftSet,
  LiftSetList,
  type Mutation,
  type Workout,
  WorkoutList,
} from "../contract";
import { createLiftsApp } from "../module";

const context = createLiftsTestContext();
const request = startTestServer((ctx) => [createLiftsApp(ctx, { now: () => NOW })], context);
const me = uniqueLogin();

const push = (mutations: readonly unknown[], { as = me, key = crypto.randomUUID() as string | null } = {}) =>
  request("/lifts/api/push", {
    as,
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key !== null && { [IDEMPOTENCY_HEADER]: key }) },
    body: JSON.stringify({ mutations }),
  });

const errorOf = async (response: Response, status: number) => {
  expect(response.status).toBe(status);
  return ((await response.json()) as { error: string }).error;
};

const read = async (as = me) => {
  const get = async (path: string) => (await request(`/lifts/api/${path}`, { as })).json();
  return {
    exercises: ExerciseList.parse(await get("exercises")),
    workouts: WorkoutList.parse(await get("workouts")),
    entries: EntryList.parse(await get("entries")),
    sets: LiftSetList.parse(await get("sets")),
  };
};

const exercise = (fields: Partial<Exercise> = {}): Exercise => ({
  id: crypto.randomUUID(),
  name: "Squat",
  lift: null,
  weightStepKg: 2.5,
  ...fields,
});
const workout = (fields: Partial<Workout> = {}): Workout => ({
  id: crypto.randomUUID(),
  date: "2026-10-01",
  finishedAt: null,
  notes: "",
  bodyweightKg: null,
  ...fields,
});
const entry = (workoutId: string, exerciseId: string, fields: Partial<Entry> = {}): Entry => ({
  id: crypto.randomUUID(),
  workoutId,
  exerciseId,
  position: 0,
  notes: "",
  ...fields,
});
const set = (entryId: string, fields: Partial<LiftSet> = {}): LiftSet => ({
  id: crypto.randomUUID(),
  entryId,
  position: 0,
  weightKg: 140,
  reps: 5,
  rpe: 8,
  kind: "work",
  loggedAt: NOW.toISOString(),
  ...fields,
});

/** A squat session of one set, as the mutations that log it and the rows they write. */
const session = () => {
  const squat = exercise();
  const today = workout();
  const squats = entry(today.id, squat.id);
  const top = set(squats.id);
  const mutations: Mutation[] = [
    { type: "exercise.put", row: squat },
    { type: "workout.put", row: today },
    { type: "entry.put", row: squats },
    { type: "set.put", row: top },
  ];
  return { squat, today, squats, top, mutations };
};

describe("lifts api", () => {
  test("requires a Tailscale identity", async () => {
    expect((await request("/lifts/api/sets")).status).toBe(401);
    expect((await request("/lifts/api/push", { method: "POST" })).status).toBe(401);
  });

  test("serves the page", async () => {
    expect((await request("/lifts")).headers.get("Location")).toBe("/lifts/");
    expect(await (await request("/lifts/history")).text()).toContain('<div id="root">');
  });

  test("writes a pushed session, for the person who pushed it only", async () => {
    const { squat, today, squats, top, mutations } = session();

    expect((await push(mutations)).status).toBe(204);

    expect(await read()).toEqual({ exercises: [squat], workouts: [today], entries: [squats], sets: [top] });
    expect(await read(uniqueLogin())).toEqual({ exercises: [], workouts: [], entries: [], sets: [] });
  });

  test("replaces a row put again, keeping fractional weights and half RPEs", async () => {
    const { today, top, mutations } = session();
    await push(mutations);

    await push([
      { type: "set.put", row: { ...top, weightKg: 142.5, reps: 4, rpe: 8.5 } },
      { type: "workout.put", row: { ...today, finishedAt: NOW.toISOString(), bodyweightKg: 82.35, notes: "Fast" } },
    ]);

    const log = await read();
    expect(log.sets).toEqual([{ ...top, weightKg: 142.5, reps: 4, rpe: 8.5 }]);
    expect(log.workouts).toEqual([{ ...today, finishedAt: NOW.toISOString(), bodyweightKg: 82.35, notes: "Fast" }]);
  });

  test("refuses rows the contract does not allow, and a push without a key", async () => {
    const { squats, top, mutations } = session();
    await push(mutations);

    expect((await push([{ type: "set.put", row: { ...top, rpe: 7.3 } }])).status).toBe(400);
    expect((await push([{ type: "set.put", row: { ...top, reps: -1 } }])).status).toBe(400);
    expect((await push([{ type: "entry.rename", id: squats.id }])).status).toBe(400);
    expect((await push([])).status).toBe(400);
    expect(await errorOf(await push([{ type: "set.put", row: top }], { key: null }), 400)).toBe(
      "A push needs an Idempotency-Key header",
    );
  });
});

describe("a push", () => {
  test("applies all of its changes or none", async () => {
    const { squat, today, mutations } = session();
    const orphan = set(crypto.randomUUID());

    expect(await errorOf(await push([...mutations, { type: "set.put", row: orphan }]), 409)).toBe(
      "That exercise is no longer in the workout",
    );
    expect(await read()).toEqual({ exercises: [], workouts: [], entries: [], sets: [] });

    expect(await errorOf(await push([{ type: "entry.put", row: entry(crypto.randomUUID(), squat.id) }]), 409)).toBe(
      "That workout no longer exists",
    );
    await push([{ type: "workout.put", row: today }]);
    expect(await errorOf(await push([{ type: "entry.put", row: entry(today.id, squat.id) }]), 409)).toBe(
      "That exercise no longer exists",
    );
  });

  test("lands once however often it is sent", async () => {
    const { top, mutations } = session();
    const key = crypto.randomUUID();
    await push(mutations, { key });
    await push([{ type: "set.put", row: { ...top, weightKg: 150 } }]);

    expect((await push(mutations, { key })).status).toBe(204);

    expect((await read()).sets).toEqual([{ ...top, weightKg: 150 }]);
  });

  test("can be sent again under the same key after being refused", async () => {
    const { squat, today, squats, top } = session();
    const key = crypto.randomUUID();
    const late: Mutation[] = [{ type: "set.put", row: top }];

    expect((await push(late, { key })).status).toBe(409);
    await push([
      { type: "exercise.put", row: squat },
      { type: "workout.put", row: today },
      { type: "entry.put", row: squats },
    ]);
    expect((await push(late, { key })).status).toBe(204);

    expect((await read()).sets).toEqual([top]);
  });

  test("keeps one person's key from hiding another's push", async () => {
    const key = crypto.randomUUID();
    const someone = uniqueLogin();
    await push(session().mutations, { key });

    await push(session().mutations, { key, as: someone });

    expect((await read(someone)).sets).toHaveLength(1);
  });
});

describe("ownership", () => {
  test("refuses to write over, hang rows off or delete another person's log", async () => {
    const { squat, today, squats, top, mutations } = session();
    await push(mutations);
    const someone = uniqueLogin();
    const as = { as: someone };

    expect((await push([{ type: "workout.put", row: { ...today, notes: "Mine now" } }], as)).status).toBe(404);
    expect((await push([{ type: "exercise.put", row: { ...squat, name: "Mine now" } }], as)).status).toBe(404);
    expect((await push([{ type: "set.put", row: { ...top, weightKg: 1 } }], as)).status).toBe(409);
    expect((await push([{ type: "entry.put", row: entry(today.id, squat.id) }], as)).status).toBe(409);
    expect((await push([{ type: "set.put", row: set(squats.id) }], as)).status).toBe(409);
    expect((await push([{ type: "workout.delete", id: today.id }], as)).status).toBe(204);
    expect((await push([{ type: "set.delete", id: top.id }], as)).status).toBe(204);

    expect(await read()).toEqual({ exercises: [squat], workouts: [today], entries: [squats], sets: [top] });
  });
});

describe("deleting", () => {
  test("takes a workout's exercises and sets with it, and succeeds on what is already gone", async () => {
    const { squat, today, mutations } = session();
    await push(mutations);

    expect((await push([{ type: "workout.delete", id: today.id }])).status).toBe(204);
    expect((await push([{ type: "workout.delete", id: today.id }])).status).toBe(204);

    expect(await read()).toEqual({ exercises: [squat], workouts: [], entries: [], sets: [] });
  });

  test("keeps an exercise that has been logged", async () => {
    const { squat, squats, mutations } = session();
    await push(mutations);

    expect(await errorOf(await push([{ type: "exercise.delete", id: squat.id }]), 409)).toBe(
      '"Squat" has been logged 1 times, so it cannot be deleted',
    );
    await push([{ type: "entry.delete", id: squats.id }]);
    expect((await push([{ type: "exercise.delete", id: squat.id }])).status).toBe(204);

    expect((await read()).exercises).toEqual([]);
  });
});

describe("competition lifts", () => {
  test("lets one exercise stand for each", async () => {
    const squat = exercise({ lift: "squat" });
    await push([{ type: "exercise.put", row: squat }]);

    expect(
      await errorOf(await push([{ type: "exercise.put", row: exercise({ name: "Low bar", lift: "squat" }) }]), 409),
    ).toBe('"Squat" is already your squat');
    expect((await push([{ type: "exercise.put", row: { ...squat, name: "Back squat" } }])).status).toBe(204);
    expect((await push([{ type: "exercise.put", row: exercise({ name: "Bench", lift: "bench" }) }])).status).toBe(204);
    expect(
      (await push([{ type: "exercise.put", row: exercise({ lift: "squat" }) }], { as: uniqueLogin() })).status,
    ).toBe(204);
  });
});
