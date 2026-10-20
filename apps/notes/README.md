# Notes

Maths notes in notebooks of pages, each tailnet login keeping its own. A page mixes prose, typed LaTeX, TypeScript
and JavaScript snippets, and blocks of handwriting drawn with a pen. Claude reads and adds to them over MCP.

## What is stored, and where

Everything is plain JSON in documented shapes (`src/contract.ts`, `src/document.ts`), readable without this app.

- **Notebooks and pages** (title, notebook, order) are whole rows.
- **A page's content** is an ordered set of blocks, each one top-level [ProseMirror](https://prosemirror.net) node in
  the schema in `src/document.ts`: a paragraph, heading, list, quote, displayed maths, a snippet or handwriting. Each
  has an id made on the device and a [fractional index](https://github.com/rocicorp/fractional-indexing) key that
  orders it, so moving a block rewrites only that block. Pages concatenate their blocks to a ProseMirror document.
- **Handwriting** is an `ink` block, which can only sit at the top of a page. Its strokes are rows of their own under
  the block's id, each a list of pen samples (position, time, pressure, tilt) in the block's coordinates, where every
  ink block is 1,000 units wide. A stroke never changes; erasing part of one erases it and draws what is left anew.

## Syncing

Every change to a page's content — a block written or deleted, a stroke drawn or erased — takes the page's next
change number and stamps the rows it wrote. Deleted blocks and erased strokes keep their rows, empty. A device keeps
one number per page and asks for everything changed after it, getting each changed row as it now is.

A device queues its changes and sends them in batches, each under an idempotency key the server remembers for thirty
days, so a batch sent twice lands once. Two devices changing the same block leave whichever change arrived last.

| Route                                               | Does                                                          |
| --------------------------------------------------- | ------------------------------------------------------------- |
| `GET /notes/api/notebooks`, `/pages`                | The notebooks, and every page's metadata and change number    |
| `POST /notes/api/push`                              | A batch of changes in order, all or nothing, `Idempotency-Key` |
| `GET /notes/api/pages/:id/changes?since=`           | Blocks and strokes changed after `since`, and the new number  |

## Read and write notes from Claude

The notes tools (list notebooks, read a page as Markdown, create pages and append prose, LaTeX and snippets to them,
move and delete pages) are on the stack's MCP server with every other app's, or alone at
`https://apps.<tailnet>.ts.net/notes/mcp`. What Claude adds is a change like any device's, so a device sees it at its
next sync.
