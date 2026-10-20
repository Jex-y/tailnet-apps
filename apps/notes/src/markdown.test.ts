import { expect, test } from "bun:test";
import { nodeOf } from "./blocks";
import { pageSchema } from "./document";
import { pageToMarkdown } from "./markdown";

const { node, text } = { node: pageSchema.node.bind(pageSchema), text: pageSchema.text.bind(pageSchema) };

test("writes each kind of block as Markdown, with ink as the caller describes it", () => {
  const inkId = crypto.randomUUID();
  const nodes = [
    nodeOf({ type: "heading", level: 2, text: "Limits" }),
    nodeOf({ type: "paragraph", text: "As $n \\to \\infty$, the sum converges." }),
    node("bullet_list", null, [
      node("list_item", null, [node("paragraph", null, [text("bold", [pageSchema.mark("strong")]), text(" first")])]),
      node("list_item", null, [node("paragraph", null, [text("second")])]),
    ]),
    nodeOf({ type: "math", latex: "\\sum_{k=1}^n k = \\frac{n(n+1)}{2}" }),
    nodeOf({ type: "code", language: "ts", source: "const sum = (n: number) => (n * (n + 1)) / 2;" }),
    node("ink", { height: 300 }),
  ];
  const blocks = nodes.map((block, index) => ({
    id: index === nodes.length - 1 ? inkId : crypto.randomUUID(),
    node: block,
  }));

  expect(pageToMarkdown(blocks, (id) => `[ink ${id}]`)).toBe(
    [
      "## Limits",
      "As $n \\to \\infty$, the sum converges.",
      "- **bold** first\n- second",
      "$$\n\\sum_{k=1}^n k = \\frac{n(n+1)}{2}\n$$",
      "```ts\nconst sum = (n: number) => (n * (n + 1)) / 2;\n```",
      `[ink ${inkId}]`,
    ].join("\n\n"),
  );
});
