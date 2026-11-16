import { ApiError, requestEmpty, requestJson } from "@apps/core/web";
import {
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
  persistedCollectionOptions,
} from "@tanstack/browser-db-sqlite-persistence";
import { type Collection, createCollection, type PendingMutation } from "@tanstack/db";
import { NonRetriableError, startOfflineExecutor } from "@tanstack/offline-transactions";
import { QueryClient } from "@tanstack/query-core";
import { DeleteOperationItemNotFoundError, queryCollectionOptions } from "@tanstack/query-db-collection";
import type { z } from "zod";
import {
  type Entry,
  EntryList,
  type Exercise,
  ExerciseList,
  IDEMPOTENCY_HEADER,
  LIFTS_API,
  type LiftSet,
  LiftSetList,
  Mutation,
  type Prescription,
  PrescriptionList,
  type Program,
  type ProgramDay,
  ProgramDayList,
  type ProgramExercise,
  ProgramExerciseList,
  ProgramList,
  type ScheduledSession,
  ScheduledSessionList,
  type TrainingMax,
  TrainingMaxList,
  type Workout,
  WorkoutList,
} from "../../contract";

/** Each collection's path under the API, and the row its mutations are named for. */
const ROWS = {
  exercises: { path: "exercises", row: "exercise" },
  workouts: { path: "workouts", row: "workout" },
  entries: { path: "entries", row: "entry" },
  sets: { path: "sets", row: "set" },
  programs: { path: "programs", row: "program" },
  trainingMaxes: { path: "training-maxes", row: "trainingMax" },
  programDays: { path: "program-days", row: "programDay" },
  programExercises: { path: "program-exercises", row: "programExercise" },
  prescriptions: { path: "prescriptions", row: "prescription" },
  sessions: { path: "sessions", row: "session" },
} as const;
type CollectionName = keyof typeof ROWS;

/** Bumped whenever a row's shape changes, so a device drops the rows it kept and loads them again. */
const SCHEMA_VERSION = 3;

/** The longest the first screen waits for rows it expects before showing whatever has arrived. */
const RESTORE_WAIT_MS = 1500;
const RESTORE_POLL_MS = 8;

/** Where the device remembers which collections held rows when the app was last open. */
const KEPT_KEY = "lifts:kept";

/** Refusals the server will repeat however often it is asked, as opposed to a connection that may come back. */
const isRefusal = (error: unknown): boolean =>
  error instanceof ApiError && error.status >= 400 && error.status < 500 && ![401, 408, 429].includes(error.status);

const toMutation = (pending: PendingMutation): Mutation => {
  const { row } = ROWS[pending.collection.id as CollectionName];
  const mutation = Mutation.safeParse(
    pending.type === "delete"
      ? { type: `${row}.delete`, id: pending.key }
      : { type: `${row}.put`, row: pending.modified },
  );
  if (!mutation.success) {
    throw new NonRetriableError(`This change cannot be saved: ${mutation.error.message}`);
  }
  return mutation.data;
};

type Persistence = ReturnType<typeof createBrowserWASQLitePersistence>;

/** `null` where the browser cannot keep a database, such as a private window; the log then lives in memory. */
const openPersistence = async (): Promise<Persistence | null> => {
  try {
    return createBrowserWASQLitePersistence({
      database: await openBrowserWASQLiteOPFSDatabase({ databaseName: "lifts.sqlite" }),
    });
  } catch (error) {
    console.warn("The log cannot be kept on this device", error);
    return null;
  }
};

/**
 * `device`: kept here. `other-tab`: another tab of the app holds the queue of unsent changes, so this one sends
 * each change at once or not at all. `none`: the browser gave the app nowhere to keep anything.
 */
export type Durability = "device" | "other-tab" | "none";

type Listener = () => void;

/** Puts changes the server has accepted into the rows it is known to hold. */
type Confirm = (changes: readonly PendingMutation[]) => Promise<void>;

type Sized = {
  readonly size: number;
  readonly status: string;
  readonly subscribeChanges: (listener: Listener) => unknown;
};

/** Which collections held rows last time; `null` on a device that has never opened the app. */
const readKept = (): Partial<Record<CollectionName, boolean>> | null => {
  try {
    const stored = localStorage.getItem(KEPT_KEY);
    return stored === null ? null : (JSON.parse(stored) as Partial<Record<CollectionName, boolean>>);
  } catch {
    return null;
  }
};

/**
 * Resolves once every collection that held rows last time holds some again, or has heard from the server, so the
 * first screen is drawn from the whole log rather than from whichever part came back first. A device new to the
 * app waits for the server instead. Afterwards keeps the record of which collections hold rows up to date.
 */
