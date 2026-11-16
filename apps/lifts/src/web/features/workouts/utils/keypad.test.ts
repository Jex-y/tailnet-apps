import { describe, expect, test } from "bun:test";
import { draftOf, type Key, parseDraft, press } from "./keypad";

/** Keys pressed one after another into a field just chosen. */
const typed = (start: string, keys: readonly Key[], decimal = true) =>
  keys.reduce((text, key, at) => press(text, key, { fresh: at === 0, decimal }), start);

describe("press", () => {
  test("replaces what the field held with the first key, then adds to it", () => {
    expect(typed("140", ["1", "4", "2", ".", "5"])).toBe("142.5");
    expect(typed("5", ["8"], false)).toBe("8");
  });

  test("takes one decimal point, two places, and none for reps", () => {
    expect(typed("0", [".", "5"])).toBe("0.5");
    expect(typed("0", ["1", ".", ".", "2", "5", "7"])).toBe("1.25");
    expect(typed("5", ["1", "."], false)).toBe("1");
  });

  test("drops leading zeros and stops at the longest weight", () => {
    expect(typed("1", ["0", "0", "8"])).toBe("8");
    expect(typed("1", ["1", "0", "0", "0", ".", "0", "0", "1"])).toBe("1000.00");
  });

  test("deletes back, clearing the field when it was just chosen", () => {
    expect(press("142.5", "back", { fresh: false, decimal: true })).toBe("142.");
    expect(press("142.5", "back", { fresh: true, decimal: true })).toBe("");
  });
});

describe("parseDraft", () => {
  test("reads figures the log can hold, an empty RPE being none", () => {
    expect(parseDraft(draftOf({ weightKg: 142.5, reps: 5, rpe: null }))).toEqual({
      ok: true,
      values: { weightKg: 142.5, reps: 5, rpe: null },
    });
    expect(parseDraft({ weightKg: "100", reps: "0", rpe: "8.5" })).toEqual({
      ok: true,
      values: { weightKg: 100, reps: 0, rpe: 8.5 },
    });
  });

  test("names every field it cannot take", () => {
    expect(parseDraft({ weightKg: "", reps: "5", rpe: "" })).toEqual({ ok: false, invalid: ["weightKg"] });
    expect(parseDraft({ weightKg: "1200", reps: "101", rpe: "8.3" })).toEqual({
      ok: false,
      invalid: ["weightKg", "reps", "rpe"],
    });
    expect(parseDraft({ weightKg: "100.", reps: "5", rpe: "11" })).toEqual({ ok: false, invalid: ["weightKg", "rpe"] });
  });
});
