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
    expect(parseDraft(draftOf({ weightKg: 142.5, reps: 5, seconds: null, rpe: null }), "reps")).toEqual({
      ok: true,
      values: { weightKg: 142.5, reps: 5, seconds: null, rpe: null },
    });
    expect(parseDraft({ weightKg: "100", count: "0", rpe: "8.5" }, "reps")).toEqual({
      ok: true,
      values: { weightKg: 100, reps: 0, seconds: null, rpe: 8.5 },
    });
  });

  test("reads the count as seconds for a timed exercise, which may run past a hundred", () => {
    expect(parseDraft(draftOf({ weightKg: 20, reps: null, seconds: 90, rpe: null }), "seconds")).toEqual({
      ok: true,
      values: { weightKg: 20, reps: null, seconds: 90, rpe: null },
    });
    expect(parseDraft({ weightKg: "0", count: "120", rpe: "" }, "reps")).toEqual({ ok: false, invalid: ["count"] });
  });

  test("names every field it cannot take", () => {
    expect(parseDraft({ weightKg: "", count: "5", rpe: "" }, "reps")).toEqual({ ok: false, invalid: ["weightKg"] });
    expect(parseDraft({ weightKg: "1200", count: "101", rpe: "8.3" }, "reps")).toEqual({
      ok: false,
      invalid: ["weightKg", "count", "rpe"],
    });
    expect(parseDraft({ weightKg: "100.", count: "5", rpe: "11" }, "reps")).toEqual({
      ok: false,
      invalid: ["weightKg", "rpe"],
    });
  });
});
