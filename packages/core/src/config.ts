import { z } from "zod";
import { type BlobConfig, parseBlobConfig } from "./blob";
import type { IdentityMode } from "./identity";
import { type NotifyConfig, parseNotifyConfig } from "./notify";

export type DatabaseConfig = {
  readonly hostname: string;
  readonly port: number;
  readonly username: string;
  readonly password: string;
  readonly database: string;
};

/** What both the server and the worker need to build the apps. */
export type RuntimeConfig = {
  /** Where people reach the apps, for links that leave the app (notifications, emails). */
  readonly publicUrl: string;
  readonly database: DatabaseConfig;
  readonly blob: BlobConfig;
  readonly notify: NotifyConfig;
};

/** Whether the apps' tools are also served to the internet, for Claude's own servers, behind OAuth. */
export type ConnectorConfig =
  | { readonly kind: "off" }
  | {
      readonly kind: "on";
      readonly port: number;
      /** Where the internet reaches the connector, e.g. through Tailscale Funnel. */
      readonly url: string;
    };

export type ServerConfig = RuntimeConfig & {
  readonly port: number;
  readonly development: boolean;
  readonly identity: IdentityMode;
  readonly connector: ConnectorConfig;
};

export type WorkerConfig = RuntimeConfig & {
  readonly healthPort: number;
  readonly concurrency: number;
};

type Env = Readonly<Record<string, string | undefined>>;

const DatabaseEnv = z.object({
  PGHOST: z.string().min(1),
  PGPORT: z.coerce.number().int().positive().default(5432),
  PGUSER: z.string().min(1),
  PGPASSWORD: z.string().min(1),
  PGDATABASE: z.string().min(1),
});

const ServerEnv = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    DEV_USER: z.string().min(1).optional(),
    CONNECTOR_URL: z.url().optional(),
    CONNECTOR_PORT: z.coerce.number().int().positive().default(3002),
  })
  .refine((env) => env.DEV_USER === undefined || env.NODE_ENV === "development", {
    message: "DEV_USER is only allowed when NODE_ENV=development",
    path: ["DEV_USER"],
  });

const RuntimeEnv = z.object({
  PUBLIC_URL: z.url(),
});

const WorkerEnv = z.object({
  WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(3001),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
});

const parse = <S extends z.ZodType>(schema: S, env: Env): z.infer<S> => {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
};

export const parseDatabaseConfig = (env: Env): DatabaseConfig => {
  const db = parse(DatabaseEnv, env);
  return {
    hostname: db.PGHOST,
    port: db.PGPORT,
    username: db.PGUSER,
    password: db.PGPASSWORD,
    database: db.PGDATABASE,
  };
};

export const parseRuntimeConfig = (env: Env): RuntimeConfig => ({
  publicUrl: parse(RuntimeEnv, env).PUBLIC_URL.replace(/\/$/, ""),
  database: parseDatabaseConfig(env),
  blob: parseBlobConfig(env),
  notify: parseNotifyConfig(env),
});

export const parseServerConfig = (env: Env): ServerConfig => {
  const server = parse(ServerEnv, env);
  return {
    ...parseRuntimeConfig(env),
    port: server.PORT,
    development: server.NODE_ENV === "development",
    identity:
      server.DEV_USER === undefined ? { kind: "tailscale" } : { kind: "fixed", viewer: { login: server.DEV_USER } },
    connector:
      server.CONNECTOR_URL === undefined
        ? { kind: "off" }
        : { kind: "on", port: server.CONNECTOR_PORT, url: server.CONNECTOR_URL.replace(/\/$/, "") },
  };
};

export const parseWorkerConfig = (env: Env): WorkerConfig => {
  const worker = parse(WorkerEnv, env);
  return { ...parseRuntimeConfig(env), healthPort: worker.WORKER_HEALTH_PORT, concurrency: worker.WORKER_CONCURRENCY };
};
