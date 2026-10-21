import { beforeEach } from "bun:test";
import { createTestContext } from "@apps/core/testing";
import type { HandwritingReader, Reading } from "../src/api/handwriting";
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

/** A reader that answers `reading` for anything, remembering each request. */
export const fakeReader = (reading: Reading = { latex: "x^{2}", text: "\\( x^{2} \\)", confidence: 0.9 }) => {
  const requests: (readonly Stroke[])[] = [];
  const reader: HandwritingReader = {
    read: async (strokes) => {
      requests.push(strokes);
      return reading;
    },
  };
  return { reader, requests };
};

/** The smallest valid PNG: one transparent pixel. */
export const PIXEL_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (char) => char.charCodeAt(0),
);
