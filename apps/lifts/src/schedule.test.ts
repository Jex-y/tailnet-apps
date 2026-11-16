import { describe, expect, test } from "bun:test";
import { scheduleDates } from "./schedule";

const day = (week: number, position: number) => ({
  id: `${week}.${position}`,
  programId: "p",
  week,
  position,
  name: "",
});

describe("scheduleDates", () => {
  test("starting midweek, each week's days take its seven days' training weekdays in date order", () => {
    expect(scheduleDates([day(1, 0), day(1, 1), day(2, 0), day(2, 1)], "2026-10-07", ["mon", "wed"])).toEqual({
      kind: "dated",
      days: [
        { programDayId: "1.0", date: "2026-10-07" },
        { programDayId: "1.1", date: "2026-10-12" },
        { programDayId: "2.0", date: "2026-10-14" },
        { programDayId: "2.1", date: "2026-10-19" },
      ],
    });
  });
});
