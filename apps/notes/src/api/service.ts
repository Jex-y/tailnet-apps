import { HttpError } from "@apps/core";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Node } from "prosemirror-model";
import type { Block, Mutation, Notebook, PageChanges, PageMeta, PageSummary, Stroke } from "../contract";
import { parseBlockNode } from "../document";
import type { NotesDb } from "./db";
import { blocks, notebooks, pages, pushes, strokes } from "./schema";
import { readBlockChanges, readNotebooks, readPage, readPages, readStrokeChanges } from "./views";

export type NotesServiceDeps = { readonly db: NotesDb };

type Tx = Parameters<Parameters<NotesDb["transaction"]>[0]>[0];

/** A block still on its page, its node parsed. */
export type PageBlock = { readonly id: string; readonly order: string; readonly node: Node };

/** A page's content as it now is: its blocks in order, and the strokes of each ink block in the order drawn. */
export type PageContent = {
  readonly page: PageSummary;
  readonly blocks: readonly PageBlock[];
  readonly strokes: ReadonlyMap<string, readonly Stroke[]>;
};

const notFound = (): never => {
  throw new HttpError(404, "Not found");
};

/** A row written under an id that already belongs to someone else changes nothing, and is refused as if not there. */
const requireWritten = (written: readonly unknown[]) => {
  if (written.length === 0) {
    notFound();
  }
};

const requireOwn = async (found: Promise<readonly unknown[]>, missing: string) => {
  if ((await found).length === 0) {
    throw new HttpError(409, missing);
  }
};

const putNotebook = async (tx: Tx, owner: string, { id, ...fields }: Notebook) => {
  requireWritten(
    await tx
      .insert(notebooks)
      .values({ id, owner, ...fields })
      .onConflictDoUpdate({ target: notebooks.id, set: fields, setWhere: eq(notebooks.owner, owner) })
      .returning({ id: notebooks.id }),
  );
};

const putPage = async (tx: Tx, owner: string, { id, ...fields }: PageMeta) => {
  await requireOwn(
    tx
      .select({ id: notebooks.id })
      .from(notebooks)
      .where(and(eq(notebooks.id, fields.notebookId), eq(notebooks.owner, owner))),
    "That notebook no longer exists",
  );
  requireWritten(
    await tx
      .insert(pages)
      .values({ id, owner, ...fields })
      .onConflictDoUpdate({
        target: pages.id,
        set: { ...fields, updatedAt: sql`now()` },
        setWhere: eq(pages.owner, owner),
      })
      .returning({ id: pages.id }),
  );
};

/**
 * Takes the page's next change number, holding the page until the transaction ends, so changes to one page are
 * numbered in the order they commit and a device reading up to a number has seen everything before it.
 */
const nextSeq = async (tx: Tx, owner: string, pageId: string): Promise<number> => {
  const [page] = await tx
    .update(pages)
    .set({ seq: sql`${pages.seq} + 1`, updatedAt: sql`now()` })
    .where(and(eq(pages.id, pageId), eq(pages.owner, owner)))
    .returning({ seq: pages.seq });
  if (page === undefined) {
    throw new HttpError(409, "That page no longer exists");
  }
  return page.seq;
};

const putBlock = async (tx: Tx, owner: string, pageId: string, { id, order, node }: Block) => {
  const seq = await nextSeq(tx, owner, pageId);
  const values = { order, node: node.toJSON(), seq };
  await tx
    .insert(blocks)
    .values({ pageId, id, ...values })
    .onConflictDoUpdate({ target: [blocks.pageId, blocks.id], set: values });
};

const deleteBlock = async (tx: Tx, owner: string, pageId: string, id: string) => {
  const live = and(eq(blocks.pageId, pageId), eq(blocks.id, id), isNotNull(blocks.node));
  if ((await tx.select({ id: blocks.id }).from(blocks).where(live)).length === 0) {
    return;
  }
  const seq = await nextSeq(tx, owner, pageId);
  await tx.update(blocks).set({ node: null, seq }).where(live);
};

const addStroke = async (tx: Tx, owner: string, pageId: string, blockId: string, stroke: Stroke) => {
  await requireOwn(
    tx
      .select({ id: blocks.id })
      .from(blocks)
      .where(and(eq(blocks.pageId, pageId), eq(blocks.id, blockId), sql`${blocks.node}->>'type' = 'ink'`)),
    "That handwriting is no longer on the page",
  );
  const drawn = await tx
    .select({ id: strokes.id })
    .from(strokes)
    .where(and(eq(strokes.pageId, pageId), eq(strokes.id, stroke.id)));
  if (drawn.length > 0) {
    return;
  }
  const seq = await nextSeq(tx, owner, pageId);
  await tx.insert(strokes).values({ pageId, blockId, id: stroke.id, stroke, seq });
};

