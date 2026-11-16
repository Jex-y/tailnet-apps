import { type AppMcp, toolResult } from "@apps/core";
import type { StatusReport } from "../contract";

const INSTRUCTIONS = `The health of the server hosting these apps: its build, Postgres, object storage, the job queue with
each job's recent outcomes and failures, the schedules and each app's migrations.`;

export const createStatusMcp = (report: () => Promise<StatusReport>): AppMcp => ({
  instructions: INSTRUCTIONS,
  listing: "shared",
  registerTools: (server) => {
    server.registerTool(
      "get_status",
      {
        description: "Reads the whole status report, as the status page shows it.",
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      () => toolResult(report),
    );
  },
});
