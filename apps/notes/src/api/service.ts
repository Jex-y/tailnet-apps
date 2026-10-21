import { type BlobStore, HttpError } from "@apps/core";
import { and, eq, inArray, isNotNull, lt, type SQL, sql } from "drizzle-orm";
import type { Node } from "prosemirror-model";
import type { Block, Mutation, Notebook, PageChanges, PageMeta, PageSummary, Stroke } from "../contract";
import { parseBlockNode } from "../document";
import type { NotesDb } from "./db";
import { inkImageKey, readInkSeq } from "./ink";
import { blocks, inkImages, notebooks, pages, pushes, readings, strokes } from "./schema";
import { readBlockChanges, readNotebooks, readPage, readPages, readStrokeChanges } from "./views";
import type { NotesWork } from "./work";

export type NotesServiceDeps = {
  readonly db: NotesDb;
  readonly blob: BlobStore;
  readonly work: Pick<NotesWork, "scheduleReading">;
};

type Tx = Parameters<Parameters<NotesDb["transaction"]>[0]>[0];

/** A block still on its page, its node parsed. */
export type PageBlock = { readonly id: string; readonly order: string; readonly node: Node };

/** What was made of an ink block, and whether its strokes have changed since. */
export type Derived<T> = { readonly value: T; readonly current: boolean };

export type InkReading = { readonly latex: string | null; readonly text: string; readonly confidence: number };

/** What there is of an ink block besides its strokes: what the reader made of it, and whether a device rendered it. */
export type InkDerivatives = {
  readonly reading: Derived<InkReading> | null;
  readonly image: Derived<true> | null;
};

/** A page's content as it now is: its blocks in order, and the strokes of each ink block in the order drawn. */
export type PageContent = {
  readonly page: PageSummary;
  readonly blocks: readonly PageBlock[];
  readonly strokes: ReadonlyMap<string, readonly Stroke[]>;
  readonly ink: ReadonlyMap<string, InkDerivatives>;
};

/** A blob outliving the rows that named it, to delete once they are gone. */
type Orphan = string;

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

const addStroke = async (tx: Tx, work: Work, owner: string, pageId: string, blockId: string, stroke: Stroke) => {
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
  await work.scheduleReading(tx, pageId, blockId);
};

const eraseStrokes = async (
  tx: Tx,
  work: Work,
  owner: string,
  pageId: string,
  blockId: string,
  ids: readonly string[],
) => {
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
  await work.scheduleReading(tx, pageId, blockId);
};

/** The rendered images of every ink block on the pages `where` picks, which deleting those pages leaves behind. */
const imagesUnder = async (tx: Tx, owner: string, where: SQL): Promise<readonly Orphan[]> =>
  (
    await tx
      .select({ pageId: inkImages.pageId, blockId: inkImages.blockId })
      .from(inkImages)
      .innerJoin(pages, eq(pages.id, inkImages.pageId))
      .where(and(eq(pages.owner, owner), where))
  ).map(({ pageId, blockId }) => inkImageKey(pageId, blockId));

type Work = NotesServiceDeps["work"];

const applyOne = async (tx: Tx, work: Work, owner: string, mutation: Mutation): Promise<readonly Orphan[]> => {
  switch (mutation.type) {
    case "notebook.put":
      await putNotebook(tx, owner, mutation.row);
      return [];
    case "notebook.delete": {
      const orphans = await imagesUnder(tx, owner, eq(pages.notebookId, mutation.id));
      await tx.delete(notebooks).where(and(eq(notebooks.id, mutation.id), eq(notebooks.owner, owner)));
      return orphans;
    }
    case "page.put":
      await putPage(tx, owner, mutation.row);
      return [];
    case "page.delete": {
      const orphans = await imagesUnder(tx, owner, eq(pages.id, mutation.id));
      await tx.delete(pages).where(and(eq(pages.id, mutation.id), eq(pages.owner, owner)));
      return orphans;
    }
    case "block.put":
      await putBlock(tx, owner, mutation.pageId, mutation.row);
      return [];
    case "block.delete":
      await deleteBlock(tx, owner, mutation.pageId, mutation.id);
      return [];
    case "stroke.add":
      await addStroke(tx, work, owner, mutation.pageId, mutation.blockId, mutation.stroke);
      return [];
    case "stroke.erase":
      await eraseStrokes(tx, work, owner, mutation.pageId, mutation.blockId, mutation.strokeIds);
      return [];
  }
};

