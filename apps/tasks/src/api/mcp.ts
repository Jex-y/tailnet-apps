import { type AppMcp, HttpError, type McpServer, toolResult } from "@apps/core";
import { z } from "zod";
import { CreateTask, DurationDays, STATUSES, type TaskList, UpdateTask } from "../contract";
import { blockers, dateOfDay, schedule, topologicalOrder } from "../plan";
import { londonDay } from "./calendar";
import type { TasksService } from "./service";

export type TasksMcpDeps = {
  readonly service: TasksService;
  readonly now: () => Date;
};

const INSTRUCTIONS = `The connected person's own to-do list, whose tasks can depend on one another.

- A task waits on the tasks in its dependsOn; the graph never has a cycle.
- Status is todo, doing or done. A task can only leave todo once everything it waits on is done, and a done task
  can only be reopened while nothing that waits on it has started.
- Each task has a duration estimate in days, an optional startOn (not before) and dueOn (last day to work on it).
- The list comes with a critical-path schedule from today: each unfinished task's scheduled first and last day, its
  slack in days (negative when it will miss a due date) and whether it is critical.
- Every change answers with the whole list as it now is. Ids are UUIDs; find them with list_tasks.`;

const TaskId = z.uuid().describe("The task's id");
const LocalDate = z.iso.date();

/** The list as the model reads it: tasks in dependency order, each with its schedule. */
const planOf = (list: TaskList, today: number) => {
  const slots = schedule(list, today, londonDay);
  const byId = new Map(list.map((task) => [task.id, task]));
  const open = list.flatMap((task) => (task.status === "done" ? [] : (slots.get(task.id) ?? [])));
  return {
    today: dateOfDay(today),
    finishesOn: open.length === 0 ? null : dateOfDay(Math.max(...open.map((slot) => slot.finish)) - 1),
    tasks: topologicalOrder(list).map((task) => {
      const slot = slots.get(task.id);
      return {
        id: task.id,
        title: task.title,
        status: task.status,
        ...(task.notes !== "" && { notes: task.notes }),
        durationDays: task.durationDays,
        startOn: task.startOn,
        dueOn: task.dueOn,
        dependsOn: task.dependsOn,
        waitingOn: task.status === "done" ? [] : blockers(task, byId).map((blocker) => blocker.id),
        scheduled: slot && {
          firstDay: dateOfDay(slot.start),
          lastDay: dateOfDay(slot.finish - 1),
          slackDays: slot.slack,
          critical: slot.critical,
        },
      };
    }),
  };
};

const registerTools = ({ service, now }: TasksMcpDeps, server: McpServer, owner: string) => {
  const plan = async (list: Promise<TaskList>) => planOf(await list, londonDay(now()));

  const change = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
  const edit = { ...change, idempotentHint: true } as const;

  server.registerTool(
    "list_tasks",
    {
      description: "Reads every task in dependency order, with what each waits on and its schedule.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () => toolResult(() => plan(service.list(owner))),
  );
  server.registerTool(
    "create_task",
    {
      description: "Adds a task at the bottom of the todo column.",
      inputSchema: {
        title: CreateTask.shape.title,
        notes: CreateTask.shape.notes,
        durationDays: CreateTask.shape.durationDays.describe("Estimated working days, 1 to 365"),
        startOn: CreateTask.shape.startOn.describe("Earliest day work may begin, YYYY-MM-DD"),
        dueOn: CreateTask.shape.dueOn.describe("Last day the task may be worked on, YYYY-MM-DD"),
        dependsOn: CreateTask.shape.dependsOn.describe("Ids of tasks that must be done first"),
      },
      annotations: change,
    },
    (input) => toolResult(() => plan(service.createTask(owner, input))),
  );
  server.registerTool(
    "update_task",
    {
      description: "Changes a task's details. Only the fields given change; send null to clear a date.",
      inputSchema: {
        taskId: TaskId,
        title: z.string().trim().min(1).max(200).optional(),
        notes: z.string().max(10_000).optional(),
        durationDays: DurationDays.optional(),
        startOn: LocalDate.nullable().optional().describe("Earliest day work may begin, YYYY-MM-DD"),
        dueOn: LocalDate.nullable().optional().describe("Last day the task may be worked on, YYYY-MM-DD"),
      },
      annotations: edit,
    },
    ({ taskId, ...fields }) =>
      toolResult(async () => {
        const update = UpdateTask.safeParse(fields);
        if (!update.success) {
          throw new HttpError(400, z.prettifyError(update.error));
        }
        return plan(service.updateTask(owner, taskId, update.data));
      }),
  );
  server.registerTool(
    "move_task",
    {
      description:
        "Sets a task's status, which moves it between board columns. Refused while it waits on unfinished tasks.",
      inputSchema: {
        taskId: TaskId,
        status: z.enum(STATUSES),
        beforeId: z
          .uuid()
          .nullable()
          .default(null)
          .describe("A task already in that column to place it above; the bottom of the column when omitted"),
      },
      annotations: edit,
    },
    ({ taskId, ...move }) => toolResult(() => plan(service.moveTask(owner, taskId, move))),
  );
  server.registerTool(
    "delete_task",
    {
      description: "Deletes a task; tasks that waited on it stop doing so. Cannot be undone.",
      inputSchema: { taskId: TaskId },
      annotations: { ...change, destructiveHint: true },
    },
    ({ taskId }) => toolResult(() => plan(service.deleteTask(owner, taskId))),
  );
  server.registerTool(
    "add_dependency",
    {
      description: "Makes a task wait on another. Refused if it would create a cycle.",
      inputSchema: { taskId: TaskId, dependsOnId: z.uuid().describe("The task that must be done first") },
      annotations: edit,
    },
    ({ taskId, dependsOnId }) => toolResult(() => plan(service.addDependency(owner, taskId, dependsOnId))),
  );
  server.registerTool(
    "remove_dependency",
    {
      description: "Stops a task waiting on another.",
      inputSchema: { taskId: TaskId, dependsOnId: z.uuid().describe("The task it should no longer wait on") },
      annotations: edit,
    },
    ({ taskId, dependsOnId }) => toolResult(() => plan(service.removeDependency(owner, taskId, dependsOnId))),
  );
};

/** Acts on the connected person's own list only. */
export const createTasksMcp = (deps: TasksMcpDeps): AppMcp => ({
  instructions: INSTRUCTIONS,
  listing: "shared",
  registerTools: (server, viewer) => registerTools(deps, server, viewer.login),
});
