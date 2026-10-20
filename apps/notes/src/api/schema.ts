import { jsonb } from "@apps/core/columns";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const notesSchema = pgSchema("notes");

const instant = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Ids come from whoever creates the row, so a device can write while offline. Every child names its parent together
 * with the owner, which is why each table is unique on (owner, id): nothing can hang off another person's rows.
 */
const identity = () => ({
  id: uuid("id").primaryKey(),
  owner: text("owner").notNull(),
});

export const notebooks = notesSchema.table(
  "notebooks",
  {
    ...identity(),
    title: text("title").notNull(),
    position: integer("position").notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [unique().on(table.owner, table.id)],
);

/** `seq` is the last change to the page's content, which stamped every block and stroke it wrote. */
export const pages = notesSchema.table(
  "pages",
  {
    ...identity(),
    notebookId: uuid("notebook_id").notNull(),
    title: text("title").notNull(),
    position: integer("position").notNull(),
    seq: integer("seq").notNull().default(0),
    createdAt: instant("created_at").notNull().defaultNow(),
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.owner, table.id),
    foreignKey({ columns: [table.owner, table.notebookId], foreignColumns: [notebooks.owner, notebooks.id] }).onDelete(
      "cascade",
    ),
    index().on(table.owner, table.notebookId),
    check("seq_not_negative", sql`${table.seq} >= 0`),
  ],
);

/**
 * One top-level ProseMirror node of a page. A deleted block keeps its row with no node, so a device that had it
 * learns it went; `seq` is the page change that last wrote it.
 */
export const blocks = notesSchema.table(
  "blocks",
  {
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    id: uuid("id").notNull(),
    order: text("order").notNull(),
    node: jsonb<unknown>("node"),
    seq: integer("seq").notNull(),
  },
  (table) => [primaryKey({ columns: [table.pageId, table.id] }), index().on(table.pageId, table.seq)],
);

/** One stroke of an ink block, which an erased stroke keeps with no stroke, as a deleted block does. */
export const strokes = notesSchema.table(
  "strokes",
  {
    pageId: uuid("page_id").notNull(),
    blockId: uuid("block_id").notNull(),
    id: uuid("id").notNull(),
    stroke: jsonb<unknown>("stroke"),
    seq: integer("seq").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.pageId, table.id] }),
    foreignKey({ columns: [table.pageId, table.blockId], foreignColumns: [blocks.pageId, blocks.id] }).onDelete(
      "cascade",
    ),
    index().on(table.pageId, table.seq),
    index().on(table.pageId, table.blockId),
  ],
);

/** The pushes already applied, so a device retrying one after a lost answer changes nothing. */
export const pushes = notesSchema.table(
  "pushes",
  {
    owner: text("owner").notNull(),
    key: text("key").notNull(),
    appliedAt: instant("applied_at").notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.owner, table.key] })],
);
