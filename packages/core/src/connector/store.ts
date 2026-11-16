import type { SQL } from "bun";
import { and, eq, gt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sql";
import type { Viewer } from "../identity";
import { type AuthorizeRequest, hashSecret, newSecret, type TokenRequest, verifiesChallenge } from "./oauth";
import { codes, tokens } from "./schema";

const CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TTL_MS = 60 * 60 * 1000;
const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** RFC 6749's token response. */
export type IssuedTokens = {
  readonly access_token: string;
  readonly token_type: "Bearer";
  readonly expires_in: number;
  readonly refresh_token: string;
};

export type TokenOutcome =
  | { readonly kind: "issued"; readonly tokens: IssuedTokens }
  | { readonly kind: "invalid_grant" };

type Grant = { readonly clientId: string; readonly login: string; readonly resource: string };

export type ConnectorStore = ReturnType<typeof createConnectorStore>;

export const createConnectorStore = (sql: SQL, now: () => Date = () => new Date()) => {
  const db = drizzle({ client: sql });
  const after = (ms: number) => new Date(now().getTime() + ms);

  const issue = async ({ clientId, login, resource }: Grant): Promise<TokenOutcome> => {
    const access = newSecret();
    const refresh = newSecret();
    await db.insert(tokens).values([
      {
        hash: hashSecret(access),
        kind: "access",
        clientId,
        login,
        resource,
        expiresAt: after(ACCESS_TTL_MS),
      },
      {
        hash: hashSecret(refresh),
        kind: "refresh",
        clientId,
        login,
        resource,
        expiresAt: after(REFRESH_TTL_MS),
      },
    ]);
    return {
      kind: "issued",
      tokens: {
        access_token: access,
        token_type: "Bearer",
        expires_in: ACCESS_TTL_MS / 1000,
        refresh_token: refresh,
      },
    };
  };

  return {
    /** A code for `viewer` to hand back to the client, which only the holder of the PKCE verifier can redeem. */
    grantCode: async (request: AuthorizeRequest, viewer: Viewer): Promise<string> => {
      const code = newSecret();
      await db.insert(codes).values({
        hash: hashSecret(code),
        clientId: request.client.id,
        redirectUri: request.redirectUri,
        codeChallenge: request.codeChallenge,
        resource: request.endpoint.path,
        login: viewer.login,
        expiresAt: after(CODE_TTL_MS),
      });
      return code;
    },

    /** Redeeming a code or a refresh token uses it up, whether or not the rest of the request checks out. */
    exchange: async (request: TokenRequest): Promise<TokenOutcome> => {
      switch (request.grant_type) {
        case "authorization_code": {
          const [code] = await db
            .delete(codes)
            .where(and(eq(codes.hash, hashSecret(request.code)), gt(codes.expiresAt, now())))
            .returning();
          return code !== undefined &&
            code.clientId === request.client_id &&
            code.redirectUri === request.redirect_uri &&
            verifiesChallenge(request.code_verifier, code.codeChallenge)
            ? issue(code)
            : { kind: "invalid_grant" };
        }
        case "refresh_token": {
          const [token] = await db
            .delete(tokens)
            .where(
              and(
                eq(tokens.hash, hashSecret(request.refresh_token)),
                eq(tokens.kind, "refresh"),
                gt(tokens.expiresAt, now()),
              ),
            )
            .returning();
          return token !== undefined && token.clientId === request.client_id ? issue(token) : { kind: "invalid_grant" };
        }
      }
    },

    /** Who `accessToken` acts as at the MCP path `resource`, if it was issued for that path. */
    viewerFor: async (accessToken: string, resource: string): Promise<Viewer | null> => {
      const [token] = await db
        .select({ login: tokens.login })
        .from(tokens)
        .where(
          and(
            eq(tokens.hash, hashSecret(accessToken)),
            eq(tokens.kind, "access"),
            eq(tokens.resource, resource),
            gt(tokens.expiresAt, now()),
          ),
        );
      return token === undefined ? null : { login: token.login };
    },
  };
};
