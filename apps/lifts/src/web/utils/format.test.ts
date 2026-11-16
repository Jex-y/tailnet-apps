import { expect, test } from "bun:test";
import {
  dayBadge,
  formatChange,
  formatDay,
  formatElapsed,
  formatKg,
  formatLongDay,
  formatMonth,
  formatSet,
  localToday,
} from "./format";

test("formats days, weights, sets and rests as the screens show them", () => {
  expect(localToday(new Date(2026, 9, 1, 23, 30))).toBe("2026-10-01");
  expect(formatDay("2026-10-01", "2026-10-03")).toBe("Thu 1 Oct");
  expect(formatDay("2025-12-31", "2026-10-03")).toBe("Wed 31 Dec 2025");
  expect([formatKg(140), formatKg(142.5), formatKg(172.63)]).toEqual(["140", "142.5", "172.6"]);
  const barbell = { bodyweight: false };
  const bodyweight = { bodyweight: true };
  expect(formatSet({ weightKg: 142.5, reps: 5, seconds: null, rpe: 8.5 }, barbell)).toBe("142.5×5 @8.5");
  expect(formatSet({ weightKg: 60, reps: 10, seconds: null, rpe: null }, barbell)).toBe("60×10");
  expect(formatSet({ weightKg: 1250, reps: null, seconds: 45, rpe: null }, barbell)).toBe("1,250×45s");
  expect(formatSet({ weightKg: 20, reps: 5, seconds: null, rpe: 9 }, bodyweight)).toBe("BW+20×5 @9");
  expect(formatSet({ weightKg: 0, reps: null, seconds: 60, rpe: null }, bodyweight)).toBe("BW×60s");
  expect([formatElapsed(0), formatElapsed(95_400), formatElapsed(-5)]).toEqual(["0:00", "1:35", "0:00"]);
  expect(formatKg(2060)).toBe("2,060");
  expect(formatMonth("2026-10-01")).toBe("October 2026");
  expect(formatLongDay("2026-10-01")).toBe("Thursday 1 October");
  expect(dayBadge("2026-10-01")).toEqual({ weekday: "Thu", day: 1 });
});

test("signs a change with a true minus", () => {
  expect(formatChange(0.44)).toBe("+0.4");
  expect(formatChange(-2.06)).toBe("−2.1");
  expect(formatChange(0)).toBe("+0.0");
});
