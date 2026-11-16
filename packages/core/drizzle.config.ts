import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/connector/schema.ts", "./src/jobs/schema.ts", "./src/push/schema.ts", "./src/shell/schema.ts"],
  out: "./drizzle",
  schemaFilter: ["connector", "jobs", "push", "shell"],
  migrations: { schema: "drizzle", table: "jobs_migrations" },
});
