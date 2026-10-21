import { type AppContext, type AppMigrations, type AppModule, coreMigrations } from "@apps/core";
import { createFlatsApp } from "@apps/flats";
import { flatsMigrations } from "@apps/flats/migrations";
import { createLiftsApp } from "@apps/lifts";
import { liftsMigrations } from "@apps/lifts/migrations";
import { createMoneyApp } from "@apps/money";
import { moneyMigrations } from "@apps/money/migrations";
import { createNotesApp } from "@apps/notes";
import { notesMigrations } from "@apps/notes/migrations";
import { createStatusApp, parseBuildInfo } from "@apps/status";
import { createStreetsApp } from "@apps/streets";
import { streetsMigrations } from "@apps/streets/migrations";
import { createTasksApp } from "@apps/tasks";
import { tasksMigrations } from "@apps/tasks/migrations";

export const appMigrations: readonly AppMigrations[] = [
  coreMigrations,
  flatsMigrations,
  liftsMigrations,
  moneyMigrations,
  notesMigrations,
  streetsMigrations,
  tasksMigrations,
];

export const createApps = (context: AppContext): readonly AppModule[] => {
  const apps = [
    createFlatsApp(context),
    createLiftsApp(context),
    createMoneyApp(context),
    createNotesApp(context),
    createStreetsApp(context),
    createTasksApp(context),
  ];
  return [
    ...apps,
    createStatusApp(context, {
      apps,
      migrations: appMigrations,
      build: parseBuildInfo(process.env),
    }),
  ];
};
