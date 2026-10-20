import { describe, expect, test } from "bun:test";
import { startTestServer, uniqueLogin } from "@apps/core/testing";
import { eq } from "drizzle-orm";
import { createNotesTestContext, ink, NOW, paragraph, stroke } from "../../test/support";
import {
  IDEMPOTENCY_HEADER,
  type MutationJson,
  type Notebook,
  NotebookList,
  PageChanges,
  type PageMeta,
  PageSummaryList,
} from "../contract";
import { createNotesApp } from "../module";
import { notesDb } from "./db";
import { strokes } from "./schema";

const context = createNotesTestContext();
const request = startTestServer((ctx) => [createNotesApp(ctx, { now: () => NOW })], context);
const me = uniqueLogin();

const push = (mutations: readonly MutationJson[], { as = me, key = crypto.randomUUID() } = {}) =>
  request("/notes/api/push", {
    as,
    method: "POST",
    headers: { "Content-Type": "application/json", [IDEMPOTENCY_HEADER]: key },
    body: JSON.stringify({ mutations }),
  });

const pushed = async (mutations: readonly MutationJson[], as = me) => {
  const response = await push(mutations, { as });
  expect(response.status).toBe(204);
};

const errorOf = async (response: Response, status: number) => {
  expect(response.status).toBe(status);
  return ((await response.json()) as { error: string }).error;
};

const notebook = (fields: Partial<Notebook> = {}): Notebook => ({
  id: crypto.randomUUID(),
  title: "Analysis",
  position: 0,
  ...fields,
});
const pageMeta = (notebookId: string, fields: Partial<PageMeta> = {}): PageMeta => ({
  id: crypto.randomUUID(),
  notebookId,
  title: "Week 1",
  position: 0,
  ...fields,
});

/** A notebook holding one empty page, pushed. */
const blankPage = async (as = me) => {
  const book = notebook();
  const page = pageMeta(book.id);
  await pushed(
    [
      { type: "notebook.put", row: book },
      { type: "page.put", row: page },
    ],
    as,
  );
  return { book, page };
};

const changes = async (pageId: string, since = 0) => {
  const response = await request(`/notes/api/pages/${pageId}/changes?since=${since}`, { as: me });
  expect(response.status).toBe(200);
  return PageChanges.parse(await response.json());
};

const putBlock = (pageId: string, id: string, order: string, node: unknown): MutationJson => ({
  type: "block.put",
  pageId,
  row: { id, order, node },
});

