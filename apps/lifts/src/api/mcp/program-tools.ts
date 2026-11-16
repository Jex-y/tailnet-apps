import { HttpError, type McpServer, toolResult } from "@apps/core";
import { z } from "zod";
import { LOAD_KINDS, Load, type Mutation, ProgramDay } from "../../contract";
import { nextPosition } from "../../log";
import { type ProgramDetail, programDetails, steppedLoad } from "../../program";
import type { LiftsMcpDeps } from "./index";
import {
  change,
  destroy,
  ExerciseId,
  edit,
  notFound,
  ProgramDayId,
  ProgramDayInput,
  ProgramFields,
  ProgramId,
  read,
  TrainingMaxInput,
} from "./inputs";
import { briefProgram, fullProgram, maxesOn } from "./render";

const dayMutations = (programId: string, { exercises, ...day }: ProgramDayInput, id: string, position: number) => [
  { type: "programDay.put", row: { id, programId, position, ...day } } satisfies Mutation,
  ...exercises.flatMap(({ prescriptions, ...slot }, slotPosition): Mutation[] => {
    const slotId = crypto.randomUUID();
    return [
      { type: "programExercise.put", row: { id: slotId, programDayId: id, position: slotPosition, ...slot } },
      ...prescriptions.map(
        (prescription, prescriptionPosition): Mutation => ({
          type: "prescription.put",
          row: { id: crypto.randomUUID(), programExerciseId: slotId, position: prescriptionPosition, ...prescription },
        }),
      ),
    ];
  }),
];

const daysMutations = (programId: string, days: readonly ProgramDayInput[]): Mutation[] => {
  const placed = Map.groupBy(days, (day) => day.week);
  return [...placed.values()].flatMap((week) =>
    week.flatMap((day, position) => dayMutations(programId, day, crypto.randomUUID(), position)),
  );
};

