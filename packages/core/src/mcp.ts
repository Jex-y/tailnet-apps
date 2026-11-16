import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { HttpError } from "./http";
import type { Viewer } from "./identity";

export type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** An app's tools, served at `/<slug>/mcp` and alongside every other app's at `/mcp`. */
export type AppMcp = {
  /** What the app is and how its tools fit together, for the model. */
  readonly instructions: string;
  /** Registers tools acting as `viewer`; tool names must be unique across every app. */
  readonly registerTools: (server: McpServer, viewer: Viewer) => void;
};

type McpApp = { readonly slug: string; readonly title: string; readonly mcp: AppMcp };

export const jsonResult = (value: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
});

/** Refusals go back to the model as tool errors it can read and act on, rather than protocol failures. */
export const toolResult = async <T>(
  work: () => Promise<T>,
  render: (value: T) => CallToolResult = jsonResult,
): Promise<CallToolResult> => {
  try {
    return render(await work());
  } catch (error) {
    if (error instanceof HttpError) {
      return { isError: true, content: [{ type: "text", text: error.message }] };
    }
    throw error;
  }
};

const instructionsOf = (apps: readonly McpApp[]): string => {
  const [only] = apps;
  return apps.length === 1 && only !== undefined
    ? only.mcp.instructions
    : apps.map((app) => `## ${app.title}\n\n${app.mcp.instructions}`).join("\n\n");
};

/**
 * Serves `apps`' tools over MCP Streamable HTTP to `viewer`, statelessly: each request gets its own server and
 * transport, and answers with plain JSON, so nothing is held between requests and any server instance can answer.
 */
const mcpHandler = (name: string, apps: readonly McpApp[]) => {
  const instructions = instructionsOf(apps);
  return async (request: Request, viewer: Viewer): Promise<Response> => {
    const server = new McpServer({ name, version: "1.0.0" }, { instructions });
    for (const app of apps) {
      app.mcp.registerTools(server, viewer);
    }
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(request);
  };
};

/** `/mcp` for every app together, and `/<slug>/mcp` for each alone, each acting as whoever `authenticate` finds. */
export const createMcpRoutes = (
  apps: readonly McpApp[],
  authenticate: (request: Request) => Promise<Viewer | Response>,
) => {
  const route = (name: string, served: readonly McpApp[]) => {
    const serve = mcpHandler(name, served);
    const handle = async (request: Request): Promise<Response> => {
      const viewer = await authenticate(request);
      return viewer instanceof Response ? viewer : serve(request, viewer);
    };
    return { GET: handle, POST: handle, DELETE: handle };
  };
  return Object.fromEntries([
    ["/mcp", route("tailnet-apps", apps)],
    ...apps.map((app) => [`/${app.slug}/mcp`, route(`tailnet-apps-${app.slug}`, [app])]),
  ]);
};
