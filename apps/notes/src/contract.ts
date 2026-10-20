import type { Node } from "prosemirror-model";
import { z } from "zod";
import { parseBlockNode } from "./document";

export const NOTES_API = "/notes/api";

const Id = z.uuid();
const Instant = z.iso.datetime();
const Position = z.number().int().min(0).max(100_000);
const Seq = z.number().int().min(0);

export const Notebook = z.object({
  id: Id,
  title: z.string().trim().min(1).max(200),
  position: Position,
});
export type Notebook = z.infer<typeof Notebook>;

/** Everything about a page but its content. */
export const PageMeta = z.object({
  id: Id,
  notebookId: Id,
  title: z.string().trim().max(200),
  position: Position,
});
export type PageMeta = z.infer<typeof PageMeta>;

/** `seq` counts the changes to the page's content; a device holding the page as of `seq` is up to date. */
export const PageSummary = PageMeta.extend({ seq: Seq, updatedAt: Instant });
export type PageSummary = z.infer<typeof PageSummary>;

export const NotebookList = z.array(Notebook);
export const PageSummaryList = z.array(PageSummary);

/**
 * Where a block sits on its page: blocks read in the order of these keys, compared by code unit. Made with
 * `fractional-indexing`, whose keys can always be generated between two others, so a block moves by changing only
 * its own key.
 */
export const OrderKey = z
  .string()
  .min(2)
  .max(200)
  .regex(/^[0-9A-Za-z]+$/);

export const INK_TOOLS = ["pen", "pencil", "marker", "highlighter"] as const;

/** One sample of the pen, in the block's coordinates: `t` is milliseconds since the stroke began. */
export const InkPoint = z.object({
  x: z.number(),
  y: z.number(),
  t: z.number().min(0),
  pressure: z.number().min(0).max(1),
  /** Radians clockwise from the x axis that the pen points along. */
  azimuth: z.number(),
  /** Radians from the screen: π/2 is upright. */
  altitude: z
    .number()
    .min(0)
    .max(Math.PI / 2),
});
export type InkPoint = z.infer<typeof InkPoint>;

/** Never changes once drawn: erasing part of a stroke is erasing it and adding what is left as new strokes. */
export const Stroke = z.object({
  id: Id,
  tool: z.enum(INK_TOOLS),
  color: z.string().regex(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i),
  width: z.number().positive().max(200),
  points: z.array(InkPoint).min(1).max(20_000),
});
export type Stroke = z.infer<typeof Stroke>;

/** A ProseMirror node of the block group, as JSON in, parsed against the page schema. */
const BlockNode = z.unknown().transform((json, context): Node => {
  const parsed = parseBlockNode(json);
  if (!parsed.ok) {
    context.addIssue({ code: "custom", message: parsed.reason });
    return z.NEVER;
  }
  return parsed.value;
});

export const Block = z.object({ id: Id, order: OrderKey, node: BlockNode });
export type Block = z.infer<typeof Block>;

const put = <T extends string, R extends z.ZodType>(type: T, row: R) => z.object({ type: z.literal(type), row });
const remove = <T extends string>(type: T) => z.object({ type: z.literal(type), id: Id });
const onPage = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.object({ type: z.literal(type), pageId: Id, ...shape });

/**
 * One change to someone's notes. A put writes the whole row, creating it or replacing what was there; a delete or
 * erase of something already gone succeeds, and a stroke added again is ignored, so replaying a change is harmless.
 * A page is created empty, and a stroke can only be added to an ink block.
 */
export const Mutation = z.discriminatedUnion("type", [
  put("notebook.put", Notebook),
  remove("notebook.delete"),
  put("page.put", PageMeta),
  remove("page.delete"),
  onPage("block.put", { row: Block }),
  onPage("block.delete", { id: Id }),
  onPage("stroke.add", { blockId: Id, stroke: Stroke }),
  onPage("stroke.erase", { blockId: Id, strokeIds: z.array(Id).min(1).max(10_000) }),
]);
export type Mutation = z.infer<typeof Mutation>;
/** A mutation as sent, its block nodes still JSON. */
export type MutationJson = z.input<typeof Mutation>;

/** Changes applied in order, all or nothing. */
export const Push = z.object({ mutations: z.array(Mutation).min(1).max(1000) });

/** Names one push, so a device retrying it after a lost answer does not apply it twice. */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";
export const IdempotencyKey = z.string().min(1).max(200);

/** A device's rendering of an ink block, as of the page change `seq`. */
export const ImageQuery = z.object({ seq: z.coerce.number().int().min(1) });
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const ChangesQuery = z.object({ since: z.coerce.number().int().min(0).default(0) });

export const BlockChange = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("block"), id: Id, order: OrderKey, node: z.unknown() }),
  z.object({ kind: z.literal("deleted"), id: Id }),
]);
export type BlockChange = z.infer<typeof BlockChange>;

export const StrokeChange = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("stroke"), blockId: Id, stroke: Stroke }),
  z.object({ kind: z.literal("erased"), blockId: Id, id: Id }),
]);
export type StrokeChange = z.infer<typeof StrokeChange>;

/**
 * Every block and stroke of a page changed after `since`, as each now is, bringing a device to `seq`. From 0 that is
 * the whole page with nothing deleted, since a device that never had a block need not hear it went.
 */
export const PageChanges = z.object({
  seq: Seq,
  blocks: z.array(BlockChange),
  strokes: z.array(StrokeChange),
});
export type PageChanges = z.infer<typeof PageChanges>;
