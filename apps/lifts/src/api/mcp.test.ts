import { describe, expect, test } from "bun:test";
import { callTool, connectMcp, startTestServer, uniqueLogin } from "@apps/core/testing";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createLiftsTestContext, NOW } from "../../test/support";
import { createLiftsApp } from "../module";

const context = createLiftsTestContext();
const request = startTestServer((ctx) => [createLiftsApp(ctx, { now: () => NOW })], context);
const me = uniqueLogin();

const connect = (as = me) => connectMcp(request, "/lifts/mcp", as);

type ExerciseSummary = { id: string; name: string; sessions: number; bestEstimatedMaxKg: number | null };
type FullWorkout = {
  id: string;
  finishedAt: string | null;
  tonnageKg: number;
  exercises: { entryId: string; sets: { setId: string; weightKg: number; reps: number; estimatedMaxKg?: number }[] }[];
};

type ProgramPrescription = { text: string; kgToday?: number };
type ProgramSlot = { exercise: { name: string }; prescriptions: ProgramPrescription[] };
type ProgramDay = { dayId: string; name: string; exercises: ProgramSlot[] };
type FullProgram = {
  id: string;
  trainingMaxes: { exerciseId: string; name?: string; kg: number }[];
  weeks: { week: number; days: ProgramDay[] }[];
};

/** Each day's prescriptions as text with the weight they come to today. */
const prescribed = (program: FullProgram) =>
  program.weeks.map(({ week, days }) => ({
    week,
    days: days.map((day) =>
      day.exercises.flatMap((slot) =>
        slot.prescriptions.map(({ text, kgToday }) => `${slot.exercise.name} ${text} → ${kgToday ?? "?"}`),
      ),
    ),
  }));

type Scheduled = {
  sessionId: string;
  date: string;
  status: string;
  day: string;
  workoutId?: string;
  exercises?: ProgramSlot[];
};

type History = { exercise: object; bestEstimatedMax: object | null; repRecords: object[]; sessions: object[] };

const call = async <T = object>(client: Client, name: string, args: Record<string, unknown> = {}) => {
  const result = await callTool(client, name, args);
  expect(result.isError).toBe(false);
  return JSON.parse(result.text) as T;
};

const createExercise = async (client: Client, name: string, lift: string | null = null) => {
  const exercises = await call<ExerciseSummary[]>(client, "create_exercise", { name, lift });
  const created = exercises.find((exercise) => exercise.name === name);
  if (created === undefined) {
    throw new Error(`${name} was not created`);
  }
  return created.id;
};

