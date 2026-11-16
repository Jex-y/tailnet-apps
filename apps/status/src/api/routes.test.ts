import { afterAll, describe, expect, test } from "bun:test";
import {
  type AppModule,
  appRoutes,
  coreMigrations,
  defineJob,
  defineSchedule,
  drainJobs,
  enqueueDueSchedules,
  type JobsDatabase,
} from "@apps/core";
import { createTestContext, startTestServer, uniqueLogin } from "@apps/core/testing";
import { drizzle } from "drizzle-orm/bun-sql";
import { z } from "zod";
import { type Probed, StatusReport } from "../contract";
import { createStatusApp } from "../module";
import { parseBuildInfo } from "./report";

const DAY = 24 * 60 * 60_000;
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

const slug = `status-test-${crypto.randomUUID()}`;
const tick = defineJob({
  name: `${slug}.tick`,
  payload: z.object({}),
  handle: async () => {},
});
const broken = defineJob({
  name: `${slug}.broken`,
  payload: z.object({}),
  maxAttempts: 1,
  handle: async () => {
    throw new Error("upstream said no");
  },
});
const retired = defineJob({
  name: `${slug}.retired`,
  payload: z.object({}),
  handle: async () => {},
});
const schedule = defineSchedule({
  name: `${slug}.daily`,
  everyMs: DAY,
  job: tick,
  payload: {},
});

const fakeApp: AppModule = {
  slug,
  title: "Fake app",
  routes: appRoutes({}),
  jobs: [tick, broken],
  schedules: [schedule],
  mcp: { instructions: "", listing: "shared", registerTools: () => {} },
};

/** Registered before the context, whose own `afterAll` closes the connection this needs. */
afterAll(async () => {
  await context.sql`delete from jobs.jobs where name like ${`${slug}.%`}`;
  await context.sql`delete from jobs.hourly_outcomes where name like ${`${slug}.%`}`;
  await context.sql`delete from jobs.schedules where name like ${`${slug}.%`}`;
});

const context = createTestContext();
const statusApp = (ctx: typeof context) =>
  createStatusApp(ctx, {
    apps: [fakeApp],
    migrations: [coreMigrations],
    build: { commit: COMMIT },
  });
const request = startTestServer((ctx) => [statusApp(ctx)], context);
const requestWithoutStorage = startTestServer((ctx) => [statusApp(ctx)], {
  ...context,
  blob: { ...context.blob, endpoint: "http://127.0.0.1:9" },
});

const fetchReport = async (send = request): Promise<StatusReport> => {
  const response = await send("/status/api/report", { as: uniqueLogin() });
  expect(response.status).toBe(200);
  return StatusReport.parse(await response.json());
};

const ok = <T>(probe: Probed<T>): T => {
  if (probe.status === "down") {
    throw new Error(`expected the probe to be up, got: ${probe.error}`);
  }
  return probe.value;
};

describe("status api", () => {
  test("requires a Tailscale identity", async () => {
    expect((await request("/status/api/report")).status).toBe(401);
  });

  test("serves the page", async () => {
    const response = await request("/status/");
    expect(await response.text()).toContain('<div id="root">');
  });

  test("reports the queue, schedules, migrations and services", async () => {
    await context.jobs.enqueue(tick, {});
    await context.jobs.enqueue(tick, {});
    await context.jobs.enqueue(broken, {});
    await drainJobs(context.sql, [tick, broken]);
    await context.jobs.enqueue(tick, {}, { runAt: new Date(Date.now() + DAY) });
    await context.jobs.enqueue(retired, {});
    const db: JobsDatabase = drizzle({ client: context.sql });
    await enqueueDueSchedules(db, [schedule], new Date());

    const report = await fetchReport();

    expect(report.server).toMatchObject({
      commit: COMMIT,
      bunVersion: Bun.version,
    });
    expect(ok(report.postgres).schemas.map((schema) => schema.name)).toContain("jobs");
    ok(report.blob);

    const queue = ok(report.queue);
    const job = (name: string) => queue.jobs.find((summary) => summary.name === name);
    expect(job(tick.name)).toMatchObject({
      registered: true,
      ready: 1,
      waiting: 1,
      running: 0,
      last24h: { completed: 2, retrying: 0, dead: 0 },
    });
    expect(job(broken.name)).toMatchObject({
      registered: true,
      dead: 1,
      last24h: { completed: 0, retrying: 0, dead: 1 },
    });
    expect(job(retired.name)).toMatchObject({ registered: false, ready: 1 });
    expect(queue.hourly).toHaveLength(24);
    expect(queue.recentFailures.filter((failure) => failure.name === broken.name)).toEqual([
      {
        id: expect.any(String),
        name: broken.name,
        state: "dead",
        attempts: 1,
        maxAttempts: 1,
        error: expect.stringContaining("upstream said no"),
        failedAt: expect.any(String),
      },
    ]);

    expect(ok(report.schedules)).toEqual([
      {
        name: schedule.name,
        everyMs: DAY,
        jitterMs: 0,
        lastEnqueued: {
          slotStartedAt: expect.any(String),
          runAt: expect.any(String),
        },
        next: { kind: "scheduled", runAt: expect.any(String) },
      },
    ]);
    expect(ok(report.migrations)).toEqual([{ slug: "jobs", state: { kind: "current", applied: expect.any(Number) } }]);
    expect(report.apps).toEqual([{ slug, title: "Fake app", jobs: 2, schedules: 1 }]);
  });

  test("an unreachable service fails its own part of the report, not the whole", async () => {
    const report = await fetchReport(requestWithoutStorage);

    expect(report.blob.status).toBe("down");
    ok(report.postgres);
    ok(report.queue);
  });
});

describe("build info", () => {
  test("reads the commit CI bakes into the image, and treats an empty one as a local build", () => {
    expect(parseBuildInfo({ GIT_SHA: COMMIT })).toEqual({ commit: COMMIT });
    expect(parseBuildInfo({ GIT_SHA: "" })).toEqual({ commit: null });
    expect(parseBuildInfo({})).toEqual({ commit: null });
  });

  test("refuses a malformed commit", () => {
    expect(() => parseBuildInfo({ GIT_SHA: "main" })).toThrow();
  });
});