const applyAll = async (tx: Tx, work: Work, owner: string, mutations: readonly Mutation[]) => {
  const orphans: Orphan[] = [];
  for (const mutation of mutations) {
    orphans.push(...(await applyOne(tx, work, owner, mutation)));
  }
  return orphans;
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
export const createNotesService = ({ db, blob, work }: NotesServiceDeps) => {
  const forget = async (orphans: readonly Orphan[]) => {
    await Promise.all(orphans.map((key) => blob.delete(key)));
  };

  const page = async (owner: string, id: string): Promise<PageSummary> => (await readPage(db, owner, id)) ?? notFound();

  const derivativesOf = async (pageId: string, blockId: string): Promise<InkDerivatives> => {
    const [seq, [reading], [image]] = await Promise.all([
      readInkSeq(db, pageId, blockId),
      db
        .select({ seq: readings.seq, latex: readings.latex, text: readings.text, confidence: readings.confidence })
        .from(readings)
        .where(and(eq(readings.pageId, pageId), eq(readings.blockId, blockId))),
      db
        .select({ seq: inkImages.seq })
        .from(inkImages)
        .where(and(eq(inkImages.pageId, pageId), eq(inkImages.blockId, blockId))),
    ]);
    return {
      reading:
        reading === undefined
          ? null
          : {
              value: { latex: reading.latex, text: reading.text, confidence: reading.confidence },
              current: reading.seq >= seq,
            },
      image: image === undefined ? null : { value: true, current: image.seq >= seq },
    };
  };

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
      const inkBlocks = live.filter((block) => block.node.type.name === "ink");
      const ink = new Map(
        await Promise.all(inkBlocks.map(async ({ id }) => [id, await derivativesOf(pageId, id)] as const)),
      );
      return { page: summary, blocks: live, strokes: drawn, ink };
    },

    /** Applies the changes in order, all or nothing. */
    apply: async (owner: string, mutations: readonly Mutation[]): Promise<void> =>
      forget(await db.transaction((tx) => applyAll(tx, work, owner, mutations))),

    /** {@link apply}, at most once per key: a push that was refused may be sent again, one that landed is ignored. */
    push: async (owner: string, key: string, mutations: readonly Mutation[]): Promise<void> =>
      forget(
        await db.transaction(async (tx) => {
          const claimed = await tx
            .insert(pushes)
            .values({ owner, key })
            .onConflictDoNothing()
            .returning({ key: pushes.key });
          return claimed.length > 0 ? applyAll(tx, work, owner, mutations) : [];
        }),
      ),

    /**
     * Keeps a device's rendering of an ink block as of `seq`, unless one as late is already kept. The blob is written
     * before its row, so a failure leaves at worst an image nothing names.
     */
    putInkImage: async (owner: string, pageId: string, blockId: string, seq: number, png: Blob): Promise<void> => {
      const { seq: pageSeq } = await page(owner, pageId);
      if (seq > pageSeq) {
        throw new HttpError(400, `The page has only had ${pageSeq} changes`);
      }
      const [block] = await db
        .select({ id: blocks.id })
        .from(blocks)
        .where(and(eq(blocks.pageId, pageId), eq(blocks.id, blockId), sql`${blocks.node}->>'type' = 'ink'`));
      if (block === undefined) {
        throw new HttpError(409, "That handwriting is no longer on the page");
      }
      await blob.write(inkImageKey(pageId, blockId), png, "image/png");
      await db
        .insert(inkImages)
        .values({ pageId, blockId, seq })
        .onConflictDoUpdate({
          target: [inkImages.pageId, inkImages.blockId],
          set: { seq, renderedAt: sql`now()` },
          setWhere: lt(inkImages.seq, seq),
        });
    },

    /** A device's rendering of an ink block, as PNG bytes; `null` when none has been kept. */
    inkImage: async (owner: string, pageId: string, blockId: string): Promise<Uint8Array | null> => {
      await page(owner, pageId);
      const [image] = await db
        .select({ seq: inkImages.seq })
        .from(inkImages)
        .where(and(eq(inkImages.pageId, pageId), eq(inkImages.blockId, blockId)));
      return image === undefined ? null : blob.read(inkImageKey(pageId, blockId));
    },
  };
};

export type NotesService = ReturnType<typeof createNotesService>;
