import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createECDH, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sql";
import webpush from "web-push";
import { type AppModule, appRoutes } from "../app-module";
import { createNotifierFactory, parseNotifyConfig } from "../notify";
import { subscriptions } from "../push/schema";
import { createWebPushNotifier, type WebPushConfig } from "../push/send";
import { startServer } from "../server";
import { createTestContext, uniqueLogin } from "../testing";
import { appSlugAt } from "./contract";
import { themes } from "./schema";

const context = createTestContext();
const db = drizzle({ client: context.sql });
const vapid = webpush.generateVAPIDKeys();
const webPush: WebPushConfig = { ...vapid, subject: "mailto:apps@example.com" };
const shell = { identity: context.identity, sql: context.sql, webPush };

const app = (slug: string, title: string, fields: Partial<AppModule> = {}): AppModule => ({
  slug,
  title,
  routes: appRoutes({}),
  jobs: [],
  schedules: [],
  mcp: { instructions: "", registerTools: () => {} },
  ...fields,
});

/** A page as the build leaves it, with the files it loads. */
const builtPage: Bun.HTMLBundle = {
  index: "./index.html",
  files: [
    { path: "./index.html", loader: "html", isEntry: true, headers: { etag: "a", "content-type": "text/html" } },
    { path: "./chunk-1.js", loader: "js", isEntry: true, headers: { etag: "b", "content-type": "text/javascript" } },
  ],
};

const server = startServer({
  port: 0,
  development: false,
  apps: [app("flats", "Flat hunt"), app("tasks", "Tasks"), app("lifts", "Lifts", { offlinePage: builtPage })],
  shell,
});
afterAll(() => server.stop(true));

const request = (path: string, init: RequestInit & { as?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.as !== undefined) {
    headers.set("Tailscale-User-Login", init.as);
  }
  return fetch(new URL(path, server.url), { ...init, headers });
};

