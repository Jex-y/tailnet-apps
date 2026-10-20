import { type AppContext, type AppModule, appRoutes, createBlobStore } from "@apps/core";
import { parseNotesConfig } from "./api/config";
import { notesDb } from "./api/db";
import { createMathpixReader, type HandwritingReader } from "./api/handwriting";
import { createNotesMcp } from "./api/mcp";
import { createNotesRoutes } from "./api/routes";
import { createNotesService } from "./api/service";
import { createNotesWork } from "./api/work";

/** The outside services and clock notes depends on; tests swap in fakes. */
export type NotesAdapters = {
  readonly reader: HandwritingReader | null;
  readonly now: () => Date;
};

const realAdapters = (context: AppContext): NotesAdapters => {
  const { mathpix } = parseNotesConfig(context.env);
  return { reader: mathpix === null ? null : createMathpixReader(mathpix), now: () => new Date() };
};

export const createNotesApp = (context: AppContext, adapters: NotesAdapters = realAdapters(context)): AppModule => {
  const db = notesDb(context.sql);
  const blob = createBlobStore(context.blob, "notes");
  const work = createNotesWork({ db, reader: adapters.reader, now: adapters.now });
  const service = createNotesService({ db, blob, work });

  return {
    slug: "notes",
    title: "Notes",
    routes: appRoutes(createNotesRoutes({ service, identity: context.identity })),
    jobs: work.jobs,
    schedules: work.schedules,
    mcp: createNotesMcp(service),
  };
};
