import { describe, expect, test } from "bun:test";
import { parseBlockNode } from "./document";

describe("parseBlockNode", () => {
  test.each([
    [
      "prose with inline maths",
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Let " },
          { type: "math_inline", content: [{ type: "text", text: "x" }] },
        ],
      },
    ],
    ["displayed maths", { type: "math_block", content: [{ type: "text", text: "\\int_0^1 x\\,dx" }] }],
    ["a snippet", { type: "code_block", attrs: { language: "ts" }, content: [{ type: "text", text: "const x = 1;" }] }],
    ["handwriting", { type: "ink", attrs: { height: 300 } }],
  ])("reads %s exactly", (_, json) => {
    const parsed = parseBlockNode(json);

    expect(parsed.ok && parsed.value.toJSON()).toEqual(json);
  });

  test.each([
    ["handwriting of no height", { type: "ink", attrs: { height: 0 } }, "height must be a positive number"],
    [
      "a snippet in another language",
      { type: "code_block", attrs: { language: "py" } },
      "language must be one of ts, js",
    ],
    ["a heading below level 3", { type: "heading", attrs: { level: 4 } }, "level must be one of 1, 2, 3"],
    [
      "a mark inside maths",
      { type: "math_block", content: [{ type: "text", text: "x", marks: [{ type: "strong" }] }] },
      "",
    ],
    ["text on its own", { type: "text", text: "loose" }, "A text is not a block"],
    ["a whole document", { type: "doc", content: [{ type: "paragraph" }] }, "A doc is not a block"],
    [
      "handwriting inside a list",
      {
        type: "bullet_list",
        content: [{ type: "list_item", content: [{ type: "paragraph" }, { type: "ink", attrs: { height: 10 } }] }],
      },
      "",
    ],
  ])("refuses %s", (_, json, reason) => {
    expect(parseBlockNode(json)).toEqual({ ok: false, reason: expect.stringContaining(reason) });
  });
});
