import { afterAll } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { AppContext, AppModule } from "./app-module";
import { parseRuntimeConfig } from "./config";
import { startConnectorServer } from "./connector/routes";
import { createConnectorStore } from "./connector/store";
import { createSql } from "./database";
import { createJobQueue } from "./jobs/queue";
import { createNotifierFactory } from "./notify";
import { type ServerOptions, startServer } from "./server";

/** A context built from the test environment, closed after the test file. Identity is Tailscale headers. */
export const createTestContext = (): AppContext => {
  const config = parseRuntimeConfig(process.env);
  const sql = createSql(config.database);
  afterAll(() => sql.close());
  return {
    env: process.env,
    publicUrl: config.publicUrl,
    sql,
    blob: config.blob,
    notifier: createNotifierFactory(config.notify, sql),
    jobs: createJobQueue(sql),
    identity: { kind: "tailscale" },
  };
};

export type TestRequestInit = RequestInit & {
  /** Sent as the Tailscale login; omit to make an anonymous request. */
  readonly as?: string;
};

export type TestRequest = (path: string, init?: TestRequestInit) => Promise<Response>;

const requestTo =
  (server: Bun.Server<undefined>): TestRequest =>
  (path, { as, ...init } = {}) => {
    const headers = new Headers(init.headers);
    if (as !== undefined) {
      headers.set("Tailscale-User-Login", as);
    }
    return fetch(new URL(path, server.url), { ...init, headers, redirect: "manual" });
  };

const startTailnetServer = (
  apps: readonly AppModule[],
  context: AppContext,
  authorize: ServerOptions["authorize"],
): Bun.Server<undefined> => {
  const server = startServer({
    port: 0,
    development: false,
    apps,
    shell: { identity: context.identity, sql: context.sql, webPush: parseRuntimeConfig(process.env).notify },
    authorize,
  });
  afterAll(() => server.stop(true));
  return server;
};

/** Boots a real server for the given apps on a random port, torn down after the test file. */
export const startTestServer = (
  createApps: (context: AppContext) => readonly AppModule[],
  context: AppContext = createTestContext(),
): TestRequest => requestTo(startTailnetServer(createApps(context), context, null));

/** What the connector's metadata calls itself; requests reach it on a random port. */
export const TEST_CONNECTOR_URL = "https://connector.test";

export type TestConnector = { readonly tailnet: TestRequest; readonly internet: TestRequest };

/** Boots the tailnet server with its approval page, and the connector beside it, both torn down after the file. */
export const startTestConnector = (
  createApps: (context: AppContext) => readonly AppModule[],
  context: AppContext = createTestContext(),
): TestConnector => {
  const apps = createApps(context);
  const store = createConnectorStore(context.sql);
  const tailnet = startTailnetServer(apps, context, { publicUrl: context.publicUrl, store });
  const internet = startConnectorServer({
    port: 0,
    url: TEST_CONNECTOR_URL,
    publicUrl: context.publicUrl,
    apps,
    store,
  });
  afterAll(() => internet.stop(true));
  return { tailnet: requestTo(tailnet), internet: requestTo(internet) };
};

export const uniqueLogin = (): string => `${crypto.randomUUID()}@test.local`;

const connectWith = async (request: TestRequest, path: string, init: TestRequestInit): Promise<Client> => {
  const client = new Client({ name: "test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(path, "http://apps.test"), {
    fetch: (url, sent) =>
      request(new URL(url).pathname, {
        ...sent,
        ...init,
        headers: { ...Object.fromEntries(new Headers(sent?.headers)), ...init.headers },
      }),
  });
  // The SDK's optional `sessionId` is typed without `| undefined`, which `exactOptionalPropertyTypes` rejects.
  await client.connect(transport as Transport);
  return client;
};

/** The MCP SDK's own client, reaching `path` on the test server as `as` from a tailnet device. */
export const connectMcp = (request: TestRequest, path: string, as: string): Promise<Client> =>
  connectWith(request, path, { as });

/** The MCP SDK's own client, reaching `path` on the connector with an access token. */
export const connectMcpWithToken = (request: TestRequest, path: string, accessToken: string): Promise<Client> =>
  connectWith(request, path, { headers: { Authorization: `Bearer ${accessToken}` } });

export type ToolText = { readonly isError: boolean; readonly text: string };

/** Calls a tool that answers in text, as most do. */
export const callTool = async (client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolText> => {
  const result = await client.callTool({ name, arguments: args });
  const [content] = result.content as { type: string; text: string }[];
  return { isError: result.isError === true, text: content?.text ?? "" };
};
