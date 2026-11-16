import type { ProgramDay, ScheduledSession, Workout } from "./contract";
import { byPosition } from "./log";

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const DAY_MS = 86_400_000;

export const addDays = (date: string, days: number): string =>
  new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10);

export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

const weekdayOf = (date: string): Weekday => WEEKDAYS[(new Date(date).getUTCDay() + 6) % 7] ?? "mon";

export type DatedDay = { readonly programDayId: string; readonly date: string };

export type Dating =
  | { readonly kind: "dated"; readonly days: readonly DatedDay[] }
  | { readonly kind: "too_few_weekdays"; readonly needed: number };

/**
 * Week w of a program takes the seven days from `startsOn` plus w − 1 weeks, and its days, in order, take that
 * span's training weekdays in date order.
 */
export const scheduleDates = (days: readonly ProgramDay[], startsOn: string, weekdays: readonly Weekday[]): Dating => {
  const training = new Set(weekdays);
  const weeks = Map.groupBy(days, (day) => day.week);
  const needed = Math.max(0, ...[...weeks.values()].map((week) => week.length));
  if (training.size < needed) {
    return { kind: "too_few_weekdays", needed };
  }
  return {
    kind: "dated",
    days: [...weeks].flatMap(([week, inWeek]) => {
      const span = Array.from({ length: 7 }, (_, offset) => addDays(startsOn, (week - 1) * 7 + offset)).filter((date) =>
        training.has(weekdayOf(date)),
      );
      return inWeek.toSorted(byPosition).map((day, index) => ({ programDayId: day.id, date: span[index] ?? startsOn }));
    }),
  };
};

export type SessionStatus = "done" | "under_way" | "skipped" | "due" | "late" | "upcoming";

/** `workout` is the one a logged session names. */
export const sessionStatus = (
  session: ScheduledSession,
  workout: Pick<Workout, "finishedAt"> | undefined,
  today: string,
): SessionStatus => {
  switch (session.state) {
    case "logged":
      return workout?.finishedAt === null ? "under_way" : "done";
    case "skipped":
      return "skipped";
    case "planned":
      return session.date === today ? "due" : session.date < today ? "late" : "upcoming";
  }
};

/**
 * `moved` on `date`, and with `shiftLater` every planned session dated after it among `program`'s sessions moved by
 * the same number of days.
 */
export const movedSessions = (
  program: readonly ScheduledSession[],
  moved: ScheduledSession,
  date: string,
  shiftLater: boolean,
): ScheduledSession[] => {
  const by = daysBetween(moved.date, date);
  const later = shiftLater
    ? program.filter((session) => session.id !== moved.id && session.state === "planned" && session.date > moved.date)
    : [];
  return [{ ...moved, date }, ...later.map((session) => ({ ...session, date: addDays(session.date, by) }))];
};