export const registerProgramTools = ({ service, now }: LiftsMcpDeps, server: McpServer, owner: string) => {
  const today = () => now().toISOString().slice(0, 10);

  const programsOf = async () => {
    const [plan, log] = await Promise.all([service.plan(owner), service.log(owner)]);
    return { programs: programDetails(plan, log.exercises), log };
  };

  const programOf = async (programId: string): Promise<ProgramDetail> =>
    (await programsOf()).programs.find((program) => program.id === programId) ?? notFound();

  const answer = async (programId: string) => {
    const { programs, log } = await programsOf();
    const program = programs.find((other) => other.id === programId) ?? notFound();
    return fullProgram(program, maxesOn(log, today()));
  };

  server.registerTool(
    "list_programs",
    {
      description: "Reads every program in brief: its weeks, their days, and the span it is scheduled over.",
      annotations: read,
    },
    () =>
      toolResult(async () => {
        const [{ programs }, sessions] = await Promise.all([programsOf(), service.sessions(owner)]);
        return programs.map((program) => briefProgram(program, sessions));
      }),
  );
  server.registerTool(
    "get_program",
    {
      description:
        "Reads one program in full with every id: its training maxes, and each week's days with their exercises and prescriptions, each load also as the weight it comes to today.",
      inputSchema: { programId: ProgramId },
      annotations: read,
    },
    ({ programId }) => toolResult(() => answer(programId)),
  );
  server.registerTool(
    "create_program",
    {
      description:
        "Writes a whole program in one call. Days are given in order within each week. Percentage loads need a training max for their exercise, given here or set when the program is scheduled.",
      inputSchema: {
        ...ProgramFields,
        notes: ProgramFields.notes.default(""),
        trainingMaxes: z.array(TrainingMaxInput).max(50).default([]),
        days: z.array(ProgramDayInput).min(1).max(100),
      },
      annotations: change,
    },
    ({ name, notes, trainingMaxes, days }) =>
      toolResult(async () => {
        const id = crypto.randomUUID();
        await service.apply(owner, [
          { type: "program.put", row: { id, name, notes } },
          ...trainingMaxes.map(
            (max): Mutation => ({ type: "trainingMax.put", row: { id: crypto.randomUUID(), programId: id, ...max } }),
          ),
          ...daysMutations(id, days),
        ]);
        return answer(id);
      }),
  );
  server.registerTool(
    "update_program",
    {
      description: "Renames a program or changes its notes. Only the fields given change.",
      inputSchema: {
        programId: ProgramId,
        name: ProgramFields.name.optional(),
        notes: ProgramFields.notes.optional(),
      },
      annotations: edit,
    },
    ({ programId, name, notes }) =>
      toolResult(async () => {
        const program = await programOf(programId);
        await service.apply(owner, [
          {
            type: "program.put",
            row: { id: program.id, name: name ?? program.name, notes: notes ?? program.notes },
          },
        ]);
        return answer(programId);
      }),
  );
  server.registerTool(
    "put_program_day",
    {
      description:
        "Replaces one day of a program, its name, exercises and prescriptions, wholesale; with no dayId, adds the day after the others of its week.",
      inputSchema: { programId: ProgramId, dayId: ProgramDayId.optional(), ...ProgramDayInput.shape },
      annotations: edit,
    },
    ({ programId, dayId, ...day }) =>
      toolResult(async () => {
        const program = await programOf(programId);
        const existing =
          dayId === undefined ? undefined : (program.days.find((other) => other.id === dayId) ?? notFound());
        const position =
          existing?.week === day.week
            ? existing.position
            : nextPosition(program.days.filter((other) => other.week === day.week));
        await service.apply(owner, [
          ...(existing?.exercises ?? []).map((slot): Mutation => ({ type: "programExercise.delete", id: slot.id })),
          ...dayMutations(programId, day, existing?.id ?? crypto.randomUUID(), position),
        ]);
        return answer(programId);
      }),
  );
  server.registerTool(
    "copy_program_week",
    {
      description:
        "Copies every day of one week to a week that has none, optionally adding a step to each work set's load of one kind, such as 2.5 percent or 5 kg.",
      inputSchema: {
        programId: ProgramId,
        fromWeek: ProgramDay.shape.week,
        toWeek: ProgramDay.shape.week,
        step: z
          .object({ kind: z.enum(LOAD_KINDS), by: z.number().min(-50).max(50) })
          .optional()
          .describe("Added to every work set's load of this kind; loads of other kinds are copied as they are"),
      },
      annotations: change,
    },
    ({ programId, fromWeek, toWeek, step }) =>
      toolResult(async () => {
        const program = await programOf(programId);
        const from = program.days.filter((day) => day.week === fromWeek);
        if (from.length === 0) {
          throw new HttpError(409, `Week ${fromWeek} has no days`);
        }
        if (program.days.some((day) => day.week === toWeek)) {
          throw new HttpError(409, `Week ${toWeek} already has days`);
        }
        const days = from.map(
          (day): ProgramDayInput => ({
            week: toWeek,
            name: day.name,
            exercises: day.exercises.map((slot) => ({
              exerciseId: slot.exerciseId,
              notes: slot.notes,
              prescriptions: slot.prescriptions.map(({ sets, reps, kind, load }) => {
                const stepped = Load.safeParse(step === undefined || kind !== "work" ? load : steppedLoad(load, step));
                if (!stepped.success) {
                  throw new HttpError(400, `That step takes a load out of range: ${z.prettifyError(stepped.error)}`);
                }
                return { sets, reps, kind, load: stepped.data };
              }),
            })),
          }),
        );
        await service.apply(owner, daysMutations(programId, days));
        return answer(programId);
      }),
  );
  server.registerTool(
    "remove_program_day",
    {
      description: "Removes a day from its program, with its sessions. Cannot be undone.",
      inputSchema: { dayId: ProgramDayId },
      annotations: destroy,
    },
    ({ dayId }) =>
      toolResult(async () => {
        const program =
          (await programsOf()).programs.find((other) => other.days.some((day) => day.id === dayId)) ?? notFound();
        await service.apply(owner, [{ type: "programDay.delete", id: dayId }]);
        return answer(program.id);
      }),
  );
  server.registerTool(
    "delete_program",
    {
      description: "Deletes a program and its schedule. Workouts already logged from it stay. Cannot be undone.",
      inputSchema: { programId: ProgramId },
      annotations: destroy,
    },
    ({ programId }) =>
      toolResult(async () => {
        await programOf(programId);
        await service.apply(owner, [{ type: "program.delete", id: programId }]);
        return { deleted: programId };
      }),
  );
  server.registerTool(
    "set_training_max",
    {
      description:
        "Sets the training max a program's percentage loads of one exercise are taken from, or clears it with null.",
      inputSchema: {
        programId: ProgramId,
        exerciseId: ExerciseId,
        kg: TrainingMaxInput.shape.kg.nullable().describe("null to clear it"),
      },
      annotations: edit,
    },
    ({ programId, exerciseId, kg }) =>
      toolResult(async () => {
        const program = await programOf(programId);
        const held = program.trainingMaxes.find((max) => max.exerciseId === exerciseId);
        await service.apply(owner, [
          kg === null
            ? { type: "trainingMax.delete", id: held?.id ?? notFound() }
            : { type: "trainingMax.put", row: { id: held?.id ?? crypto.randomUUID(), programId, exerciseId, kg } },
        ]);
        return answer(programId);
      }),
  );
};
