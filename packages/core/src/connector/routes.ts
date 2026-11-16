import { z } from "zod";
import type { AppModule } from "../app-module";
import { errorResponse } from "../http";
import { type IdentityMode, resolveViewer, type Viewer } from "../identity";
import { type AppMcp, createMcpRoutes, type McpEndpoint, mcpEndpoints } from "../mcp";
import { SHELL_SLUG } from "../shell/contract";
import {
  type AuthorizeRequest,
  parseAuthorizeRequest,
  RegistrationRequest,
  registerClient,
  TokenRequest,
} from "./oauth";
import type { ConnectorStore } from "./store";

/** On the tailnet, where the viewer's own browser approves a client as them. */
export const AUTHORIZE_PATH = `/${SHELL_SLUG}/connector/authorize`;

const PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";

const noStore = { "Cache-Control": "no-store" };

const oauthError = (error: string, description: string, status = 400): Response =>
  Response.json({ error, error_description: description }, { status, headers: noStore });

const formParams = async (request: Request): Promise<Record<string, string>> =>
  Object.fromEntries(
    [...(await request.formData().catch(() => new FormData()))].flatMap(([key, value]) =>
      typeof value === "string" ? [[key, value]] : [],
    ),
  );

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const page = (body: string, status = 200): Response =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connect to your apps</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem}button{font:inherit;padding:.5rem 1rem;margin-right:.5rem}</style></head><body>${body}</body></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
        ...noStore,
      },
    },
  );

const usesWhat = (endpoint: McpEndpoint): string => {
  switch (endpoint.kind) {
    case "combined":
      return "every app's tools";
    case "app":
      return endpoint.app.title;
  }
};

