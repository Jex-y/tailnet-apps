import { beforeEach } from "bun:test";
import { createTestContext } from "@apps/core/testing";
import type { Stroke } from "../src/contract";

export const NOW = new Date("2026-10-19T20:00:00Z");

/** The test database, with the notes tables emptied before each test. Call once per test file. */
export const createNotesTestContext = () => {
  const context = createTestContext();
  beforeEach(async () => {
    await context.sql`truncate notes.notebooks, notes.pushes cascade`;
    await context.sql`delete from jobs.jobs where name like 'notes.%'`;
  });
  return context;
};

export const stroke = (fields: Partial<Stroke> = {}): Stroke => ({
  id: crypto.randomUUID(),
  tool: "pen",
  color: "#1a1a1a",
  width: 2,
  points: [
    { x: 10, y: 10, t: 0, pressure: 0.5, azimuth: 0, altitude: 1.2 },
    { x: 20, y: 15, t: 8, pressure: 0.6, azimuth: 0, altitude: 1.2 },
  ],
  ...fields,
});

export const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

export const ink = (height = 300) => ({ type: "ink", attrs: { height } });
