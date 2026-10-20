import { type AppMcp, HttpError, type McpServer, toolResult } from "@apps/core";
import { z } from "zod";
import { appendTo, BlockInput } from "../blocks";
import { Notebook, PageMeta } from "../contract";
import { pageToMarkdown } from "../markdown";
import type { NotesService, PageContent } from "./service";

const INSTRUCTIONS = `The connected person's own maths notes: notebooks of pages.

- A page mixes prose, typed LaTeX, TypeScript or JavaScript snippets and blocks of handwriting drawn with a pen.
- get_page reads a page as Markdown: LaTeX in $…$ and $$…$$, snippets as fenced code, and each handwriting block as
  an HTML comment naming it.
- append_to_page adds blocks to the end of a page, where the person sees them as soon as their device syncs. In a
  paragraph or heading, $…$ is inline LaTeX.
- Ids are UUIDs; find notebooks and their pages with list_notebooks.`;

const NotebookId = z.uuid().describe("The notebook's id, from list_notebooks");
const PageId = z.uuid().describe("The page's id, from list_notebooks");
const Blocks = z.array(BlockInput).min(1).max(200).describe("Blocks in order");

const inkPlaceholder = (blockId: string) => `<!-- handwriting ${blockId} -->`;

const notFound = (): never => {
  throw new HttpError(404, "Not found");
};

const nextPosition = (rows: readonly { readonly position: number }[]) =>
  rows.reduce((highest, row) => Math.max(highest, row.position + 1), 0);

export const createNotesMcp = (service: NotesService): AppMcp => ({
  instructions: INSTRUCTIONS,
  registerTools: (server: McpServer, { login: owner }) => {
    const read = { readOnlyHint: true, openWorldHint: false } as const;
    const change = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
    const destroy = { ...change, destructiveHint: true } as const;

    const notebooksWithPages = async () => {
      const [notebooks, pages] = await Promise.all([service.notebooks(owner), service.pages(owner)]);
      return notebooks.map((notebook) => ({
        ...notebook,
        pages: pages
          .filter((page) => page.notebookId === notebook.id)
          .map(({ id, title, updatedAt }) => ({ id, title, updatedAt })),
      }));
    };

    const markdownOf = ({ page, blocks }: PageContent) => ({
      id: page.id,
      notebookId: page.notebookId,
      title: page.title,
      updatedAt: page.updatedAt,
      markdown: pageToMarkdown(blocks, inkPlaceholder),
    });

    const markdownNow = async (pageId: string) => markdownOf(await service.content(owner, pageId));

    const append = async (pageId: string, blocks: readonly BlockInput[]) => {
      const { blocks: current } = await service.content(owner, pageId);
      await service.apply(owner, appendTo(pageId, current.at(-1)?.order ?? null, blocks));
    };

    const pageMeta = async (pageId: string): Promise<PageMeta> => {
      const { id, notebookId, title, position } =
        (await service.pages(owner)).find((page) => page.id === pageId) ?? notFound();
      return { id, notebookId, title, position };
    };

    server.registerTool(
      "list_notebooks",
      { description: "Reads every notebook with the titles of its pages, in order.", annotations: read },
      () => toolResult(notebooksWithPages),
    );
    server.registerTool(
      "get_page",
      { description: "Reads one page as Markdown.", inputSchema: { pageId: PageId }, annotations: read },
      ({ pageId }) => toolResult(() => markdownNow(pageId)),
    );
    server.registerTool(
      "create_notebook",
      {
        description: "Adds a notebook after the others.",
        inputSchema: { title: Notebook.shape.title },
        annotations: change,
      },
      ({ title }) =>
        toolResult(async () => {
          const position = nextPosition(await service.notebooks(owner));
          await service.apply(owner, [{ type: "notebook.put", row: { id: crypto.randomUUID(), title, position } }]);
          return notebooksWithPages();
        }),
    );
    server.registerTool(
      "create_page",
      {
        description: "Adds a page at the end of a notebook, optionally with content.",
        inputSchema: { notebookId: NotebookId, title: PageMeta.shape.title, blocks: Blocks.optional() },
        annotations: change,
      },
      ({ notebookId, title, blocks }) =>
        toolResult(async () => {
          const id = crypto.randomUUID();
          const siblings = (await service.pages(owner)).filter((page) => page.notebookId === notebookId);
          await service.apply(owner, [
            { type: "page.put", row: { id, notebookId, title, position: nextPosition(siblings) } },
          ]);
          if (blocks !== undefined) {
            await append(id, blocks);
          }
          return markdownNow(id);
        }),
    );
    server.registerTool(
      "append_to_page",
      {
        description: "Adds blocks to the end of a page, and answers with the page as it now is.",
        inputSchema: { pageId: PageId, blocks: Blocks },
        annotations: change,
      },
      ({ pageId, blocks }) =>
        toolResult(async () => {
          await append(pageId, blocks);
          return markdownNow(pageId);
        }),
    );
    server.registerTool(
      "update_page",
      {
        description: "Renames a page or moves it to another notebook. Only the fields given change.",
        inputSchema: { pageId: PageId, title: PageMeta.shape.title.optional(), notebookId: NotebookId.optional() },
        annotations: { ...change, idempotentHint: true },
      },
      ({ pageId, title, notebookId }) =>
        toolResult(async () => {
          const page = await pageMeta(pageId);
          await service.apply(owner, [
            {
              type: "page.put",
              row: { ...page, title: title ?? page.title, notebookId: notebookId ?? page.notebookId },
            },
          ]);
          return notebooksWithPages();
        }),
    );
    server.registerTool(
      "delete_page",
      {
        description: "Deletes a page with all its content and handwriting. Cannot be undone.",
        inputSchema: { pageId: PageId },
        annotations: destroy,
      },
      ({ pageId }) =>
        toolResult(async () => {
          await pageMeta(pageId);
          await service.apply(owner, [{ type: "page.delete", id: pageId }]);
          return notebooksWithPages();
        }),
    );
  },
});
