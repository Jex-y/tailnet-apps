import { describe, expect, test } from "bun:test";
import { callTool, connectMcp, startTestServer, uniqueLogin } from "@apps/core/testing";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createNotesTestContext, NOW } from "../../test/support";
import { PageChanges } from "../contract";
import { createNotesApp } from "../module";

const context = createNotesTestContext();
const request = startTestServer((ctx) => [createNotesApp(ctx, { reader: null, now: () => NOW })], context);
const me = uniqueLogin();

type NotebookWithPages = {
  id: string;
  title: string;
  position: number;
  pages: { id: string; title: string; updatedAt: string }[];
};
type PageMarkdown = { id: string; title: string; markdown: string };

const call = async <T = object>(client: Client, name: string, args: Record<string, unknown> = {}) => {
  const result = await callTool(client, name, args);
  expect(result.isError).toBe(false);
  return JSON.parse(result.text) as T;
};

const notebookIn = async (client: Client, title = "Linear algebra") => {
  const created = (await call<NotebookWithPages[]>(client, "create_notebook", { title })).find(
    (notebook) => notebook.title === title,
  );
  if (created === undefined) {
    throw new Error("No notebook was created");
  }
  return created.id;
};

describe("notes mcp", () => {
  test("writes a page that reads back as Markdown", async () => {
    const client = await connectMcp(request, "/notes/mcp", me);
    const notebookId = await notebookIn(client);

    const page = await call<PageMarkdown>(client, "create_page", {
      notebookId,
      title: "Eigenvalues",
      blocks: [
        { type: "paragraph", text: "For $A$ symmetric:" },
        { type: "math", latex: "A = Q \\Lambda Q^T" },
      ],
    });

    expect(page.markdown).toBe("For $A$ symmetric:\n\n$$\nA = Q \\Lambda Q^T\n$$");
    expect(await call<NotebookWithPages[]>(client, "list_notebooks")).toEqual([
      {
        id: notebookId,
        title: "Linear algebra",
        position: 0,
        pages: [{ id: page.id, title: "Eigenvalues", updatedAt: expect.any(String) }],
      },
    ]);
  });

  test("appends what a device pulls as a change", async () => {
    const client = await connectMcp(request, "/notes/mcp", me);
    const notebookId = await notebookIn(client);
    const page = await call<PageMarkdown>(client, "create_page", { notebookId, title: "Scratch" });

    const after = await call<PageMarkdown>(client, "append_to_page", {
      pageId: page.id,
      blocks: [{ type: "code", language: "js", source: "1 + 1" }],
    });

    expect(after.markdown).toBe("```js\n1 + 1\n```");
    const changes = PageChanges.parse(
      await (await request(`/notes/api/pages/${page.id}/changes?since=0`, { as: me })).json(),
    );
    expect(changes.seq).toBe(1);
  });

  test("appends after what is already on the page", async () => {
    const client = await connectMcp(request, "/notes/mcp", me);
    const notebookId = await notebookIn(client);
    const page = await call<PageMarkdown>(client, "create_page", {
      notebookId,
      title: "Scratch",
      blocks: [{ type: "paragraph", text: "one" }],
    });

    const after = await call<PageMarkdown>(client, "append_to_page", {
      pageId: page.id,
      blocks: [
        { type: "paragraph", text: "two" },
        { type: "paragraph", text: "three" },
      ],
    });

    expect(after.markdown).toBe("one\n\ntwo\n\nthree");
  });

  test("moves, renames and deletes pages", async () => {
    const client = await connectMcp(request, "/notes/mcp", me);
    const from = await notebookIn(client, "Drafts");
    const to = await notebookIn(client, "Final");
    const page = await call<PageMarkdown>(client, "create_page", { notebookId: from, title: "Proof" });

    const moved = await call<NotebookWithPages[]>(client, "update_page", {
      pageId: page.id,
      notebookId: to,
      title: "Proof of 2.1",
    });
    expect(moved.map((book) => book.pages.map((p) => p.title))).toEqual([[], ["Proof of 2.1"]]);

    const deleted = await call<NotebookWithPages[]>(client, "delete_page", { pageId: page.id });
    expect(deleted.flatMap((book) => book.pages)).toEqual([]);
  });

  test("cannot reach someone else's pages", async () => {
    const theirs = await connectMcp(request, "/notes/mcp", uniqueLogin());
    const page = await call<PageMarkdown>(theirs, "create_page", {
      notebookId: await notebookIn(theirs),
      title: "Private",
    });
    const mine = await connectMcp(request, "/notes/mcp", me);

    expect((await callTool(mine, "get_page", { pageId: page.id })).isError).toBe(true);
    expect(
      (await callTool(mine, "append_to_page", { pageId: page.id, blocks: [{ type: "paragraph", text: "hi" }] }))
        .isError,
    ).toBe(true);
  });
});
