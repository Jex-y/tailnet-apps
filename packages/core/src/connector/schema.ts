import { pgSchema, text, timestamp } from "drizzle-orm/pg-core";

export const connectorSchema = pgSchema("connector");

/** Single-use, short-lived codes handed to a client's redirect URI once its viewer approves it. */
export const codes = connectorSchema.table("codes", {
  /** SHA-256 of the code; the code itself is never stored. */
  hash: text("hash").primaryKey(),
  clientId: text("client_id").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  /** The PKCE S256 challenge the client's verifier must hash to. */
  codeChallenge: text("code_challenge").notNull(),
  /** The MCP path the tokens issued for it reach. */
  resource: text("resource").notNull().default("/mcp"),
  login: text("login").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/** Access and refresh tokens, each acting as `login` at one MCP path. A refresh token is replaced on every use. */
export const tokens = connectorSchema.table("tokens", {
  /** SHA-256 of the token; the token itself is never stored. */
  hash: text("hash").primaryKey(),
  kind: text("kind", { enum: ["access", "refresh"] }).notNull(),
  clientId: text("client_id").notNull(),
  login: text("login").notNull(),
  /** The only MCP path the token reaches; a refresh token passes it on. */
  resource: text("resource").notNull().default("/mcp"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
