import { type AppContext, type AppModule, appRoutes, trailingSlashRedirect } from "@apps/core";
import { parseLiftsConfig } from "./api/config";
import { liftsDb } from "./api/db";
import { createLiftsMcp } from "./api/mcp";
import { createClaudeNamer, type WorkoutNamer } from "./api/namer";
import { createLiftsRoutes } from "./api/routes";
import { createLiftsService } from "./api/service";
import { createLiftsWork } from "./api/work";
import page from "./web/index.html";

/**
 * The clock, which stamps sets logged and workouts finished over MCP and ages out remembered pushes, and what names
 * finished workouts; tests swap in fakes.
 */
export type LiftsAdapters = { readonly now: () => Date; readonly namer: WorkoutNamer | null };

const realAdapters = (context: AppContext): LiftsAdapters => {
  const { anthropicApiKey } = parseLiftsConfig(context.env);
  return { now: () => new Date(), namer: anthropicApiKey === null ? null : createClaudeNamer(anthropicApiKey) };
};

export const createLiftsApp = (
  context: AppContext,
  { now, namer }: LiftsAdapters = realAdapters(context),
): AppModule => {
  const db = liftsDb(context.sql);
  const work = createLiftsWork({ db, namer, now });
  const service = createLiftsService({ db, work });

  return {
    slug: "lifts",
    title: "Lifts",
    routes: appRoutes({
      "/lifts": trailingSlashRedirect("lifts"),
      "/lifts/*": page,
      ...createLiftsRoutes({ service, identity: context.identity }),
    }),
    jobs: work.jobs,
    schedules: work.schedules,
    mcp: createLiftsMcp({ service, now }),
    offlinePage: page,
  };
};
