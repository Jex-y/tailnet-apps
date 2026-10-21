import { generateKeyBetween } from "fractional-indexing";
import type { Node } from "prosemirror-model";
import { z } from "zod";
import type { Mutation } from "./contract";
import { CODE_LANGUAGES, pageSchema } from "./document";

/** Content written by something other than the editor, such as Claude: plain text where `$…$` is inline LaTeX. */
export const BlockInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("paragraph"), text: z.string().max(20_000) }),
  z.object({
    type: z.literal("heading"),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    text: z.string().max(500),
  }),
  z.object({ type: z.literal("math"), latex: z.string().min(1).max(20_000) }),
  z.object({ type: z.literal("code"), language: z.enum(CODE_LANGUAGES), source: z.string().max(100_000) }),
]);
export type BlockInput = z.infer<typeof BlockInput>;

const text = (value: string): Node[] => (value === "" ? [] : [pageSchema.text(value)]);

const prose = (value: string): Node[] =>
  value
    .split(/\$([^$\n]+)\$/)
    .flatMap((part, index) => (index % 2 === 1 ? [pageSchema.node("math_inline", null, text(part))] : text(part)));

export const nodeOf = (input: BlockInput): Node => {
  switch (input.type) {
    case "paragraph":
      return pageSchema.node("paragraph", null, prose(input.text));
    case "heading":
      return pageSchema.node("heading", { level: input.level }, prose(input.text));
    case "math":
      return pageSchema.node("math_block", null, text(input.latex));
    case "code":
      return pageSchema.node("code_block", { language: input.language }, text(input.source));
  }
};

/** Puts `inputs` on a page after the block ordered at `last`, or first when it has none. */
export const appendTo = (pageId: string, last: string | null, inputs: readonly BlockInput[]): readonly Mutation[] =>
  inputs.reduce<{ readonly after: string | null; readonly mutations: readonly Mutation[] }>(
    ({ after, mutations }, input) => {
      const order = generateKeyBetween(after, null);
      const row = { id: crypto.randomUUID(), order, node: nodeOf(input) };
      return { after: order, mutations: [...mutations, { type: "block.put", pageId, row }] };
    },
    { after: last, mutations: [] },
  ).mutations;
