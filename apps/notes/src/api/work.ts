import { defineJob, defineSchedule, insertJob, type JobInserter, type RegisteredJob, type Schedule } from "@apps/core";
import { and, eq, lt } from "drizzle-orm";
import { z } from "zod";
import type { NotesDb } from "./db";
import type { HandwritingReader } from "./handwriting";
import { readInkSeq, readLiveStrokes } from "./ink";
import { blocks, pushes, readings } from "./schema";

export type NotesWorkDeps = {
  readonly db: NotesDb;
  readonly reader: HandwritingReader | null;
  readonly now: () => Date;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** How long a push is remembered. A device retries one within minutes of the answer it lost, never weeks. */
export const PUSH_MEMORY_MS = 30 * DAY;

/** Handwriting is read this long after the first stroke of a burst, so a line of writing is read once, not per stroke. */
export const READ_AFTER_MS = 5_000;

export const createNotesWork = ({ db, reader, now }: NotesWorkDeps) => {
  const forgetPushes = defineJob({
    name: "notes.forget-pushes",
    payload: z.object({}),
    handle: async () => {
      await db.delete(pushes).where(lt(pushes.appliedAt, new Date(now().getTime() - PUSH_MEMORY_MS)));
    },
  });

  /** Reads an ink block's strokes as they now are, unless its reading is already as of them. */
  const readInk = defineJob({
    name: "notes.read-ink",
    payload: z.object({ pageId: z.uuid(), blockId: z.uuid() }),
    handle: async ({ pageId, blockId }, { signal }) => {
      if (reader === null) {
        return;
      }
      const where = and(eq(readings.pageId, pageId), eq(readings.blockId, blockId));
      const seq = await readInkSeq(db, pageId, blockId);
      const [current] = await db.select({ seq: readings.seq }).from(readings).where(where);
      if (current !== undefined && current.seq >= seq) {
        return;
      }
      const drawn = await readLiveStrokes(db, pageId, blockId);
      if (drawn.length === 0) {
        await db.delete(readings).where(where);
        return;
      }
      const reading = await reader.read(drawn, signal);
      const [block] = await db
        .select({ id: blocks.id })
        .from(blocks)
        .where(and(eq(blocks.pageId, pageId), eq(blocks.id, blockId)));
      if (block === undefined) {
        return;
      }
      const values = { seq, ...reading, readAt: now() };
      await db
        .insert(readings)
        .values({ pageId, blockId, ...values })
        .onConflictDoUpdate({
          target: [readings.pageId, readings.blockId],
          set: values,
          setWhere: lt(readings.seq, seq),
        });
    },
  });

  /** Reads the block once the burst of strokes that changed it is over; nothing, when no reader is configured. */
  const scheduleReading = async (tx: JobInserter, pageId: string, blockId: string): Promise<void> => {
    if (reader !== null) {
      await insertJob(
        tx,
        readInk,
        { pageId, blockId },
        { dedupeKey: `${pageId}/${blockId}`, runAt: new Date(now().getTime() + READ_AFTER_MS) },
      );
    }
  };

  const jobs: readonly RegisteredJob[] = [forgetPushes, readInk];

  const schedules: readonly Schedule[] = [
    defineSchedule({ name: "notes.forget-pushes", everyMs: DAY, jitterMs: HOUR, job: forgetPushes, payload: {} }),
  ];

  return { jobs, schedules, scheduleReading, definitions: { forgetPushes, readInk } };
};

export type NotesWork = ReturnType<typeof createNotesWork>;
