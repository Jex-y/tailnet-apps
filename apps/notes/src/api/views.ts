import { and, asc, eq, gt, isNotNull, type SQL } from "drizzle-orm";
import type { BlockChange, Notebook, PageSummary, StrokeChange } from "../contract";
import { Stroke } from "../contract";
import type { NotesDb } from "./db";
import { blocks, notebooks, pages, strokes } from "./schema";

export type NotesReader = Pick<NotesDb, "select">;

export const readNotebooks = (db: NotesReader, owner: string): Promise<Notebook[]> =>
  db
    .select({ id: notebooks.id, title: notebooks.title, position: notebooks.position })
    .from(notebooks)
    .where(eq(notebooks.owner, owner))
    .orderBy(asc(notebooks.position), asc(notebooks.id));

const summary = {
  id: pages.id,
  notebookId: pages.notebookId,
  title: pages.title,
  position: pages.position,
  seq: pages.seq,
  updatedAt: pages.updatedAt,
};

const readSummaries = async (db: NotesReader, where: SQL | undefined): Promise<PageSummary[]> => {
  const rows = await db
    .select(summary)
    .from(pages)
    .where(where)
    .orderBy(asc(pages.notebookId), asc(pages.position), asc(pages.id));
  return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));
};

export const readPages = (db: NotesReader, owner: string): Promise<PageSummary[]> =>
  readSummaries(db, eq(pages.owner, owner));

export const readPage = async (db: NotesReader, owner: string, id: string): Promise<PageSummary | null> =>
  (await readSummaries(db, and(eq(pages.id, id), eq(pages.owner, owner))))[0] ?? null;

/** Compares order keys by code unit, as they are made to be. */
const byOrder = (a: { order: string; id: string }, b: { order: string; id: string }) =>
  a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Blocks written after `since` in page order; from 0, only those still there. */
export const readBlockChanges = async (db: NotesReader, pageId: string, since: number): Promise<BlockChange[]> => {
  const rows = await db
    .select({ id: blocks.id, order: blocks.order, node: blocks.node })
    .from(blocks)
    .where(and(eq(blocks.pageId, pageId), gt(blocks.seq, since), since === 0 ? isNotNull(blocks.node) : undefined));
  return rows
    .toSorted(byOrder)
    .map(({ id, order, node }) => (node === null ? { kind: "deleted", id } : { kind: "block", id, order, node }));
};

/** Strokes written after `since` in the order drawn; from 0, only those not erased. */
export const readStrokeChanges = async (db: NotesReader, pageId: string, since: number): Promise<StrokeChange[]> => {
  const rows = await db
    .select({ blockId: strokes.blockId, id: strokes.id, stroke: strokes.stroke })
    .from(strokes)
    .where(and(eq(strokes.pageId, pageId), gt(strokes.seq, since), since === 0 ? isNotNull(strokes.stroke) : undefined))
    .orderBy(asc(strokes.seq));
  return rows.map(({ blockId, id, stroke }) =>
    stroke === null ? { kind: "erased", blockId, id } : { kind: "stroke", blockId, stroke: Stroke.parse(stroke) },
  );
};
