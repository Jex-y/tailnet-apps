import { and, asc, eq, max } from "drizzle-orm";
import { Stroke } from "../contract";
import { strokes } from "./schema";
import type { NotesReader } from "./views";

/** The ink block's strokes still drawn, in the order drawn. */
export const readLiveStrokes = async (db: NotesReader, pageId: string, blockId: string): Promise<Stroke[]> => {
  const rows = await db
    .select({ stroke: strokes.stroke })
    .from(strokes)
    .where(and(eq(strokes.pageId, pageId), eq(strokes.blockId, blockId)))
    .orderBy(asc(strokes.seq));
  return rows.flatMap(({ stroke }) => (stroke === null ? [] : [Stroke.parse(stroke)]));
};

/** The last page change to touch any of the ink block's strokes, 0 if none has; a reading or image as of it is current. */
export const readInkSeq = async (db: NotesReader, pageId: string, blockId: string): Promise<number> => {
  const [row] = await db
    .select({ seq: max(strokes.seq) })
    .from(strokes)
    .where(and(eq(strokes.pageId, pageId), eq(strokes.blockId, blockId)));
  return row?.seq ?? 0;
};

export const inkImageKey = (pageId: string, blockId: string) => `ink/${pageId}/${blockId}.png`;