const eraseStrokes = async (tx: Tx, owner: string, pageId: string, blockId: string, ids: readonly string[]) => {
  const live = and(
    eq(strokes.pageId, pageId),
    eq(strokes.blockId, blockId),
    inArray(strokes.id, [...ids]),
    isNotNull(strokes.stroke),
  );
  if ((await tx.select({ id: strokes.id }).from(strokes).where(live)).length === 0) {
    return;
  }
  const seq = await nextSeq(tx, owner, pageId);
  await tx.update(strokes).set({ stroke: null, seq }).where(live);
};

const applyOne = async (tx: Tx, owner: string, mutation: Mutation): Promise<void> => {
  switch (mutation.type) {
    case "notebook.put":
      return putNotebook(tx, owner, mutation.row);
    case "notebook.delete":
      await tx.delete(notebooks).where(and(eq(notebooks.id, mutation.id), eq(notebooks.owner, owner)));
      return;
    case "page.put":
      return putPage(tx, owner, mutation.row);
    case "page.delete":
      await tx.delete(pages).where(and(eq(pages.id, mutation.id), eq(pages.owner, owner)));
      return;
    case "block.put":
      return putBlock(tx, owner, mutation.pageId, mutation.row);
    case "block.delete":
      return deleteBlock(tx, owner, mutation.pageId, mutation.id);
    case "stroke.add":
      return addStroke(tx, owner, mutation.pageId, mutation.blockId, mutation.stroke);
    case "stroke.erase":
      return eraseStrokes(tx, owner, mutation.pageId, mutation.blockId, mutation.strokeIds);
  }
};

const applyAll = async (tx: Tx, owner: string, mutations: readonly Mutation[]) => {
  for (const mutation of mutations) {
    await applyOne(tx, owner, mutation);
  }
};

/** A block's stored node; one that no longer parses is a bug here, never the client's. */
const storedNode = (id: string, json: unknown): Node => {
  const node = parseBlockNode(json);
  if (!node.ok) {
    throw new Error(`Block ${id} holds an invalid node: ${node.reason}`);
  }
  return node.value;
};

/**
 * Everything someone can do with their notes, shared by the HTTP API and the MCP server. Refusals are
 * {@link HttpError}s saying why. Nobody can see or touch another's notes.
 */
export const createNotesService = ({ db }: NotesServiceDeps) => {
  const page = async (owner: string, id: string): Promise<PageSummary> => (await readPage(db, owner, id)) ?? notFound();

  /** The page's changes after `since`; the number is read first, so nothing up to it can be missing. */
  const changes = async (owner: string, pageId: string, since: number): Promise<PageChanges> => {
    const { seq } = await page(owner, pageId);
    if (since > seq) {
      throw new HttpError(400, `The page has only had ${seq} changes`);
    }
    const [blockChanges, strokeChanges] = await Promise.all([
      readBlockChanges(db, pageId, since),
      readStrokeChanges(db, pageId, since),
    ]);
    return { seq, blocks: blockChanges, strokes: strokeChanges };
  };

  return {
    notebooks: (owner: string) => readNotebooks(db, owner),
    pages: (owner: string) => readPages(db, owner),
    page,
    changes,

    content: async (owner: string, pageId: string): Promise<PageContent> => {
      const summary = await page(owner, pageId);
      const [blockChanges, strokeChanges] = await Promise.all([
        readBlockChanges(db, pageId, 0),
        readStrokeChanges(db, pageId, 0),
      ]);
      const live = blockChanges.flatMap((block) =>
        block.kind === "block" ? [{ id: block.id, order: block.order, node: storedNode(block.id, block.node) }] : [],
      );
      const drawn = new Map<string, Stroke[]>();
      for (const change of strokeChanges) {
        if (change.kind === "stroke") {
          drawn.set(change.blockId, [...(drawn.get(change.blockId) ?? []), change.stroke]);
        }
      }
      return { page: summary, blocks: live, strokes: drawn };
    },

    /** Applies the changes in order, all or nothing. */
    apply: (owner: string, mutations: readonly Mutation[]): Promise<void> =>
      db.transaction((tx) => applyAll(tx, owner, mutations)),

    /** {@link apply}, at most once per key: a push that was refused may be sent again, one that landed is ignored. */
    push: (owner: string, key: string, mutations: readonly Mutation[]): Promise<void> =>
      db.transaction(async (tx) => {
        const claimed = await tx
          .insert(pushes)
          .values({ owner, key })
          .onConflictDoNothing()
          .returning({ key: pushes.key });
        if (claimed.length > 0) {
          await applyAll(tx, owner, mutations);
        }
      }),
  };
};

export type NotesService = ReturnType<typeof createNotesService>;
