import type { Mark, Node } from "prosemirror-model";

/** What a reader of the Markdown is told in place of an ink block's strokes. */
export type InkText = (blockId: string) => string;

const wrap = (text: string, mark: Mark): string => {
  switch (mark.type.name) {
    case "strong":
      return `**${text}**`;
    case "em":
      return `*${text}*`;
    case "code":
      return `\`${text}\``;
    case "link":
      return `[${text}](${mark.attrs.href})`;
    default:
      return text;
  }
};

const inline = (node: Node): string => {
  const parts: string[] = [];
  node.forEach((child) => {
    switch (child.type.name) {
      case "text":
        parts.push(child.marks.reduce((text, mark) => wrap(text, mark), child.text ?? ""));
        break;
      case "math_inline":
        parts.push(`$${child.textContent}$`);
        break;
      case "hard_break":
        parts.push("  \n");
        break;
    }
  });
  return parts.join("");
};

const indent = (text: string, prefix: string, rest = " ".repeat(prefix.length)): string =>
  text
    .split("\n")
    .map((line, index) => (index === 0 ? prefix : line === "" ? "" : rest) + line)
    .join("\n");

const children = (node: Node, ink: InkText): string => {
  const out: string[] = [];
  node.forEach((child) => {
    out.push(block(child, ink, ""));
  });
  return out.join("\n\n");
};

const block = (node: Node, ink: InkText, id: string): string => {
  switch (node.type.name) {
    case "paragraph":
      return inline(node);
    case "heading":
      return `${"#".repeat(node.attrs.level)} ${inline(node)}`;
    case "blockquote":
      return indent(children(node, ink), "> ", "> ");
    case "bullet_list": {
      const items: string[] = [];
      node.forEach((item) => {
        items.push(indent(children(item, ink), "- "));
      });
      return items.join("\n");
    }
    case "ordered_list": {
      const items: string[] = [];
      node.forEach((item, _, index) => {
        items.push(indent(children(item, ink), `${node.attrs.order + index}. `));
      });
      return items.join("\n");
    }
    case "horizontal_rule":
      return "---";
    case "math_block":
      return `$$\n${node.textContent}\n$$`;
    case "code_block":
      return `\`\`\`${node.attrs.language}\n${node.textContent}\n\`\`\``;
    case "ink":
      return ink(id);
    default:
      return node.textContent;
  }
};

/** A page's blocks as Markdown, with LaTeX in `$`/`$$` and each ink block as whatever `ink` says of it. */
export const pageToMarkdown = (blocks: readonly { readonly id: string; readonly node: Node }[], ink: InkText): string =>
  blocks.map(({ id, node }) => block(node, ink, id)).join("\n\n");