describe("notes api", () => {
  test("requires a Tailscale identity", async () => {
    expect((await request("/notes/api/notebooks")).status).toBe(401);
    expect((await request("/notes/api/push", { method: "POST" })).status).toBe(401);
  });

  test("creates notebooks and empty pages, for the person who pushed them only", async () => {
    const { book, page } = await blankPage();

    expect(NotebookList.parse(await (await request("/notes/api/notebooks", { as: me })).json())).toEqual([book]);
    expect(PageSummaryList.parse(await (await request("/notes/api/pages", { as: me })).json())).toEqual([
      { ...page, seq: 0, updatedAt: expect.any(String) },
    ]);
    expect(await changes(page.id)).toEqual({ seq: 0, blocks: [], strokes: [] });
    expect((await request(`/notes/api/pages/${page.id}/changes`, { as: uniqueLogin() })).status).toBe(404);
  });

  test("applies a push once however often it is sent", async () => {
    const book = notebook();
    const key = crypto.randomUUID();
    await push([{ type: "notebook.put", row: book }], { key });

    await push([{ type: "notebook.put", row: { ...book, title: "Renamed" } }], { key });

    expect(NotebookList.parse(await (await request("/notes/api/notebooks", { as: me })).json())).toEqual([book]);
  });

  test("refuses a page in someone else's notebook", async () => {
    const { book } = await blankPage(uniqueLogin());

    expect(await errorOf(await push([{ type: "page.put", row: pageMeta(book.id) }]), 409)).toBe(
      "That notebook no longer exists",
    );
  });

  describe("blocks", () => {
    test("saves only the blocks that changed, and serves a device what it missed", async () => {
      const { page } = await blankPage();
      const [first, second] = [crypto.randomUUID(), crypto.randomUUID()];
      await pushed([
        putBlock(page.id, first, "a0", paragraph("Let x be real.")),
        putBlock(page.id, second, "a1", ink()),
      ]);

      await pushed([putBlock(page.id, first, "a0", paragraph("Let x be positive."))]);

      expect(await changes(page.id, 2)).toEqual({
        seq: 3,
        blocks: [{ kind: "block", id: first, order: "a0", node: paragraph("Let x be positive.") }],
        strokes: [],
      });
      expect((await changes(page.id)).blocks.map((block) => block.id)).toEqual([first, second]);
    });

    test("reads blocks in the order of their keys, whatever order they were written in", async () => {
      const { page } = await blankPage();
      const [first, second, third] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
      await pushed([
        putBlock(page.id, third, "a2", paragraph("third")),
        putBlock(page.id, first, "a0", paragraph("first")),
        putBlock(page.id, second, "a0V", paragraph("second")),
      ]);

      expect((await changes(page.id)).blocks.map((block) => block.id)).toEqual([first, second, third]);
    });

    test("tells a device that had a block it went, and one that never had it nothing", async () => {
      const { page } = await blankPage();
      const id = crypto.randomUUID();
      await pushed([putBlock(page.id, id, "a0", paragraph("gone soon"))]);

      await pushed([{ type: "block.delete", pageId: page.id, id }]);
      await pushed([{ type: "block.delete", pageId: page.id, id }]);

      expect(await changes(page.id, 1)).toEqual({ seq: 2, blocks: [{ kind: "deleted", id }], strokes: [] });
      expect(await changes(page.id)).toEqual({ seq: 2, blocks: [], strokes: [] });
    });

    test("refuses a block the schema does not allow, writing nothing from the push", async () => {
      const { page } = await blankPage();

      const reason = await errorOf(
        await push([
          putBlock(page.id, crypto.randomUUID(), "a0", paragraph("fine")),
          putBlock(page.id, crypto.randomUUID(), "a1", { type: "code_block", attrs: { language: "py" } }),
        ]),
        400,
      );

      expect(reason).toContain("language must be one of ts, js");
      expect(await changes(page.id)).toEqual({ seq: 0, blocks: [], strokes: [] });
    });

    test("keeps blocks off someone else's page", async () => {
      const { page } = await blankPage(uniqueLogin());

      expect(
        await errorOf(await push([putBlock(page.id, crypto.randomUUID(), "a0", paragraph("mine now"))]), 409),
      ).toBe("That page no longer exists");
    });
  });

  describe("strokes", () => {
    test("saves each stroke once, and serves erasures to a device that had them", async () => {
      const { page } = await blankPage();
      const blockId = crypto.randomUUID();
      const [a, b] = [stroke(), stroke()];
      await pushed([
        putBlock(page.id, blockId, "a0", ink()),
        { type: "stroke.add", pageId: page.id, blockId, stroke: a },
        { type: "stroke.add", pageId: page.id, blockId, stroke: b },
      ]);

      await pushed([
        { type: "stroke.add", pageId: page.id, blockId, stroke: a },
        { type: "stroke.erase", pageId: page.id, blockId, strokeIds: [a.id] },
      ]);

      expect(await changes(page.id, 3)).toEqual({
        seq: 4,
        blocks: [],
        strokes: [{ kind: "erased", blockId, id: a.id }],
      });
      expect((await changes(page.id)).strokes).toEqual([{ kind: "stroke", blockId, stroke: b }]);
    });

    test("only draws on handwriting still on the page", async () => {
      const { page } = await blankPage();
      const prose = crypto.randomUUID();
      await pushed([putBlock(page.id, prose, "a0", paragraph("not ink"))]);

      expect(
        await errorOf(await push([{ type: "stroke.add", pageId: page.id, blockId: prose, stroke: stroke() }]), 409),
      ).toBe("That handwriting is no longer on the page");
    });

    test("goes with its page", async () => {
      const { page } = await blankPage();
      const blockId = crypto.randomUUID();
      await pushed([
        putBlock(page.id, blockId, "a0", ink()),
        { type: "stroke.add", pageId: page.id, blockId, stroke: stroke() },
      ]);

      await pushed([{ type: "page.delete", id: page.id }]);

      expect((await request(`/notes/api/pages/${page.id}/changes`, { as: me })).status).toBe(404);
      expect(await notesDb(context.sql).select().from(strokes).where(eq(strokes.pageId, page.id))).toEqual([]);
    });
  });

  test("refuses a device claiming changes the page never had", async () => {
    const { page } = await blankPage();

    expect(await errorOf(await request(`/notes/api/pages/${page.id}/changes?since=5`, { as: me }), 400)).toBe(
      "The page has only had 0 changes",
    );
  });
});