const consentPage = (request: AuthorizeRequest, params: Record<string, string>, viewer: Viewer): Response => {
  const hidden = Object.entries(params)
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`)
    .join("");
  const destination = new URL(request.redirectUri).host;
  return page(
    `<h1>Connect to your apps</h1><p><strong>${escapeHtml(destination)}</strong> will use ${escapeHtml(usesWhat(request.endpoint))} as <strong>${escapeHtml(viewer.login)}</strong>.</p><form method="post">${hidden}<button name="decision" value="allow">Allow</button><button name="decision" value="deny">Deny</button></form>`,
  );
};

const redirectTo = (request: AuthorizeRequest, params: Record<string, string>): Response => {
  const location = new URL(request.redirectUri);
  for (const [key, value] of Object.entries({
    ...params,
    ...(request.state === undefined ? {} : { state: request.state }),
  })) {
    location.searchParams.set(key, value);
  }
  return new Response(null, {
    status: 302,
    headers: { Location: location.href, ...noStore },
  });
};

const invalidAuthorizeRequest = () => page("<h1>This connection request is invalid</h1>", 400);

export type AuthorizeOptions = {
  readonly identity: IdentityMode;
  readonly apps: readonly { readonly slug: string; readonly title: string; readonly mcp: AppMcp }[];
  readonly publicUrl: string;
  readonly store: ConnectorStore;
};

type MethodHandlers = Readonly<Record<string, (request: Request) => Response | Promise<Response>>>;

export const createAuthorizeRoutes = ({
  identity,
  apps,
  publicUrl,
  store,
}: AuthorizeOptions): Record<string, MethodHandlers> => {
  const endpoints = mcpEndpoints(apps);
  return {
    [AUTHORIZE_PATH]: {
      GET: (request: Request) => {
        const viewer = resolveViewer(identity, request);
        const params = Object.fromEntries(new URL(request.url).searchParams);
        const authorize = parseAuthorizeRequest(params, endpoints);
        return authorize === null ? invalidAuthorizeRequest() : consentPage(authorize, params, viewer);
      },
      POST: async (request: Request) => {
        const viewer = resolveViewer(identity, request);
        // Any page the viewer visits could otherwise post this form, approving a flow someone else started.
        if (request.headers.get("Origin") !== new URL(publicUrl).origin) {
          return page("<h1>Approve the connection from its own page</h1>", 403);
        }
        const { decision, ...params } = await formParams(request);
        const authorize = parseAuthorizeRequest(params, endpoints);
        if (authorize === null) {
          return invalidAuthorizeRequest();
        }
        return decision === "allow"
          ? redirectTo(authorize, {
              code: await store.grantCode(authorize, viewer),
            })
          : redirectTo(authorize, { error: "access_denied" });
      },
    },
  };
};

export type ConnectorServerOptions = {
  readonly port: number;
  /** Where the internet reaches this server. */
  readonly url: string;
  /** Where the viewer's browser reaches the tailnet server, which serves {@link AUTHORIZE_PATH}. */
  readonly publicUrl: string;
  readonly apps: readonly AppModule[];
  readonly store: ConnectorStore;
};

type Handler = (request: Request) => Response | Promise<Response>;
type Route = Handler | Readonly<Record<string, Handler>>;

/** Logs every request without its query string or body, which may carry codes and tokens. */
const logged =
  (handle: Handler): Handler =>
  async (request) => {
    const response = await handle(request);
    const agent = request.headers.get("User-Agent") ?? "-";
    console.log(`connector ${request.method} ${new URL(request.url).pathname} ${response.status} ${agent}`);
    return response;
  };

const logRoutes = (routes: Readonly<Record<string, Route>>): Record<string, Route> =>
  Object.fromEntries(
    Object.entries(routes).map(([path, route]) => [
      path,
      typeof route === "function"
        ? logged(route)
        : Object.fromEntries(Object.entries(route).map(([method, handle]) => [method, logged(handle)])),
    ]),
  );

const BearerToken = z
  .string()
  .regex(/^Bearer [\w.~+/-]+=*$/)
  .transform((header) => header.slice("Bearer ".length));

/**
 * Serves the apps' tools to the internet, to clients holding a token a viewer approved on the tailnet. Never reads
 * Tailscale identity headers: a request here may have come from anywhere.
 */
export const startConnectorServer = ({
  port,
  url,
  publicUrl,
  apps,
  store,
}: ConnectorServerOptions): Bun.Server<undefined> => {
  const resourceMetadata = (request: Request) => {
    const resource = new URL(request.url).pathname.slice(PROTECTED_RESOURCE_PATH.length) || "/mcp";
    return Response.json({
      resource: `${url}${resource}`,
      authorization_servers: [url],
    });
  };

  const authenticate = async (request: Request): Promise<Viewer | Response> => {
    const token = BearerToken.safeParse(request.headers.get("Authorization"));
    const viewer = token.success ? await store.viewerFor(token.data, new URL(request.url).pathname) : null;
    if (viewer !== null) {
      return viewer;
    }
    const challenge = [
      `resource_metadata="${url}${PROTECTED_RESOURCE_PATH}${new URL(request.url).pathname}"`,
      ...(token.success ? ['error="invalid_token"'] : []),
    ].join(", ");
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "WWW-Authenticate": `Bearer ${challenge}` } },
    );
  };

  const authorizationServer = Response.json({
    issuer: url,
    authorization_endpoint: `${publicUrl}${AUTHORIZE_PATH}`,
    token_endpoint: `${url}/oauth/token`,
    registration_endpoint: `${url}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  });

  return Bun.serve({
    port,
    routes: logRoutes({
      [PROTECTED_RESOURCE_PATH]: resourceMetadata,
      [`${PROTECTED_RESOURCE_PATH}/*`]: resourceMetadata,
      "/.well-known/oauth-authorization-server": () => authorizationServer.clone(),
      "/oauth/register": {
        POST: async (request) => {
          const body: unknown = await request.json().catch(() => null);
          const registration = RegistrationRequest.safeParse(body);
          if (!registration.success) {
            console.log(`connector refused to register ${JSON.stringify(body)}`);
            return oauthError("invalid_redirect_uri", z.prettifyError(registration.error));
          }
          const client = registerClient(registration.data);
          return Response.json(
            {
              client_id: client.id,
              redirect_uris: client.redirectUris,
              token_endpoint_auth_method: "none",
              grant_types: ["authorization_code", "refresh_token"],
              response_types: ["code"],
            },
            { status: 201, headers: noStore },
          );
        },
      },
      "/oauth/token": {
        POST: async (request) => {
          const token = TokenRequest.safeParse(await formParams(request));
          if (!token.success) {
            return oauthError("invalid_request", z.prettifyError(token.error));
          }
          const outcome = await store.exchange(token.data);
          switch (outcome.kind) {
            case "issued":
              return Response.json(outcome.tokens, { headers: noStore });
            case "invalid_grant":
              return oauthError("invalid_grant", "The code or refresh token is invalid, expired or already used");
          }
        },
      },
      ...createMcpRoutes(apps, authenticate),
    }),
    fetch: logged(() => Response.json({ error: "Not found" }, { status: 404 })),
    error: errorResponse,
  });
};
