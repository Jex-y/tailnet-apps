import { PermanentJobError } from "@apps/core";
import { z } from "zod";
import type { Stroke } from "../contract";
import type { MathpixCredentials } from "./config";

/** What a reader made of some handwriting: `latex` when it is one piece of maths, and always Markdown `text`. */
export type Reading = { readonly latex: string | null; readonly text: string; readonly confidence: number };

export type HandwritingReader = {
  /**
   * Reads strokes in the order drawn. Throws `PermanentJobError` when the reader refuses the request itself (bad
   * credentials, unreadable input), which retrying cannot fix.
   */
  readonly read: (strokes: readonly Stroke[], signal: AbortSignal) => Promise<Reading>;
};

const StrokesResponse = z.object({
  latex_styled: z.string().optional(),
  text: z.string().default(""),
  confidence: z.number().min(0).max(1).default(0),
  error: z.string().optional(),
});

export const createMathpixReader = (
  { appId, appKey }: MathpixCredentials,
  send: typeof fetch = fetch,
): HandwritingReader => ({
  read: async (strokes, signal) => {
    const response = await send("https://api.mathpix.com/v3/strokes", {
      method: "POST",
      headers: { app_id: appId, app_key: appKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        strokes: {
          strokes: {
            x: strokes.map((stroke) => stroke.points.map((point) => Math.round(point.x))),
            y: strokes.map((stroke) => stroke.points.map((point) => Math.round(point.y))),
          },
        },
      }),
      signal,
    });
    if (response.status === 429 || response.status >= 500) {
      throw new Error(`Mathpix failed: ${response.status}`);
    }
    if (!response.ok) {
      throw new PermanentJobError(`Mathpix refused the request: ${response.status}`);
    }
    const result = StrokesResponse.parse(await response.json());
    if (result.error !== undefined) {
      throw new PermanentJobError(`Mathpix could not read the strokes: ${result.error}`);
    }
    return { latex: result.latex_styled ?? null, text: result.text, confidence: result.confidence };
  },
});
