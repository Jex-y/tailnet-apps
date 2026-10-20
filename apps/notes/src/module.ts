import { type AppContext, type AppModule, appRoutes } from "@apps/core";
import { notesDb } from "./api/db";
import { createNotesMcp } from "./api/mcp";
import { createNotesRoutes } from "./api/routes";
import { createNotesService } from "./api/service";
import { createNotesWork } from "./api/work";

/** The clock, which ages out remembered pushes; tests pin it. */
export type NotesAdapters = { readonly now: () => Date };

export const createNotesApp = (context: AppContext, { now }: NotesAdapters = { now: () => new Date() }): AppModule => {
  const db = notesDb(context.sql);
  const work = createNotesWork({ db, now });
  const service = createNotesService({ db });

  return {
    slug: "notes",
    title: "Notes",
    routes: appRoutes(createNotesRoutes({ service, identity: context.identity })),
    jobs: work.jobs,
    schedules: work.schedules,
    mcp: createNotesMcp(service),
  };
};
