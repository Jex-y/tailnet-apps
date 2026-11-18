import { describe, expect, test } from "bun:test";
import { draftOf, parseDraft } from "./draft";

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

  test("reads a decimal comma, and a point with nothing after it, as a keyboard may leave them", () => {
    expect(parseDraft({ weightKg: " 102,5 ", count: "5", rpe: "8." }, "reps")).toEqual({
      ok: true,
      values: { weightKg: 102.5, reps: 5, seconds: null, rpe: 8 },
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
    expect(parseDraft({ weightKg: "100kg", count: "5", rpe: "11" }, "reps")).toEqual({
      ok: false,
      invalid: ["weightKg", "rpe"],
    });
  });
});
