import { HttpError, type McpServer, toolResult } from "@apps/core";
import { z } from "zod";
import type { Mutation, ScheduledSession } from "../../contract";
import { workoutDetails } from "../../log";
import { type ProgramDetail, programDetails, roundDown } from "../../program";
import { addDays, movedSessions, scheduleDates, sessionStatus, WEEKDAYS } from "../../schedule";
import type { LiftsMcpDeps } from "./index";
import { change, destroy, edit, notFound, ProgramId, read, SessionId, TrainingMaxInput } from "./inputs";
import { basisOn, scheduledSession } from "./render";

const LocalDate = z.iso.date();

export const registerScheduleTools = ({ service, now }: LiftsMcpDeps, server: McpServer, owner: string) => {
  const today = () => now().toISOString().slice(0, 10);

  const state = async () => {
    const [plan, log] = await Promise.all([service.plan(owner), service.log(owner)]);
    return { plan, log, programs: programDetails(plan, log.exercises) };
  };

  const programOfDay = (programs: readonly ProgramDetail[], programDayId: string) =>
    programs.find((program) => program.days.some((day) => day.id === programDayId)) ?? notFound();

  const sessionsOf = (sessions: readonly ScheduledSession[], program: ProgramDetail) =>
    sessions.filter((session) => program.days.some((day) => day.id === session.programDayId));

  const scheduleBetween = async (from: string, to: string) => {
    const { plan, log, programs } = await state();
    const workoutOf = new Map(workoutDetails(log).map((workout) => [workout.id, workout]));
    const basis = basisOn(log, today());
    return plan.sessions
      .filter((session) => session.date >= from && session.date <= to)
      .map((session) => {
        const program = programOfDay(programs, session.programDayId);
        const workout = session.state === "logged" ? workoutOf.get(session.workoutId) : undefined;
        return scheduledSession(session, program, sessionStatus(session, workout, today()), basis);
      });
  };

  const findSession = async (sessionId: string) => {
    const found = await state();
    const session = found.plan.sessions.find((other) => other.id === sessionId) ?? notFound();
    if (session.state === "logged") {
      throw new HttpError(409, "That session is already logged");
    }
    return { ...found, session, program: programOfDay(found.programs, session.programDayId) };
  };

  server.registerTool(
    "schedule_program",
    {
      description:
        "Dates every day of a program: week n takes the seven days from startsOn plus n − 1 weeks, and its days take that span's training weekdays in order. Sets a training max for each exercise with percentage loads that has none, from trainingMaxes or else from today's estimated max.",
      inputSchema: {
        programId: ProgramId,
        startsOn: LocalDate.describe("The first day of week 1, YYYY-MM-DD"),
        weekdays: z.array(z.enum(WEEKDAYS)).min(1).max(7).describe("The days of the week to train on"),
        trainingMaxes: z.array(TrainingMaxInput).max(50).default([]),
      },
      annotations: change,
    },
    ({ programId, startsOn, weekdays, trainingMaxes }) =>
      toolResult(async () => {
        const { plan, log, programs } = await state();
        const program = programs.find((other) => other.id === programId) ?? notFound();
        if (sessionsOf(plan.sessions, program).some((session) => session.state !== "logged")) {
          throw new HttpError(409, "That program is already scheduled; unschedule it first");
        }
        const dating = scheduleDates(program.days, startsOn, weekdays);
        if (dating.kind === "too_few_weekdays") {
          throw new HttpError(400, `A week of this program has ${dating.needed} days, so it needs that many weekdays`);
        }
        const { maxes } = basisOn(log, today());
        const covered = new Set([
          ...program.trainingMaxes.map((max) => max.exerciseId),
          ...trainingMaxes.map((max) => max.exerciseId),
        ]);
        const percentLoaded = new Map(
          program.days
            .flatMap((day) => day.exercises)
            .filter((slot) => slot.prescriptions.some((prescription) => prescription.load.kind === "percent"))
            .map((slot) => [slot.exerciseId, slot.exercise] as const),
        );
        const estimated = [...percentLoaded.values()]
          .filter((exercise) => !covered.has(exercise.id))
          .flatMap((exercise) => {
            const estimate = maxes.get(exercise.id);
            return estimate === undefined
              ? []
              : [{ exerciseId: exercise.id, kg: roundDown(estimate, exercise.weightStepKg) }];
          });
        const newMaxes = [...trainingMaxes, ...estimated].map(
          ({ exerciseId, kg }): Mutation => ({
            type: "trainingMax.put",
            row: {
              id: program.trainingMaxes.find((max) => max.exerciseId === exerciseId)?.id ?? crypto.randomUUID(),
              programId,
              exerciseId,
              kg,
            },
          }),
        );
        await service.apply(owner, [
          ...newMaxes,
          ...dating.days.map(
            ({ programDayId, date }): Mutation => ({
              type: "session.put",
              row: { id: crypto.randomUUID(), programDayId, date, state: "planned" },
            }),
          ),
        ]);
        const dates = dating.days.map(({ date }) => date).toSorted();
        return scheduleBetween(dates[0] ?? startsOn, dates.at(-1) ?? startsOn);
      }),
  );
  server.registerTool(
    "get_schedule",
    {
      description:
        "Reads the scheduled sessions between two days, each with its status (due, late, upcoming, under_way, done or skipped); one not yet logged also with its prescriptions and the weights they come to today.",
      inputSchema: {
        from: LocalDate.optional().describe("YYYY-MM-DD; two weeks ago unless given"),
        to: LocalDate.optional().describe("YYYY-MM-DD; two weeks ahead unless given"),
      },
      annotations: read,
    },
    ({ from, to }) => toolResult(() => scheduleBetween(from ?? addDays(today(), -14), to ?? addDays(today(), 14))),
  );
  server.registerTool(
    "move_session",
    {
      description:
        "Moves a session not yet logged to another day, with shiftLater moving its program's later planned sessions by as many days.",
      inputSchema: { sessionId: SessionId, date: LocalDate, shiftLater: z.boolean().default(false) },
      annotations: edit,
    },
    ({ sessionId, date, shiftLater }) =>
      toolResult(async () => {
        const { plan, session, program } = await findSession(sessionId);
        const moved = movedSessions(sessionsOf(plan.sessions, program), session, date, shiftLater);
        await service.apply(
          owner,
          moved.map((row): Mutation => ({ type: "session.put", row })),
        );
        const dates = moved.map((row) => row.date).toSorted();
        return scheduleBetween(dates[0] ?? date, dates.at(-1) ?? date);
      }),
  );
  server.registerTool(
    "skip_session",
    {
      description: "Marks a session not yet logged as skipped, or as planned again with skipped false.",
      inputSchema: { sessionId: SessionId, skipped: z.boolean().default(true) },
      annotations: edit,
    },
    ({ sessionId, skipped }) =>
      toolResult(async () => {
        const { session } = await findSession(sessionId);
        await service.apply(owner, [
          {
            type: "session.put",
            row: {
              id: session.id,
              programDayId: session.programDayId,
              date: session.date,
              state: skipped ? "skipped" : "planned",
            },
          },
        ]);
        return scheduleBetween(session.date, session.date);
      }),
  );
  server.registerTool(
    "unschedule_program",
    {
      description: "Removes a program's planned and skipped sessions; logged ones stay. Cannot be undone.",
      inputSchema: { programId: ProgramId },
      annotations: destroy,
    },
    ({ programId }) =>
      toolResult(async () => {
        const { plan, programs } = await state();
        const program = programs.find((other) => other.id === programId) ?? notFound();
        const removed = sessionsOf(plan.sessions, program).filter((session) => session.state !== "logged");
        await service.apply(
          owner,
          removed.map((session): Mutation => ({ type: "session.delete", id: session.id })),
        );
        return { unscheduled: removed.length };
      }),
  );
};
