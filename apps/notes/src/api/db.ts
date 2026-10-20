import type { SQL } from "bun";
import { type BunSQLDatabase, drizzle } from "drizzle-orm/bun-sql";
import * as schema from "./schema";

export type NotesDb = BunSQLDatabase<typeof schema>;

export const notesDb = (sql: SQL): NotesDb => drizzle({ client: sql, schema });
