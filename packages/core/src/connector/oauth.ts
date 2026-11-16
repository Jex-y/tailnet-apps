import { z } from "zod";

/**
 * Where an approved client may be sent back to: Claude's own callbacks, and loopback for clients on the viewer's
 * device. Anyone can register a client, so this list, not registration, decides who can receive a code.
 */
const isAllowedRedirect = (uri: URL): boolean =>
  (uri.protocol === "https:" &&
    (uri.host === "claude.ai" || uri.host === "claude.com") &&
    uri.pathname === "/api/mcp/auth_callback") ||
  (uri.protocol === "http:" && (uri.hostname === "localhost" || uri.hostname === "127.0.0.1"));

const RedirectUri = z.url().refine((uri) => isAllowedRedirect(new URL(uri)), "This redirect URI is not allowed");

export const RegistrationRequest = z.object({
  redirect_uris: z.array(RedirectUri).min(1),
});
export type RegistrationRequest = z.infer<typeof RegistrationRequest>;

/** A registered client carries its redirect URIs in its id, so registering stores nothing. */
export type Client = {
  readonly id: string;
  readonly redirectUris: readonly string[];
};

export const registerClient = ({ redirect_uris }: RegistrationRequest): Client => ({
  id: Buffer.from(JSON.stringify(redirect_uris)).toString("base64url"),
  redirectUris: redirect_uris,
});

const ClientRedirectUris = z.array(RedirectUri).min(1);

export const parseClientId = (id: string): Client | null => {
  const decoded = z
    .string()
    .transform((json, context) => {
      try {
        return JSON.parse(Buffer.from(json, "base64url").toString()) as unknown;
      } catch {
        context.addIssue({ code: "custom", message: "Not a client id" });
        return z.NEVER;
      }
    })
    .pipe(ClientRedirectUris)
    .safeParse(id);
  return decoded.success ? { id, redirectUris: decoded.data } : null;
};

const AuthorizeParams = z.object({
  response_type: z.literal("code"),
  client_id: z.string(),
  redirect_uri: z.string(),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal("S256"),
  state: z.string().optional(),
});

/** An authorization request whose redirect URI is one its client registered. */
export type AuthorizeRequest = {
  readonly client: Client;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly state: string | undefined;
};

export const parseAuthorizeRequest = (params: Record<string, string>): AuthorizeRequest | null => {
  const parsed = AuthorizeParams.safeParse(params);
  if (!parsed.success) {
    return null;
  }
  const client = parseClientId(parsed.data.client_id);
  if (client === null || !client.redirectUris.includes(parsed.data.redirect_uri)) {
    return null;
  }
  return {
    client,
    redirectUri: parsed.data.redirect_uri,
    codeChallenge: parsed.data.code_challenge,
    state: parsed.data.state,
  };
};

export const TokenRequest = z.discriminatedUnion("grant_type", [
  z.object({
    grant_type: z.literal("authorization_code"),
    code: z.string(),
    redirect_uri: z.string(),
    client_id: z.string(),
    code_verifier: z.string().min(43).max(128),
  }),
  z.object({
    grant_type: z.literal("refresh_token"),
    refresh_token: z.string(),
    client_id: z.string(),
  }),
]);
export type TokenRequest = z.infer<typeof TokenRequest>;

const sha256 = (value: string): Buffer => new Bun.CryptoHasher("sha256").update(value).digest();

export const hashSecret = (secret: string): string => sha256(secret).toString("hex");

export const newSecret = (): string => crypto.getRandomValues(Buffer.alloc(32)).toString("base64url");

export const verifiesChallenge = (verifier: string, challenge: string): boolean =>
  sha256(verifier).toString("base64url") === challenge;
