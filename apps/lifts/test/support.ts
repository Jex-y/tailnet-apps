import { beforeEach } from "bun:test";
import { createTestContext } from "@apps/core/testing";

/** A weekday evening session. */
export const NOW = new Date("2026-10-01T18:30:00Z");

/** The test database, with the lifts tables emptied before each test. Call once per test file. */
export const createLiftsTestContext = () => {
  const context = createTestContext();
  beforeEach(async () => {
    await context.sql`truncate lifts.exercises, lifts.workouts, lifts.programs, lifts.pushes cascade`;
    await context.sql`delete from jobs.jobs where name like 'lifts.%'`;
  });
  return context;
};
