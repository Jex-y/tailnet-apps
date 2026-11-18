import { z } from "zod";

export type LiftsConfig = {
  /** Workouts are only named when Claude is configured. */
  readonly anthropicApiKey: string | null;
};

/** Compose passes an unset optional secret through as an empty string, so blank means unset. */
const LiftsEnv = z.object({ ANTHROPIC_API_KEY: z.string().trim().optional() });

export const parseLiftsConfig = (env: Readonly<Record<string, string | undefined>>): LiftsConfig => {
  const result = LiftsEnv.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid lifts environment:\n${z.prettifyError(result.error)}`);
  }
  return { anthropicApiKey: result.data.ANTHROPIC_API_KEY || null };
};
