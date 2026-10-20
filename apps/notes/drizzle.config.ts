import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/api/schema.ts",
  out: "./drizzle",
  schemaFilter: ["notes"],
  migrations: { schema: "drizzle", table: "notes_migrations" },
});