const restored = async (collections: Record<CollectionName, Sized>): Promise<void> => {
  const names = Object.keys(collections) as CollectionName[];
  const kept = readKept();
  const back = (name: CollectionName) =>
    collections[name].status === "ready" || (kept !== null && (kept[name] !== true || collections[name].size > 0));
  const deadline = Date.now() + RESTORE_WAIT_MS;
  while (!names.every(back) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, RESTORE_POLL_MS));
  }

  const remember = () => {
    try {
      localStorage.setItem(
        KEPT_KEY,
        JSON.stringify(Object.fromEntries(names.map((name) => [name, collections[name].size > 0]))),
      );
    } catch {}
  };
  remember();
  for (const name of names) {
    collections[name].subscribeChanges(remember);
  }
};

export type Store = {
  readonly exercises: Collection<Exercise, string>;
  readonly workouts: Collection<Workout, string>;
  readonly entries: Collection<Entry, string>;
  readonly sets: Collection<LiftSet, string>;
  readonly programs: Collection<Program, string>;
  readonly trainingMaxes: Collection<TrainingMax, string>;
  readonly programDays: Collection<ProgramDay, string>;
  readonly programExercises: Collection<ProgramExercise, string>;
  readonly prescriptions: Collection<Prescription, string>;
  readonly sessions: Collection<ScheduledSession, string>;
  /** Where a change made without a connection is kept until it can be sent. */
  readonly durability: () => Durability;
  /**
   * Makes changes to the collections that show at once, survive a restart and reach the server together, in order,
   * whenever it can next be reached.
   */
  readonly write: (apply: () => void) => void;
  /** Changes not yet on the server. */
  readonly pending: () => number;
  /** Why the server turned down the latest change it refused, which has been undone here; `null` once dismissed. */
  readonly refusal: () => string | null;
  readonly dismissRefusal: () => void;
  readonly onRefusal: (listener: Listener) => () => void;
};

export const openStore = async (): Promise<Store> => {
  const persistence = await openPersistence();
  const queryClient = new QueryClient();

  const confirm = new Map<string, Confirm>();

  const collection = <T extends { id: string }>(name: CollectionName, list: z.ZodType<T[]>): Collection<T, string> => {
    const queryKey = ["lifts", name];
    const synced = queryCollectionOptions<T, unknown, string[], string>({
      id: name,
      queryClient,
      queryKey,
      queryFn: () => requestJson(`${LIFTS_API}/${ROWS[name].path}`, list),
      getKey: (row) => row.id,
    });
    confirm.set(name, async (changes) => {
      // A read begun before the push was answered would put back what the push replaced.
      await queryClient.cancelQueries({ queryKey });
      for (const change of changes) {
        if (change.type !== "delete") {
          synced.utils.writeUpsert(change.modified as T);
          continue;
        }
        try {
          synced.utils.writeDelete(change.key);
        } catch (error) {
          if (!(error instanceof DeleteOperationItemNotFoundError)) {
            throw error;
          }
        }
      }
    });
    return persistence === null
      ? createCollection(synced)
      : createCollection(persistedCollectionOptions({ ...synced, persistence, schemaVersion: SCHEMA_VERSION }));
  };

  const collections = {
    exercises: collection("exercises", ExerciseList),
    workouts: collection("workouts", WorkoutList),
    entries: collection("entries", EntryList),
    sets: collection("sets", LiftSetList),
    programs: collection("programs", ProgramList),
    trainingMaxes: collection("trainingMaxes", TrainingMaxList),
    programDays: collection("programDays", ProgramDayList),
    programExercises: collection("programExercises", ProgramExerciseList),
    prescriptions: collection("prescriptions", PrescriptionList),
    sessions: collection("sessions", ScheduledSessionList),
  };

  const executor = startOfflineExecutor({
    collections,
    mutationFns: {
      push: async ({ transaction, idempotencyKey }) => {
        const mutations = transaction.mutations.map(toMutation);
        try {
          await requestEmpty(`${LIFTS_API}/push`, {
            method: "POST",
            headers: { [IDEMPOTENCY_HEADER]: idempotencyKey },
            body: JSON.stringify({ mutations }),
          });
        } catch (error) {
          throw isRefusal(error) ? new NonRetriableError((error as ApiError).message) : error;
        }
        const changed = Map.groupBy(transaction.mutations, (mutation) => mutation.collection.id);
        for (const [name, changes] of changed) {
          await confirm.get(name)?.(changes);
        }
      },
    },
  });
  await executor.waitForInit();

  for (const each of Object.values(collections)) {
    void each.preload().catch(() => {});
  }
  await restored(collections);

  let refusal: string | null = null;
  const listeners = new Set<Listener>();
  const setRefusal = (message: string | null) => {
    refusal = message;
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    ...collections,
    durability: () => (persistence === null ? "none" : executor.isOfflineEnabled ? "device" : "other-tab"),
    write: (apply) => {
      const transaction = executor.createOfflineTransaction({ mutationFnName: "push", autoCommit: false });
      transaction.mutate(apply);
      // Settles only once the server has answered, so a rejection here is the server's refusal.
      void transaction.commit().catch((error: unknown) => {
        setRefusal(error instanceof Error ? error.message : String(error));
      });
    },
    pending: () => executor.getPendingCount(),
    refusal: () => refusal,
    dismissRefusal: () => setRefusal(null),
    onRefusal: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