/** A subscription a real browser could have produced: a P-256 public key and a 16-byte auth secret. */
const browserSubscription = (endpoint = `https://push.example/${crypto.randomUUID()}`) => {
  const keys = createECDH("prime256v1");
  keys.generateKeys();
  return {
    endpoint,
    keys: {
      p256dh: keys.getPublicKey("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  };
};

const subscribe = (as: string, subscription = browserSubscription(), slug = "flats") =>
  request(`/${slug}/shell/api/push/subscriptions`, {
    method: "POST",
    as,
    body: JSON.stringify(subscription),
  });

beforeEach(async () => {
  await db.delete(subscriptions);
  await db.delete(themes);
});

describe("notify config", () => {
  test("requires a complete VAPID key pair and a contact subject", () => {
    expect(
      parseNotifyConfig({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:a@b.c" }),
    ).toEqual({ publicKey: "pub", privateKey: "priv", subject: "mailto:a@b.c" });
    expect(() => parseNotifyConfig({ VAPID_PUBLIC_KEY: "pub" })).toThrow(/VAPID_PRIVATE_KEY/);
    expect(() =>
      parseNotifyConfig({ VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "someone" }),
    ).toThrow(/VAPID_SUBJECT/);
  });
});

describe("shell", () => {
  test("serves each app a manifest that installs it alone, under its own name", async () => {
    const response = await request("/flats/shell/manifest.webmanifest");
    expect(response.headers.get("Content-Type")).toBe("application/manifest+json");
    expect(await response.json()).toMatchObject({
      name: "Flat hunt",
      id: "/flats/",
      start_url: "/flats/",
      scope: "/flats/",
      display: "standalone",
      icons: [{ src: "/flats/shell/icons/icon-192.png" }, { src: "/flats/shell/icons/icon-512.png" }],
    });
    expect(await (await request("/tasks/shell/manifest.webmanifest")).json()).toMatchObject({
      name: "Tasks",
      scope: "/tasks/",
    });
  });

  test("the launcher is not installable", async () => {
    expect((await request("/manifest.webmanifest")).status).toBe(404);
  });

  test("serves each app its service worker, uncached and allowed the whole app", async () => {
    const worker = await request("/tasks/shell/sw.js");
    expect(worker.headers.get("Content-Type")).toStartWith("text/javascript");
    expect(worker.headers.get("Cache-Control")).toBe("no-cache");
    expect(worker.headers.get("Service-Worker-Allowed")).toBe("/tasks/");
    const script = await worker.text();
    expect(script).toStartWith("const OFFLINE = false;\n");
    expect(script).toContain('addEventListener("push"');
    expect((await request("/sw.js")).status).toBe(404);
  });

  test("lists what to keep on the device for an app that works offline, and for no other", async () => {
    const manifest = await request("/lifts/shell/offline.json");
    expect(manifest.headers.get("Cache-Control")).toBe("no-cache");
    expect(await manifest.json()).toEqual({ version: expect.any(String), urls: ["/lifts/", "/chunk-1.js"] });
    expect(await (await request("/lifts/shell/sw.js")).text()).toStartWith("const OFFLINE = true;\n");
    expect((await request("/tasks/shell/offline.json")).status).toBe(404);
  });

  test("draws each app its own icons", async () => {
    const icon = async (slug: string, size: number) => {
      const response = await request(`/${slug}/shell/icons/icon-${size}.png`);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("image/png");
      return new Uint8Array(await response.arrayBuffer());
    };
    const pngSignature = [0x89, 0x50, 0x4e, 0x47];
    for (const size of [180, 192, 512]) {
      expect([...(await icon("flats", size)).slice(0, 4)]).toEqual(pngSignature);
    }
    expect(Buffer.from(await icon("flats", 192)).equals(Buffer.from(await icon("tasks", 192)))).toBe(false);
  });

  test("serves the settings page for the launcher and inside each app", async () => {
    for (const path of ["/shell/settings", "/flats/shell/settings", "/tasks/shell/settings"]) {
      const response = await request(path);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("<title>Settings</title>");
    }
  });

  test("tells an app's pages the key to subscribe with", async () => {
    expect(await (await request("/flats/shell/api/push")).json()).toEqual({
      publicKey: vapid.publicKey,
    });
  });

  test("a page belongs to the app its path starts with, and the shell's own pages to none", () => {
    expect(appSlugAt("/flats/")).toBe("flats");
    expect(appSlugAt("/flats/shell/settings")).toBe("flats");
    expect(appSlugAt("/")).toBeNull();
    expect(appSlugAt("/shell/settings")).toBeNull();
  });

  test("an app cannot take the shell's slug, or routes under its own shell path", () => {
    const start = (taken: AppModule) => () => startServer({ port: 0, development: false, apps: [taken], shell });
    expect(start(app("shell", "Shell"))).toThrow(/reserved/);
    expect(start(app("pet", "Pet", { routes: appRoutes({ "/pet/shell/settings": new Response("mine") }) }))).toThrow(
      /reserved/,
    );
  });
});

describe("saved theme", () => {
  const theme = async (as: string) => (await request("/shell/api/theme", { as })).json();
  const choose = (as: string, chosen: string) =>
    request("/shell/api/theme", { method: "PUT", as, body: JSON.stringify({ theme: chosen }) });

  test("keeps the theme each person chose, and none until they choose", async () => {
    const [me, them] = [uniqueLogin(), uniqueLogin()];
    expect(await theme(me)).toEqual({ theme: null });

    expect((await choose(me, "drafting")).status).toBe(204);
    expect((await choose(me, "command")).status).toBe(204);
    expect(await theme(me)).toEqual({ theme: "command" });
    expect(await theme(them)).toEqual({ theme: null });
  });

  test("refuses a theme that does not exist, and anonymous viewers", async () => {
    expect((await choose(uniqueLogin(), "paper")).status).toBe(400);
    expect((await request("/shell/api/theme")).status).toBe(401);
  });

  test("a saved theme that has since been removed reads as no choice", async () => {
    const me = uniqueLogin();
    await db.insert(themes).values({ login: me, theme: "paper" });
    expect(await theme(me)).toEqual({ theme: null });
  });
});

describe("push subscriptions", () => {
  test("stores a subscription against the viewer and the app, and resubscribing updates it", async () => {
    const me = uniqueLogin();
    const subscription = browserSubscription();
    expect((await subscribe(me, subscription)).status).toBe(204);
    const renewed = { ...browserSubscription(subscription.endpoint) };
    expect((await subscribe(me, renewed)).status).toBe(204);

    const rows = await db.select().from(subscriptions).where(eq(subscriptions.endpoint, subscription.endpoint));
    expect(rows).toMatchObject([{ login: me, topic: "flats", p256dh: renewed.keys.p256dh, auth: renewed.keys.auth }]);
  });

  test("refuses anonymous and non-HTTPS subscriptions, and apps that do not exist", async () => {
    expect(
      (
        await request("/flats/shell/api/push/subscriptions", {
          method: "POST",
          body: JSON.stringify(browserSubscription()),
        })
      ).status,
    ).toBe(401);
    expect((await subscribe(uniqueLogin(), browserSubscription("http://push.example/x"))).status).toBe(400);
    expect((await subscribe(uniqueLogin(), browserSubscription(), "nope")).status).toBe(404);
  });

  test("only removes the viewer's own subscription, through the app it belongs to", async () => {
    const me = uniqueLogin();
    const subscription = browserSubscription();
    await subscribe(me, subscription);
    const remove = (as: string, slug: string) =>
      request(`/${slug}/shell/api/push/subscriptions`, {
        method: "DELETE",
        as,
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });

    await remove(uniqueLogin(), "flats");
    await remove(me, "tasks");
    expect(await db.select().from(subscriptions)).toHaveLength(1);
    await remove(me, "flats");
    expect(await db.select().from(subscriptions)).toHaveLength(0);
  });
});

describe("web push notifier", () => {
  const recordingPushService = (statusFor: (endpoint: string) => number) => {
    const sent: { url: string; headers: Headers; body: Uint8Array }[] = [];
    const send = (async (url: string | URL | Request, init?: RequestInit) => {
      sent.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: new Uint8Array(init?.body as Uint8Array),
      });
      return new Response(null, { status: statusFor(String(url)) });
    }) as typeof fetch;
    return { send, sent };
  };

  test("sends an encrypted, VAPID-signed message to every browser subscribed to the app", async () => {
    const [mine, theirs] = [browserSubscription(), browserSubscription()];
    await subscribe(uniqueLogin(), mine);
    await subscribe(uniqueLogin(), theirs);
    await subscribe(uniqueLogin(), browserSubscription(), "tasks");
    const service = recordingPushService(() => 201);

    await createWebPushNotifier({
      config: webPush,
      sql: context.sql,
      topic: "flats",
      send: service.send,
    }).send({
      title: "New flat",
      message: "2 bed, Hackney",
      priority: "high",
    });

    expect(service.sent.map((request) => request.url).sort()).toEqual([mine.endpoint, theirs.endpoint].sort());
    for (const request of service.sent) {
      expect(request.headers.get("Content-Encoding")).toBe("aes128gcm");
      expect(request.headers.get("Authorization")).toStartWith("vapid t=");
      expect(request.headers.get("Urgency")).toBe("high");
      expect(request.body.byteLength).toBeGreaterThan(0);
    }
  });

  test("targets one person's browsers when given a login", async () => {
    const me = uniqueLogin();
    const mine = browserSubscription();
    await subscribe(me, mine);
    await subscribe(uniqueLogin());
    const service = recordingPushService(() => 201);

    await createWebPushNotifier({
      config: webPush,
      sql: context.sql,
      topic: "flats",
      login: me,
      send: service.send,
    }).send({
      title: "Test",
      message: "Hello",
    });

    expect(service.sent.map((request) => request.url)).toEqual([mine.endpoint]);
  });

  test("an app's notifier reaches only its own subscribers, and one person's when given their login", async () => {
    const received: string[] = [];
    const pushService = Bun.serve({
      port: 0,
      fetch: (request) => {
        received.push(new URL(request.url).pathname);
        return new Response(null, { status: 201 });
      },
    });
    afterAll(() => pushService.stop(true));
    const me = uniqueLogin();
    const subscribeAt = (login: string, topic: string, path: string) => {
      const { endpoint, keys } = browserSubscription(new URL(path, pushService.url).href);
      return db.insert(subscriptions).values({ endpoint, ...keys, login, topic });
    };
    await subscribeAt(me, "tasks", "/my-tasks");
    await subscribeAt(me, "flats", "/my-flats");
    await subscribeAt(uniqueLogin(), "tasks", "/their-tasks");
    await subscribeAt(uniqueLogin(), "flats", "/their-flats");
    const notifier = createNotifierFactory(webPush, context.sql);

    await notifier("tasks", me).send({ title: "Due today", message: "Book the survey" });
    expect(received).toEqual(["/my-tasks"]);

    received.length = 0;
    await notifier("flats").send({ title: "New flat", message: "2 bed, Hackney" });
    expect(received.toSorted()).toEqual(["/my-flats", "/their-flats"]);
  });

  test("forgets browsers the push service reports gone, and fails after trying the rest", async () => {
    const [gone, broken, fine] = [browserSubscription(), browserSubscription(), browserSubscription()];
    for (const subscription of [gone, broken, fine]) {
      await subscribe(uniqueLogin(), subscription);
    }
    const service = recordingPushService((url) => (url === gone.endpoint ? 410 : url === broken.endpoint ? 500 : 201));

    const sending = createWebPushNotifier({
      config: webPush,
      sql: context.sql,
      topic: "flats",
      send: service.send,
    }).send({
      title: "New flat",
      message: "2 bed, Hackney",
    });

    expect(sending).rejects.toThrow("1 of 3 push deliveries failed");
    await sending.catch(() => undefined);
    expect(service.sent).toHaveLength(3);
    expect((await db.select().from(subscriptions)).map((row) => row.endpoint).sort()).toEqual(
      [broken.endpoint, fine.endpoint].sort(),
    );
  });
});
