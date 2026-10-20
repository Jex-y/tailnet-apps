import { z } from "zod";

export type MathpixCredentials = { readonly appId: string; readonly appKey: string };

export type NotesConfig = {
  /** Handwriting is only read when Mathpix is configured. */
  readonly mathpix: MathpixCredentials | null;
};

/** Compose passes an unset optional secret through as an empty string, so blank means unset. */
const NotesEnv = z.object({
  MATHPIX_APP_ID: z.string().trim().optional(),
  MATHPIX_APP_KEY: z.string().trim().optional(),
});

export const parseNotesConfig = (env: Readonly<Record<string, string | undefined>>): NotesConfig => {
  const result = NotesEnv.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid notes environment:\n${z.prettifyError(result.error)}`);
  }
  const { MATHPIX_APP_ID: appId, MATHPIX_APP_KEY: appKey } = result.data;
  if (Boolean(appId) !== Boolean(appKey)) {
    throw new Error("Set both MATHPIX_APP_ID and MATHPIX_APP_KEY, or neither");
  }
  return { mathpix: appId && appKey ? { appId, appKey } : null };
};
