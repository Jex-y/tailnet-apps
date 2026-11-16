import { HttpError, type McpServer, toolResult } from "@apps/core";
import { z } from "zod";
import {
  COMPETITION_LIFTS,
  DEFAULT_WEIGHT_STEP_KG,
  Entry,
  Exercise,
  LiftSet,
  type Mutation,
  SET_KINDS,
  Workout,
} from "../../contract";
import { nextPosition, sessionsOf, workoutDetails } from "../../log";
import { bestEstimate, repRecords } from "../../strength";
import type { LiftsMcpDeps } from "./index";
import {
  change,
  destroy,
  EntryId,
  EntryInput,
  ExerciseId,
  edit,
  notFound,
  read,
  round,
  SessionId,
  SetId,
  SetInput,
  WorkoutId,
} from "./inputs";
import { briefWorkout, exerciseSummaries, fullWorkout, maxOf, setText } from "./render";

export const registerLogTools = ({ service, now }: LiftsMcpDeps, server: McpServer, owner: string) => {
  const workoutOf = async (workoutId: string) =>
    fullWorkout(workoutDetails(await service.log(owner)).find((workout) => workout.id === workoutId) ?? notFound());

  const setsFor = (entryId: string, inputs: readonly SetInput[], from = 0): Mutation[] =>
    inputs.map((input, index) => ({
      type: "set.put",
      row: { id: crypto.randomUUID(), entryId, position: from + index, loggedAt: now().toISOString(), ...input },
    }));

  const entriesFor = (workoutId: string, inputs: readonly EntryInput[], from = 0): Mutation[] =>
    inputs.flatMap(({ sets, ...input }, index) => {
      const id = crypto.randomUUID();
      return [
        { type: "entry.put", row: { id, workoutId, position: from + index, ...input } } satisfies Mutation,
        ...setsFor(id, sets),
      ];
    });

  server.registerTool(
    "list_exercises",
    {
      description: "Reads every exercise, with how often and how recently it was trained and its best estimated max.",
      annotations: read,
    },
    () => toolResult(async () => exerciseSummaries(await service.log(owner))),
  );
  server.registerTool(
    "create_exercise",
    {
      description: "Adds an exercise to log sets against.",
      inputSchema: {
        name: Exercise.shape.name,
        lift: Exercise.shape.lift.default(null).describe("The competition lift this exercise is, if it is one"),
        weightStepKg: Exercise.shape.weightStepKg
          .default(DEFAULT_WEIGHT_STEP_KG)
          .describe("What prescribed weights round down to, such as 1 for an exercise loaded with microplates"),
      },
      annotations: change,
    },
    (input) =>
      toolResult(async () => {
        await service.apply(owner, [{ type: "exercise.put", row: { id: crypto.randomUUID(), ...input } }]);
        return exerciseSummaries(await service.log(owner));
      }),
  );
  server.registerTool(
    "update_exercise",
    {
      description:
        "Renames an exercise, changes which competition lift it stands for or the step its prescribed weights round down to. Only the fields given change.",
      inputSchema: {
        exerciseId: ExerciseId,
        name: Exercise.shape.name.optional(),
        lift: z.enum(COMPETITION_LIFTS).nullable().optional().describe("null to stop it standing for a lift"),
        weightStepKg: Exercise.shape.weightStepKg.optional(),
      },
      annotations: edit,
    },
    ({ exerciseId, name, lift, weightStepKg }) =>
      toolResult(async () => {
        const { exercises } = await service.log(owner);
        const exercise = exercises.find((other) => other.id === exerciseId) ?? notFound();
        await service.apply(owner, [
          {
            type: "exercise.put",
            row: {
              ...exercise,
              name: name ?? exercise.name,
              lift: lift === undefined ? exercise.lift : lift,
              weightStepKg: weightStepKg ?? exercise.weightStepKg,
            },
          },
        ]);
        return exerciseSummaries(await service.log(owner));
      }),
  );
  server.registerTool(
    "delete_exercise",
    {
      description: "Deletes an exercise that has never been logged and is in no program. Cannot be undone.",
      inputSchema: { exerciseId: ExerciseId },
      annotations: destroy,
    },
    ({ exerciseId }) =>
      toolResult(async () => {
        const { exercises } = await service.log(owner);
        if (!exercises.some((exercise) => exercise.id === exerciseId)) {
          notFound();
        }
        await service.apply(owner, [{ type: "exercise.delete", id: exerciseId }]);
        return exerciseSummaries(await service.log(owner));
      }),
  );
  server.registerTool(
    "get_exercise_history",
    {
      description:
        "Reads one exercise's sessions newest first, with its best estimated max and the heaviest set at each rep count.",
      inputSchema: {
        exerciseId: ExerciseId,
        limit: z.number().int().min(1).max(200).default(20).describe("How many sessions to read"),
      },
      annotations: read,
    },
    ({ exerciseId, limit }) =>
      toolResult(async () => {
        const log = await service.log(owner);
        const exercise = log.exercises.find((other) => other.id === exerciseId) ?? notFound();
        const sessions = sessionsOf(workoutDetails(log), exerciseId);
        const dateOf = new Map(
          sessions.flatMap(({ workout, sets }) => sets.map((set) => [set.id, workout.date] as const)),
        );
        const all = sessions.flatMap((session) => session.sets);
        const best = bestEstimate(all);
        return {
          exercise,
          bestEstimatedMax:
            best === null
              ? null
              : { maxKg: round(best.maxKg), from: setText(best.set), date: dateOf.get(best.set.id) ?? null },
          repRecords: repRecords(all).map(({ reps, set }) => ({
            reps,
            weightKg: set.weightKg,
            date: dateOf.get(set.id) ?? null,
          })),
          sessions: sessions
            .toReversed()
            .slice(0, limit)
            .map(({ workout, sets }) => ({
              workoutId: workout.id,
              date: workout.date,
              estimatedMaxKg: maxOf(sets),
              sets: sets.map(setText),
            })),
        };
      }),
  );

  server.registerTool(
    "list_workouts",
    {
      description: "Reads workouts newest first, each with its exercises and sets in brief.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(20),
        before: z.iso.date().optional().describe("Only workouts earlier than this day, YYYY-MM-DD, to page back"),
      },
      annotations: read,
    },
    ({ limit, before }) =>
      toolResult(async () =>
        workoutDetails(await service.log(owner))
          .filter((workout) => before === undefined || workout.date < before)
          .toReversed()
          .slice(0, limit)
          .map(briefWorkout),
      ),
  );
  server.registerTool(
    "get_workout",
    {
      description: "Reads one workout in full: every exercise and set with its id, estimated maxes and tonnage.",
      inputSchema: { workoutId: WorkoutId },
      annotations: read,
    },
    ({ workoutId }) => toolResult(() => workoutOf(workoutId)),
  );
  server.registerTool(
    "log_workout",
    {
      description:
        "Records a whole workout: its exercises in order, each with its sets in order. With a sessionId, the workout logs that scheduled session.",
      inputSchema: {
        sessionId: SessionId.optional(),
        date: Workout.shape.date.describe("The training day, YYYY-MM-DD"),
        notes: Workout.shape.notes.default(""),
        bodyweightKg: Workout.shape.bodyweightKg.default(null),
        finished: z.boolean().default(true).describe("false to leave the session open for more sets"),
        exercises: z.array(EntryInput).max(50).default([]),
      },
      annotations: change,
    },
    ({ sessionId, finished, exercises, ...workout }) =>
      toolResult(async () => {
        const id = crypto.randomUUID();
        const session =
          sessionId === undefined
            ? undefined
            : ((await service.sessions(owner)).find((other) => other.id === sessionId) ?? notFound());
        if (session?.state === "logged") {
          throw new HttpError(409, "That session is already logged");
        }
        await service.apply(owner, [
          { type: "workout.put", row: { id, ...workout, finishedAt: finished ? now().toISOString() : null } },
          ...entriesFor(id, exercises),
          ...(session === undefined
            ? []
            : [
                {
                  type: "session.put",
                  row: {
                    id: session.id,
                    programDayId: session.programDayId,
                    date: session.date,
                    state: "logged",
                    workoutId: id,
                  },
                } satisfies Mutation,
              ]),
        ]);
        return workoutOf(id);
      }),
  );
  server.registerTool(
    "update_workout",
    {
      description:
        "Changes a workout's day, notes or bodyweight, or finishes or reopens it. Only the fields given change.",
      inputSchema: {
        workoutId: WorkoutId,
        date: Workout.shape.date.optional(),
        notes: Workout.shape.notes.optional(),
        bodyweightKg: Workout.shape.bodyweightKg.optional().describe("null to clear it"),
        finished: z.boolean().optional(),
      },
      annotations: edit,
    },
    ({ workoutId, date, notes, bodyweightKg, finished }) =>
      toolResult(async () => {
        const { workouts } = await service.log(owner);
        const workout = workouts.find((other) => other.id === workoutId) ?? notFound();
        const finishedAt =
          finished === undefined ? workout.finishedAt : finished ? (workout.finishedAt ?? now().toISOString()) : null;
        await service.apply(owner, [
          {
            type: "workout.put",
            row: {
              id: workout.id,
              date: date ?? workout.date,
              notes: notes ?? workout.notes,
              bodyweightKg: bodyweightKg === undefined ? workout.bodyweightKg : bodyweightKg,
              finishedAt,
            },
          },
        ]);
        return workoutOf(workoutId);
      }),
  );
  server.registerTool(
    "delete_workout",
    {
      description: "Deletes a workout with everything logged in it. Cannot be undone.",
      inputSchema: { workoutId: WorkoutId },
      annotations: destroy,
    },
    ({ workoutId }) =>
      toolResult(async () => {
        const { workouts } = await service.log(owner);
        if (!workouts.some((workout) => workout.id === workoutId)) {
          notFound();
        }
        await service.apply(owner, [{ type: "workout.delete", id: workoutId }]);
        return { deleted: workoutId };
      }),
  );

  server.registerTool(
    "add_workout_exercise",
    {
      description: "Adds an exercise to the end of a workout, optionally with its sets.",
      inputSchema: { workoutId: WorkoutId, ...EntryInput.shape },
      annotations: change,
    },
    ({ workoutId, ...entry }) =>
      toolResult(async () => {
        const { entries } = await service.log(owner);
        const from = nextPosition(entries.filter((other) => other.workoutId === workoutId));
        await service.apply(owner, entriesFor(workoutId, [entry], from));
        return workoutOf(workoutId);
      }),
  );
  server.registerTool(
    "update_workout_exercise",
    {
      description: "Changes the notes on an exercise within a workout.",
      inputSchema: { entryId: EntryId, notes: Entry.shape.notes },
      annotations: edit,
    },
    ({ entryId, notes }) =>
      toolResult(async () => {
        const { entries } = await service.log(owner);
        const entry = entries.find((other) => other.id === entryId) ?? notFound();
        await service.apply(owner, [{ type: "entry.put", row: { ...entry, notes } }]);
        return workoutOf(entry.workoutId);
      }),
  );
  server.registerTool(
    "remove_workout_exercise",
    {
      description: "Removes an exercise from a workout along with its sets. Cannot be undone.",
      inputSchema: { entryId: EntryId },
      annotations: destroy,
    },
    ({ entryId }) =>
      toolResult(async () => {
        const { entries } = await service.log(owner);
        const entry = entries.find((other) => other.id === entryId) ?? notFound();
        await service.apply(owner, [{ type: "entry.delete", id: entryId }]);
        return workoutOf(entry.workoutId);
      }),
  );

  server.registerTool(
    "log_set",
    {
      description: "Adds a set after the others of an exercise within a workout.",
      inputSchema: { entryId: EntryId, ...SetInput.shape },
      annotations: change,
    },
    ({ entryId, ...set }) =>
      toolResult(async () => {
        const { entries, sets } = await service.log(owner);
        const entry = entries.find((other) => other.id === entryId) ?? notFound();
        const from = nextPosition(sets.filter((other) => other.entryId === entryId));
        await service.apply(owner, setsFor(entryId, [set], from));
        return workoutOf(entry.workoutId);
      }),
  );
  server.registerTool(
    "update_set",
    {
      description: "Corrects a set. Only the fields given change.",
      inputSchema: {
        setId: SetId,
        weightKg: LiftSet.shape.weightKg.optional(),
        reps: LiftSet.shape.reps.optional(),
        rpe: LiftSet.shape.rpe.optional().describe("null to clear it"),
        kind: z.enum(SET_KINDS).optional(),
      },
      annotations: edit,
    },
    ({ setId, weightKg, reps, rpe, kind }) =>
      toolResult(async () => {
        const { entries, sets } = await service.log(owner);
        const set = sets.find((other) => other.id === setId) ?? notFound();
        const entry = entries.find((other) => other.id === set.entryId) ?? notFound();
        await service.apply(owner, [
          {
            type: "set.put",
            row: {
              ...set,
              weightKg: weightKg ?? set.weightKg,
              reps: reps ?? set.reps,
              rpe: rpe === undefined ? set.rpe : rpe,
              kind: kind ?? set.kind,
            },
          },
        ]);
        return workoutOf(entry.workoutId);
      }),
  );
  server.registerTool(
    "delete_set",
    {
      description: "Deletes a set. Cannot be undone.",
      inputSchema: { setId: SetId },
      annotations: destroy,
    },
    ({ setId }) =>
      toolResult(async () => {
        const { entries, sets } = await service.log(owner);
        const set = sets.find((other) => other.id === setId) ?? notFound();
        const entry = entries.find((other) => other.id === set.entryId) ?? notFound();
        await service.apply(owner, [{ type: "set.delete", id: setId }]);
        return workoutOf(entry.workoutId);
      }),
  );
};
