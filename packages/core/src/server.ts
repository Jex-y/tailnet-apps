import { type AppModule, routePaths, serveRoutes } from "./app-module";
import { type AuthorizeOptions, createAuthorizeRoutes } from "./connector/routes";
import { errorResponse } from "./http";
import { resolveViewer } from "./identity";
import { createMcpRoutes } from "./mcp";
import { appShellPath, SHELL_SLUG } from "./shell/contract";
import { createShellRoutes, type ShellOptions } from "./shell/routes";

const mergeAppRoutes = (apps: readonly AppModule[]): Bun.Serve.Routes<undefined, string> => {
  const slugs = apps.map((app) => app.slug);
  const duplicate = slugs.find((slug, index) => slugs.indexOf(slug) !== index);
  if (duplicate !== undefined) {
    throw new Error(`Two apps share the slug "${duplicate}"`);
  }
  if (slugs.includes(SHELL_SLUG)) {
    throw new Error(`The slug "${SHELL_SLUG}" is reserved for the app shell`);
  }
  for (const app of apps) {
    const stray = routePaths(app.routes).find((path) => path !== `/${app.slug}` && !path.startsWith(`/${app.slug}/`));
    if (stray !== undefined) {
      throw new Error(`App "${app.slug}" declares route "${stray}" outside /${app.slug}/`);
    }
    const shell = appShellPath(app.slug);
    const taken = routePaths(app.routes).find((path) => path === shell || path.startsWith(`${shell}/`));
    if (taken !== undefined) {
      throw new Error(
        `App "${app.slug}" declares route "${taken}" under ${shell}/, which is reserved for the app shell`,
      );
    }
  }
  return Object.assign({}, ...apps.map((app) => serveRoutes(app.routes)));
};

export type ServerOptions = {
  readonly port: number;
  readonly development: boolean;
  readonly apps: readonly AppModule[];
  readonly shell: ShellOptions;
  /** The connector's approval page, when the connector is on. */
  readonly authorize: Omit<AuthorizeOptions, "identity" | "apps"> | null;
};

export const startServer = ({ port, development, apps, shell, authorize }: ServerOptions): Bun.Server<undefined> =>
  Bun.serve({
    port,
    development,
    routes: {
      ...createShellRoutes(apps, shell),
      ...(authorize !== null && createAuthorizeRoutes({ identity: shell.identity, apps, ...authorize })),
      "/healthz": new Response("ok"),
      ...mergeAppRoutes(apps),
      ...createMcpRoutes(apps, async (request) => resolveViewer(shell.identity, request)),
    },
    fetch: () => Response.json({ error: "Not found" }, { status: 404 }),
    error: errorResponse,
  });