describe("lifts mcp", () => {
  test("requires a Tailscale identity", async () => {
    const response = await request("/lifts/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);
  });

  test("offers tools for exercises, workouts, sets, programs and schedules", async () => {
    const client = await connect();
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "add_workout_exercise",
      "copy_program_week",
      "create_exercise",
      "create_program",
      "delete_exercise",
      "delete_program",
      "delete_set",
      "delete_workout",
      "get_exercise_history",
      "get_program",
      "get_schedule",
      "get_workout",
      "list_exercises",
      "list_programs",
      "list_workouts",
      "log_set",
      "log_workout",
      "move_session",
      "put_program_day",
      "remove_program_day",
      "remove_workout_exercise",
      "schedule_program",
      "set_training_max",
      "skip_session",
      "unschedule_program",
      "update_exercise",
      "update_program",
      "update_set",
      "update_workout",
      "update_workout_exercise",
    ]);
    expect(client.getInstructions()).toContain("RPE");
  });

  test("logs a workout and reads it back, for the connected person only", async () => {
    const client = await connect();
    const squat = await createExercise(client, "Squat", "squat");

    const workout = await call<FullWorkout>(client, "log_workout", {
      date: "2026-10-01",
      bodyweightKg: 82.5,
      exercises: [
        {
          exerciseId: squat,
          sets: [
            { weightKg: 60, reps: 5, kind: "warmup" },
            { weightKg: 140, reps: 5, rpe: 8 },
            { weightKg: 145, reps: 3, rpe: 9 },
          ],
        },
      ],
    });

    expect(workout).toMatchObject({ finishedAt: NOW.toISOString(), tonnageKg: 1135 });
    expect(workout.exercises[0]?.sets).toEqual([
      expect.objectContaining({ weightKg: 60, reps: 5, kind: "warmup" }),
      expect.objectContaining({ weightKg: 140, reps: 5, rpe: 8, estimatedMaxKg: 172.6 }),
      expect.objectContaining({ weightKg: 145, reps: 3, rpe: 9, estimatedMaxKg: 162.6 }),
    ]);
    expect(workout.exercises[0]?.sets[0]).not.toHaveProperty("estimatedMaxKg");
    expect(await call<object[]>(client, "list_workouts")).toEqual([
      {
        id: workout.id,
        date: "2026-10-01",
        finished: true,
        bodyweightKg: 82.5,
        exercises: [{ name: "Squat", sets: ["60×5 (warm-up)", "140×5 @8", "145×3 @9"] }],
      },
    ]);

    const stranger = await connect(uniqueLogin());
    expect(await call<object[]>(stranger, "list_workouts")).toEqual([]);
    expect(await callTool(stranger, "get_workout", { workoutId: workout.id })).toEqual({
      isError: true,
      text: "Not found",
    });
    expect(await callTool(stranger, "delete_workout", { workoutId: workout.id })).toEqual({
      isError: true,
      text: "Not found",
    });
  });

  test("builds a session up set by set and corrects it", async () => {
    const client = await connect();
    const bench = await createExercise(client, "Bench press");
    const open = await call<FullWorkout>(client, "log_workout", { date: "2026-10-01", finished: false });
    expect(open.finishedAt).toBeNull();

    const added = await call<FullWorkout>(client, "add_workout_exercise", { workoutId: open.id, exerciseId: bench });
    const entryId = added.exercises[0]?.entryId;
    await call<FullWorkout>(client, "log_set", { entryId, weightKg: 100, reps: 5 });
    const logged = await call<FullWorkout>(client, "log_set", { entryId, weightKg: 100, reps: 4, rpe: 9.5 });
    const [first, second] = logged.exercises[0]?.sets ?? [];

    const corrected = await call<FullWorkout>(client, "update_set", { setId: second?.setId, reps: 5, rpe: null });
    expect(corrected.exercises[0]?.sets[1]).toMatchObject({ weightKg: 100, reps: 5, rpe: null });

    const trimmed = await call<FullWorkout>(client, "delete_set", { setId: first?.setId });
    expect(trimmed.exercises[0]?.sets).toEqual([expect.objectContaining({ setId: second?.setId })]);

    const finished = await call<FullWorkout>(client, "update_workout", { workoutId: open.id, finished: true });
    expect(finished.finishedAt).toBe(NOW.toISOString());

    const emptied = await call<FullWorkout>(client, "remove_workout_exercise", { entryId });
    expect(emptied.exercises).toEqual([]);
  });

  test("reads an exercise's history with its best estimate and rep records", async () => {
    const client = await connect();
    const deadlift = await createExercise(client, "Deadlift", "deadlift");
    const sessionOf = (date: string, sets: object[]) =>
      call<FullWorkout>(client, "log_workout", { date, exercises: [{ exerciseId: deadlift, sets }] });
    await sessionOf("2026-09-24", [{ weightKg: 180, reps: 5, rpe: 8 }]);
    const latest = await sessionOf("2026-10-01", [
      { weightKg: 200, reps: 1, rpe: 8 },
      { weightKg: 170, reps: 5 },
    ]);

    expect(await call<History>(client, "get_exercise_history", { exerciseId: deadlift, limit: 1 })).toEqual({
      exercise: { id: deadlift, name: "Deadlift", lift: "deadlift", weightStepKg: 2.5 },
      bestEstimatedMax: { maxKg: 221.9, from: "180×5 @8", date: "2026-09-24" },
      repRecords: [
        { reps: 1, weightKg: 200, date: "2026-10-01" },
        { reps: 5, weightKg: 180, date: "2026-09-24" },
      ],
      sessions: [{ workoutId: latest.id, date: "2026-10-01", estimatedMaxKg: 216.9, sets: ["200×1 @8", "170×5"] }],
    });
    expect(await call<ExerciseSummary[]>(client, "list_exercises")).toEqual([
      expect.objectContaining({
        name: "Deadlift",
        sessions: 2,
        lastTrainedOn: "2026-10-01",
        bestEstimatedMaxKg: 221.9,
      }),
    ]);
  });

  test("hands refusals back as tool errors", async () => {
    const client = await connect();
    const squat = await createExercise(client, "Squat", "squat");
    await call(client, "log_workout", { date: "2026-10-01", exercises: [{ exerciseId: squat }] });

    expect(await callTool(client, "create_exercise", { name: "Low bar", lift: "squat" })).toEqual({
      isError: true,
      text: '"Squat" is already your squat',
    });
    expect(await callTool(client, "delete_exercise", { exerciseId: squat })).toEqual({
      isError: true,
      text: '"Squat" has been logged 1 times, so it cannot be deleted',
    });
    expect(await callTool(client, "log_set", { entryId: crypto.randomUUID(), weightKg: 100, reps: 5 })).toEqual({
      isError: true,
      text: "Not found",
    });
    expect((await callTool(client, "update_exercise", { exerciseId: squat, lift: null })).isError).toBe(false);
    expect((await callTool(client, "create_exercise", { name: "Low bar", lift: "squat" })).isError).toBe(false);
  });

  test("writes a program whose loads come to weights today, and steps a week from it", async () => {
    const client = await connect();
    const squat = await createExercise(client, "Squat", "squat");
    const bench = await createExercise(client, "Bench press", "bench");
    await call(client, "update_exercise", { exerciseId: bench, weightStepKg: 1 });
    await call(client, "log_workout", {
      date: "2026-09-24",
      exercises: [{ exerciseId: squat, sets: [{ weightKg: 140, reps: 5, rpe: 8 }] }],
    });

    const program = await call<FullProgram>(client, "create_program", {
      name: "Strength block",
      trainingMaxes: [
        { exerciseId: squat, kg: 160 },
        { exerciseId: bench, kg: 101 },
      ],
      days: [
        {
          week: 1,
          name: "Heavy",
          exercises: [
            {
              exerciseId: squat,
              prescriptions: [
                { reps: 5, load: { kind: "kg", kg: 60 }, kind: "warmup" },
                { sets: 4, reps: 5, load: { kind: "percent", percent: 75 } },
                { reps: 3, load: { kind: "rpe", rpe: 8 } },
              ],
            },
            { exerciseId: bench, prescriptions: [{ sets: 3, reps: 8, load: { kind: "percent", percent: 70 } }] },
          ],
        },
      ],
    });
    expect(prescribed(program)).toEqual([
      {
        week: 1,
        days: [
          ["Squat 1×5 60 kg (warm-up) → 60", "Squat 4×5 75% → 120", "Squat 1×3 @8 → 147.5", "Bench press 3×8 70% → 70"],
        ],
      },
    ]);

    const stepped = await call<FullProgram>(client, "copy_program_week", {
      programId: program.id,
      fromWeek: 1,
      toWeek: 2,
      step: { kind: "percent", by: 2.5 },
    });
    expect(prescribed(stepped)[1]?.days[0]).toEqual([
      "Squat 1×5 60 kg (warm-up) → 60",
      "Squat 4×5 77.5% → 122.5",
      "Squat 1×3 @8 → 147.5",
      "Bench press 3×8 72.5% → 73",
    ]);
    expect(await callTool(client, "copy_program_week", { programId: program.id, fromWeek: 1, toWeek: 2 })).toEqual({
      isError: true,
      text: "Week 2 already has days",
    });

    const raised = await call<FullProgram>(client, "set_training_max", {
      programId: program.id,
      exerciseId: squat,
      kg: 170,
    });
    expect(prescribed(raised)[0]?.days[0]?.[1]).toBe("Squat 4×5 75% → 127.5");
    expect(await callTool(client, "delete_exercise", { exerciseId: bench })).toEqual({
      isError: true,
      text: '"Bench press" is in the program "Strength block", so it cannot be deleted',
    });

    const dayId = raised.weeks[0]?.days[0]?.dayId;
    const replaced = await call<FullProgram>(client, "put_program_day", {
      programId: program.id,
      dayId,
      week: 1,
      name: "Volume",
      exercises: [{ exerciseId: squat, prescriptions: [{ sets: 5, reps: 5, load: { kind: "kg", kg: 100 } }] }],
    });
    expect(replaced.weeks[0]?.days).toEqual([
      expect.objectContaining({
        dayId,
        name: "Volume",
        exercises: [expect.objectContaining({ prescriptions: [expect.objectContaining({ text: "5×5 100 kg" })] })],
      }),
    ]);

    const stranger = await connect(uniqueLogin());
    expect(await call<object[]>(stranger, "list_programs")).toEqual([]);
    expect((await callTool(stranger, "get_program", { programId: program.id })).isError).toBe(true);

    const trimmed = await call<FullProgram>(client, "remove_program_day", { dayId });
    expect(trimmed.weeks.map(({ week }) => week)).toEqual([2]);
    await call(client, "delete_program", { programId: program.id });
    expect(await call<object[]>(client, "list_programs")).toEqual([]);
    expect((await callTool(client, "delete_exercise", { exerciseId: bench })).isError).toBe(false);
  });

  test("schedules a program, and tracks each session until a workout logs it", async () => {
    const client = await connect();
    const squat = await createExercise(client, "Squat", "squat");
    await call(client, "log_workout", {
      date: "2026-09-24",
      exercises: [{ exerciseId: squat, sets: [{ weightKg: 140, reps: 5, rpe: 8 }] }],
    });
    const program = await call<FullProgram>(client, "create_program", {
      name: "Two a week",
      days: [
        {
          week: 1,
          name: "A",
          exercises: [
            { exerciseId: squat, prescriptions: [{ sets: 3, reps: 5, load: { kind: "percent", percent: 75 } }] },
          ],
        },
        {
          week: 1,
          name: "B",
          exercises: [{ exerciseId: squat, prescriptions: [{ sets: 3, reps: 3, load: { kind: "rpe", rpe: 8 } }] }],
        },
      ],
    });
    await call(client, "copy_program_week", { programId: program.id, fromWeek: 1, toWeek: 2 });
    const schedule = { programId: program.id, startsOn: "2026-09-28" };

    expect(await callTool(client, "schedule_program", { ...schedule, weekdays: ["mon"] })).toEqual({
      isError: true,
      text: "A week of this program has 2 days, so it needs that many weekdays",
    });
    const sessions = await call<Scheduled[]>(client, "schedule_program", { ...schedule, weekdays: ["thu", "mon"] });
    const brief = (rows: Scheduled[]) => rows.map(({ date, status, day }) => `${date} ${day} ${status}`);
    expect(brief(sessions)).toEqual([
      "2026-09-28 A late",
      "2026-10-01 B due",
      "2026-10-05 A upcoming",
      "2026-10-08 B upcoming",
    ]);
    expect(sessions[0]?.exercises?.[0]?.prescriptions).toEqual([
      expect.objectContaining({ text: "3×5 75%", kgToday: 127.5 }),
    ]);
    expect((await call<FullProgram>(client, "get_program", { programId: program.id })).trainingMaxes).toEqual([
      { exerciseId: squat, name: "Squat", kg: 172.5 },
    ]);
    expect(await callTool(client, "schedule_program", { ...schedule, weekdays: ["mon", "thu"] })).toEqual({
      isError: true,
      text: "That program is already scheduled; unschedule it first",
    });

    const [late, due, nextA] = sessions;
    await call(client, "skip_session", { sessionId: late?.sessionId });
    await call(client, "move_session", { sessionId: nextA?.sessionId, date: "2026-10-06", shiftLater: true });
    const workout = await call<FullWorkout>(client, "log_workout", { date: "2026-10-01", sessionId: due?.sessionId });
    expect(brief(await call<Scheduled[]>(client, "get_schedule"))).toEqual([
      "2026-09-28 A skipped",
      "2026-10-01 B done",
      "2026-10-06 A upcoming",
      "2026-10-09 B upcoming",
    ]);
    expect(await callTool(client, "log_workout", { date: "2026-10-01", sessionId: due?.sessionId })).toEqual({
      isError: true,
      text: "That session is already logged",
    });

    await call(client, "delete_workout", { workoutId: workout.id });
    expect(brief(await call<Scheduled[]>(client, "get_schedule", { to: "2026-10-01" }))).toEqual([
      "2026-09-28 A skipped",
      "2026-10-01 B due",
    ]);
    expect(await call<object>(client, "unschedule_program", { programId: program.id })).toEqual({ unscheduled: 4 });
    expect(await call<Scheduled[]>(client, "get_schedule")).toEqual([]);
  });
});
