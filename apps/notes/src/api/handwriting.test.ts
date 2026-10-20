import { describe, expect, test } from "bun:test";
import { drainJobs } from "@apps/core";
import { connectMcp, startTestServer, uniqueLogin } from "@apps/core/testing";
import { createNotesTestContext, fakeReader, ink, NOW, PIXEL_PNG, paragraph, stroke } from "../../test/support";
import { IDEMPOTENCY_HEADER, type MutationJson } from "../contract";
import { createNotesApp } from "../module";
import { notesDb } from "./db";
import { createMathpixReader } from "./handwriting";
import { createNotesWork, READ_AFTER_MS } from "./work";

const context = createNotesTestContext();
const { reader, requests } = fakeReader();
const request = startTestServer((ctx) => [createNotesApp(ctx, { reader, now: () => NOW })], context);
const work = createNotesWork({ db: notesDb(context.sql), reader, now: () => NOW });
const me = uniqueLogin();

const pushed = async (mutations: readonly MutationJson[]) => {
  const response = await request("/notes/api/push", {
    as: me,
    method: "POST",
    headers: { "Content-Type": "application/json", [IDEMPOTENCY_HEADER]: crypto.randomUUID() },
    body: JSON.stringify({ mutations }),
  });
  expect(response.status).toBe(204);
};

/** A page holding one ink block, its id and the page's. */
const inkPage = async () => {
  const notebookId = crypto.randomUUID();
  const pageId = crypto.randomUUID();
  const blockId = crypto.randomUUID();
  await pushed([
    { type: "notebook.put", row: { id: notebookId, title: "Algebra", position: 0 } },
    { type: "page.put", row: { id: pageId, notebookId, title: "Squares", position: 0 } },
    { type: "block.put", pageId, row: { id: blockId, order: "a0", node: ink() } },
  ]);
  return { pageId, blockId };
};

const draw = (pageId: string, blockId: string): MutationJson => ({
  type: "stroke.add",
  pageId,
  blockId,
  stroke: stroke(),
});

/** Runs every job due once the burst of writing is over. */
const settle = () => drainJobs(context.sql, work.jobs, new Date(NOW.getTime() + READ_AFTER_MS));

const getPage = async (pageId: string) => {
  const client = await connectMcp(request, "/notes/mcp", me);
  const result = await client.callTool({ name: "get_page", arguments: { pageId } });
  const [page, ...rest] = result.content as (
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  )[];
  return {
    markdown: (JSON.parse(page?.type === "text" ? page.text : "{}") as { markdown: string }).markdown,
    rest,
  };
};

const upload = (pageId: string, blockId: string, seq: number, body: Uint8Array<ArrayBuffer>) =>
  request(`/notes/api/pages/${pageId}/blocks/${blockId}/image?seq=${seq}`, {
    as: me,
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body,
  });

describe("reading handwriting", () => {
  test("reads a burst of strokes once, after it is over", async () => {
    const { pageId, blockId } = await inkPage();
    const before = requests.length;

    await pushed([draw(pageId, blockId), draw(pageId, blockId)]);
    await pushed([draw(pageId, blockId)]);
    expect(await settle()).toMatchObject({ completed: 1 });

    expect(requests.length - before).toBe(1);
    expect(requests.at(-1)).toHaveLength(3);
    expect((await getPage(pageId)).markdown).toBe(`<!-- handwriting ${blockId}, read by Mathpix -->\n$$\nx^{2}\n$$`);
  });

  test("keeps an old reading, marked, until the new strokes are read", async () => {
    const { pageId, blockId } = await inkPage();
    await pushed([draw(pageId, blockId)]);
    await settle();

    await pushed([draw(pageId, blockId)]);

    expect((await getPage(pageId)).markdown).toContain("read by Mathpix, and changed since");
    await settle();
    expect((await getPage(pageId)).markdown).not.toContain("changed since");
  });

  test("says when handwriting has not been read", async () => {
    const { pageId, blockId } = await inkPage();

    expect((await getPage(pageId)).markdown).toBe(`<!-- handwriting ${blockId}, not read -->`);
  });
});

describe("images of handwriting", () => {
  test("serves a device's rendering to Claude alongside the page", async () => {
    const { pageId, blockId } = await inkPage();
    await pushed([draw(pageId, blockId)]);

    expect((await upload(pageId, blockId, 2, PIXEL_PNG)).status).toBe(204);

    expect((await getPage(pageId)).rest).toEqual([
      { type: "text", text: `Handwriting ${blockId}:` },
      { type: "image", data: Buffer.from(PIXEL_PNG).toString("base64"), mimeType: "image/png" },
    ]);
  });

  test("marks a rendering older than the strokes", async () => {
    const { pageId, blockId } = await inkPage();
    await pushed([draw(pageId, blockId)]);
    await upload(pageId, blockId, 2, PIXEL_PNG);

    await pushed([draw(pageId, blockId)]);

    expect((await getPage(pageId)).rest[0]).toEqual({
      type: "text",
      text: `Handwriting ${blockId} (changed since it was drawn here):`,
    });
  });

  test("refuses anything but a PNG of handwriting on the page", async () => {
    const { pageId, blockId } = await inkPage();
    const prose = crypto.randomUUID();
    await pushed([{ type: "block.put", pageId, row: { id: prose, order: "a1", node: paragraph("words") } }]);

    expect((await upload(pageId, blockId, 1, new TextEncoder().encode("<svg/>"))).status).toBe(400);
    expect((await upload(pageId, prose, 1, PIXEL_PNG)).status).toBe(409);
    expect((await upload(pageId, blockId, 99, PIXEL_PNG)).status).toBe(400);
  });
});

test("sends Mathpix each stroke's points, rounded, and reads its answer", async () => {
  const sent: { url: string; init: RequestInit }[] = [];
  const send = (async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return Response.json({ latex_styled: "3 x^{2}", text: "\\( 3 x^{2} \\)", confidence: 0.98 });
  }) as unknown as typeof fetch;
  const mathpix = createMathpixReader({ appId: "app", appKey: "key" }, send);
  const drawn = stroke({
    points: [
      { x: 10.4, y: 20.6, t: 0, pressure: 0.5, azimuth: 0, altitude: 1 },
      { x: 11, y: 21, t: 5, pressure: 0.5, azimuth: 0, altitude: 1 },
    ],
  });

  expect(await mathpix.read([drawn], new AbortController().signal)).toEqual({
    latex: "3 x^{2}",
    text: "\\( 3 x^{2} \\)",
    confidence: 0.98,
  });
  expect(sent[0]?.url).toBe("https://api.mathpix.com/v3/strokes");
  expect(sent[0]?.init.headers).toMatchObject({ app_id: "app", app_key: "key" });
  expect(JSON.parse(String(sent[0]?.init.body))).toEqual({ strokes: { strokes: { x: [[10, 11]], y: [[21, 21]] } } });
});
