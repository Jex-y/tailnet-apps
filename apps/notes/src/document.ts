import { type DOMOutputSpec, type Node, Schema } from "prosemirror-model";

export const CODE_LANGUAGES = ["ts", "js"] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];

/** Attribute validators, named so a refusal says which attribute was wrong. */
const oneOf =
  (name: string, allowed: readonly unknown[]) =>
  (value: unknown): void => {
    if (!allowed.includes(value)) {
      throw new RangeError(`${name} must be one of ${allowed.join(", ")}`);
    }
  };

const positive =
  (name: string) =>
  (value: unknown): void => {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new RangeError(`${name} must be a positive number`);
    }
  };

const block = (tag: string): DOMOutputSpec => [tag, 0];

/**
 * What a page's blocks may hold. The server parses every block written against this schema, so any reader of the
 * stored JSON can rely on it. Ink is a block atom whose strokes are kept apart under its id.
 */
export const pageSchema = new Schema({
  nodes: {
    /** A page: blocks, and ink, which can only sit at the top where it has a block id to keep its strokes under. */
    doc: { content: "top+" },
    paragraph: { content: "inline*", group: "block top", parseDOM: [{ tag: "p" }], toDOM: () => block("p") },
    heading: {
      attrs: { level: { default: 1, validate: oneOf("level", [1, 2, 3]) } },
      content: "inline*",
      group: "block top",
      defining: true,
      parseDOM: [1, 2, 3].map((level) => ({ tag: `h${level}`, attrs: { level } })),
      toDOM: (node) => block(`h${node.attrs.level}`),
    },
    blockquote: {
      content: "block+",
      group: "block top",
      defining: true,
      parseDOM: [{ tag: "blockquote" }],
      toDOM: () => block("blockquote"),
    },
    bullet_list: {
      content: "list_item+",
      group: "block top",
      parseDOM: [{ tag: "ul" }],
      toDOM: () => block("ul"),
    },
    ordered_list: {
      attrs: { order: { default: 1, validate: "number" } },
      content: "list_item+",
      group: "block top",
      parseDOM: [{ tag: "ol", getAttrs: (dom) => ({ order: Number(dom.getAttribute("start") ?? 1) }) }],
      toDOM: (node) => ["ol", { start: node.attrs.order }, 0],
    },
    list_item: {
      content: "paragraph block*",
      defining: true,
      parseDOM: [{ tag: "li" }],
      toDOM: () => block("li"),
    },
    horizontal_rule: { group: "block top", parseDOM: [{ tag: "hr" }], toDOM: () => ["hr"] },
    /** Typed LaTeX, displayed. */
    math_block: {
      content: "text*",
      group: "block top",
      code: true,
      marks: "",
      parseDOM: [{ tag: "div.math", preserveWhitespace: "full" }],
      toDOM: () => ["div", { class: "math" }, 0],
    },
    code_block: {
      attrs: { language: { default: "ts", validate: oneOf("language", CODE_LANGUAGES) } },
      content: "text*",
      group: "block top",
      code: true,
      marks: "",
      defining: true,
      parseDOM: [
        {
          tag: "pre",
          preserveWhitespace: "full",
          getAttrs: (dom) => ({ language: dom.getAttribute("data-language") ?? "ts" }),
        },
      ],
      toDOM: (node) => ["pre", { "data-language": node.attrs.language }, ["code", 0]],
    },
    /**
     * Handwriting, whose strokes are kept under the block's id. `height` is in the strokes' units, where every ink
     * block is {@link INK_WIDTH} wide.
     */
    ink: {
      attrs: { height: { default: 400, validate: positive("height") } },
      group: "top",
      atom: true,
      selectable: true,
      parseDOM: [{ tag: "div[data-ink]", getAttrs: (dom) => ({ height: Number(dom.getAttribute("data-height")) }) }],
      toDOM: (node) => ["div", { "data-ink": "", "data-height": node.attrs.height }],
    },
    text: { group: "inline" },
    /** Typed LaTeX, inline. */
    math_inline: {
      content: "text*",
      group: "inline",
      inline: true,
      atom: true,
      marks: "",
      parseDOM: [{ tag: "span.math" }],
      toDOM: () => ["span", { class: "math" }, 0],
    },
    hard_break: { group: "inline", inline: true, selectable: false, parseDOM: [{ tag: "br" }], toDOM: () => ["br"] },
  },
  marks: {
    strong: { parseDOM: [{ tag: "strong" }, { tag: "b" }], toDOM: () => ["strong", 0] },
    em: { parseDOM: [{ tag: "em" }, { tag: "i" }], toDOM: () => ["em", 0] },
    code: { excludes: "_", parseDOM: [{ tag: "code" }], toDOM: () => ["code", 0] },
    link: {
      attrs: { href: { validate: "string" } },
      inclusive: false,
      parseDOM: [{ tag: "a[href]", getAttrs: (dom) => ({ href: dom.getAttribute("href") }) }],
      toDOM: (mark) => ["a", { href: mark.attrs.href, rel: "noopener" }, 0],
    },
  },
});

/** The width of every ink block in stroke coordinates, whatever its width on screen. */
export const INK_WIDTH = 1000;

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

/** One top-level block, checked against {@link pageSchema} down to every attribute. */
export const parseBlockNode = (json: unknown): Parsed<Node> => {
  try {
    const node = pageSchema.nodeFromJSON(json);
    if (!node.type.isInGroup("top")) {
      return { ok: false, reason: `A ${node.type.name} is not a block` };
    }
    node.check();
    return { ok: true, value: node };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
};
