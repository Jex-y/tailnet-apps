import Anthropic from "@anthropic-ai/sdk";
import { PermanentJobError } from "@apps/core";
import { WorkoutName } from "../contract";
import { sessionsOf, type WorkoutDetail } from "../log";
import { isRecord } from "../strength";
import { setText } from "./mcp/render";

export type WorkoutNamer = {
  /**
   * A name for the workout `description` describes. Throws `PermanentJobError` when the model will not name it or the
   * request itself is refused (a bad key), which retrying cannot fix.
   */
  readonly name: (description: string, signal: AbortSignal) => Promise<string>;
};

/** How many of the latest names the namer is shown, so it does not repeat itself. */
const RECENT_NAMES = 12;

/**
 * A finished workout in plain text for the namer: each exercise with its sets, flagging a new best estimated max,
 * then the session's notes and the names of the workouts before it.
 */
export const describeWorkout = (workout: WorkoutDetail, workouts: readonly WorkoutDetail[]): string => {
  const before = workouts.filter((other) => other.id !== workout.id && other.date <= workout.date);
  const exercises = workout.entries.filter((entry) => entry.sets.length > 0);
  const lines = exercises.map((entry) => {
    const history = sessionsOf(before, entry.exerciseId).flatMap((session) => session.sets);
    const record = entry.sets.some((set) => isRecord(set, history));
    const sets = entry.sets.map((set) => setText(set, entry.exercise)).join(", ");
    return `- ${entry.exercise.name}: ${sets}${record ? " (a new best estimated max)" : ""}`;
  });
  const notes = [workout.notes, ...exercises.map((entry) => entry.notes)].filter((note) => note.trim() !== "");
  const recent = before.flatMap((other) => (other.name === null ? [] : [other.name])).slice(-RECENT_NAMES);
  return [
    `Exercises (weights in kg, sets as weight×reps @RPE):\n${lines.join("\n") || "- none"}`,
    notes.length > 0 && `Notes:\n${notes.join("\n")}`,
    recent.length > 0 && `Earlier workouts were named:\n${recent.join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
};

/** The name in a reply: its first line, without quotes, a label or closing punctuation. `null` if none fits. */
export const cleanName = (reply: string): string | null => {
  const line = (reply.trim().split("\n")[0] ?? "")
    .replace(/^name:\s*/i, "")
    .replace(/^["'“‘*]+|["'”’*.!]+$/g, "")
    .replace(/\s+/g, " ");
  const parsed = WorkoutName.safeParse(line);
  return parsed.success ? parsed.data : null;
};

const SYSTEM = `You name sessions in a lifter's strength training log, so they can find a session again at a glance.

Reply with the name alone: two to five words, in title case, without quotes, a date or emoji. Name what the session \
was about, usually its main lift or the muscles it trained ("Heavy Squat Singles", "Upper Body Volume"). Wit is welcome \
when a session earns it, such as a new best. Do not reuse an earlier name word for word.`;

/** Claude Haiku names each workout: a small, cheap request a session. */
export const createClaudeNamer = (apiKey: string): WorkoutNamer => {
  const client = new Anthropic({ apiKey });
  return {
    name: async (description, signal) => {
      let response: Anthropic.Message;
      try {
        response = await client.messages.create(
          {
            model: "claude-haiku-5-5",
            max_tokens: 2048,
            output_config: { effort: "low" },
            system: SYSTEM,
            messages: [{ role: "user", content: description }],
          },
          { signal },
        );
      } catch (error) {
        // Retrying cannot fix a request the API refuses as it stands; anything else (rate limits, outages) it may.
        if (
          error instanceof Anthropic.BadRequestError ||
          error instanceof Anthropic.AuthenticationError ||
          error instanceof Anthropic.PermissionDeniedError ||
          error instanceof Anthropic.NotFoundError
        ) {
          throw new PermanentJobError(`Claude refused the request: ${error.message}`);
        }
        throw error;
      }
      if (response.stop_reason === "refusal") {
        throw new PermanentJobError("Claude declined to name the workout");
      }
      const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
      const name = cleanName(text);
      if (name === null) {
        throw new PermanentJobError(`Claude did not reply with a name: ${JSON.stringify(text.slice(0, 200))}`);
      }
      return name;
    },
  };
};
