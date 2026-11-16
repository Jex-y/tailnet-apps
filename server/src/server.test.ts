import { describe, expect, test } from "bun:test";
import {
  callTool,
  connectMcp,
  connectMcpWithToken,
  startTestConnector,
  startTestServer,
  TEST_CONNECTOR_URL,
  uniqueLogin,
} from "@apps/core/testing";
import { createApps } from "./apps";

const request = startTestServer(createApps);

describe("server", () => {
  test("health check responds", async () => {
    const response = await request("/healthz");
    expect(response.status).toBe(200);
  });

  test("launcher lists every app", async () => {
    expect(await (await request("/")).text()).toContain(`<ul id="apps"`);
    expect(await (await request("/shell/api/apps")).json()).toContainEqual({ slug: "flats", title: "Flat hunt" });
  });

  test("app root redirects to its trailing-slash path", async () => {
    const response = await request("/flats");
    expect(response.status).toBe(308);
    expect(response.headers.get("Location")).toBe("/flats/");
  });

  test("app page serves the bundled HTML", async () => {
    const response = await request("/flats/");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<div id="root">');
  });

  test("one MCP server offers every app's tools, each app's alone at its own path", async () => {
    const all = await connectMcp(request, "/mcp", uniqueLogin());
    const names = (await all.listTools()).tools.map((tool) => tool.name);

    expect(names).toEqual(expect.arrayContaining(["list_properties", "list_tasks", "get_status"]));
    expect(all.getInstructions()).toContain("## Flat hunt");
    expect(JSON.parse((await callTool(all, "get_status")).text).apps).toContainEqual(
      expect.objectContaining({ slug: "tasks" }),
    );

    const status = await connectMcp(request, "/status/mcp", uniqueLogin());
    expect((await status.listTools()).tools.map((tool) => tool.name)).toEqual(["get_status"]);
  });

  test("MCP requires a Tailscale identity", async () => {
    const response = await request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);
  });

  test("unknown paths are JSON 404s", async () => {
    const response = await request("/nope");
    expect(response.status).toBe(404);
  });
});

describe("connector", () => {
  const { tailnet, internet } = startTestConnector(createApps);
  const me = uniqueLogin();
  const callback = "https://claude.ai/api/mcp/auth_callback";
  const verifier = "a-verifier-long-enough-to-satisfy-pkce-0123456789";
  const challenge = new Bun.CryptoHasher("sha256").update(verifier).digest("base64url");
  const origin = new URL(process.env.PUBLIC_URL ?? "").origin;

  const form = (fields: Record<string, string>) => ({ method: "POST", body: new URLSearchParams(fields) });
  const token = async (fields: Record<string, string>) => {
    const response = await internet("/oauth/token", form(fields));
    return { status: response.status, body: (await response.json()) as Record<string, string> };
  };

  test("a client a tailnet viewer approves acts as them from the internet, and nothing else gets in", async () => {
    const anonymous = await internet("/mcp", { method: "POST", as: me });
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("WWW-Authenticate")).toContain(
      `resource_metadata="${TEST_CONNECTOR_URL}/.well-known/oauth-protected-resource/mcp"`,
    );
    const metadata = await (await internet("/.well-known/oauth-authorization-server")).json();
    expect(metadata.authorization_endpoint).toBe(`${origin}/shell/connector/authorize`);

    const stranger = await internet("/oauth/register", {
      method: "POST",
      body: JSON.stringify({ redirect_uris: ["https://evil.example/callback"] }),
    });
    expect(stranger.status).toBe(400);
    const { client_id } = await (
      await internet("/oauth/register", { method: "POST", body: JSON.stringify({ redirect_uris: [callback] }) })
    ).json();

    const params = {
      response_type: "code",
      client_id,
      redirect_uri: callback,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "xyz",
    };
    const consent = await tailnet(`/shell/connector/authorize?${new URLSearchParams(params)}`, { as: me });
    expect(await consent.text()).toContain(me);
    const forged = await tailnet("/shell/connector/authorize", {
      ...form({ ...params, decision: "allow" }),
      headers: { Origin: "https://evil.example" },
      as: me,
    });
    expect(forged.status).toBe(403);
    const approved = await tailnet("/shell/connector/authorize", {
      ...form({ ...params, decision: "allow" }),
      headers: { Origin: origin },
      as: me,
    });
    const location = new URL(approved.headers.get("Location") ?? "");
    expect(`${location.origin}${location.pathname}`).toBe(callback);
    expect(location.searchParams.get("state")).toBe("xyz");
    const code = location.searchParams.get("code") ?? "";

    const exchange = { grant_type: "authorization_code", code, redirect_uri: callback, client_id };
    expect((await token({ ...exchange, code_verifier: `${verifier}-wrong` })).body.error).toBe("invalid_grant");
    expect((await token({ ...exchange, code_verifier: verifier })).body.error).toBe("invalid_grant");

    const again = await tailnet("/shell/connector/authorize", {
      ...form({ ...params, decision: "allow" }),
      headers: { Origin: origin },
      as: me,
    });
    const issued = await token({
      ...exchange,
      code: new URL(again.headers.get("Location") ?? "").searchParams.get("code") ?? "",
      code_verifier: verifier,
    });
    expect(issued.status).toBe(200);

    const client = await connectMcpWithToken(internet, "/mcp", issued.body.access_token ?? "");
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("list_tasks");

    const refresh = { grant_type: "refresh_token", refresh_token: issued.body.refresh_token ?? "", client_id };
    expect((await token(refresh)).status).toBe(200);
    expect((await token(refresh)).body.error).toBe("invalid_grant");
  });
});
