import type { LiftSet } from "../../contract";

const dayParts = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** Today where the device is, as YYYY-MM-DD. */
export const localToday = (now = new Date()): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

/** A training day, with its year only once that is not the current one. */
export const formatDay = (date: string, today = localToday()): string => {
  const parts = new Map(dayParts.formatToParts(new Date(`${date}T00:00:00Z`)).map(({ type, value }) => [type, value]));
  const day = `${parts.get("weekday")} ${parts.get("day")} ${parts.get("month")}`;
  return date.slice(0, 4) === today.slice(0, 4) ? day : `${day} ${parts.get("year")}`;
};

/** To the nearest tenth, without a trailing zero, thousands marked. */
export const formatKg = (kg: number): string => kg.toLocaleString("en-GB", { maximumFractionDigits: 1 });

export const formatSet = (set: Pick<LiftSet, "weightKg" | "reps" | "rpe">): string =>
  `${formatKg(set.weightKg)}×${set.reps}${set.rpe === null ? "" : ` @${set.rpe}`}`;

/** A signed change to one decimal, with a true minus sign. */
export const formatChange = (kg: number): string => `${kg < 0 ? "−" : "+"}${Math.abs(kg).toFixed(1)}`;

/** Minutes and seconds, as a rest timer shows them. */
export const formatElapsed = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

const monthYear = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const weekdayLong = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" });
const monthLong = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" });

const utc = (date: string) => new Date(`${date}T00:00:00Z`);

/** The month a training day falls in, as a heading. */
export const formatMonth = (date: string): string => monthYear.format(utc(date));

/** A training day written out, as a greeting. */
export const formatLongDay = (date: string): string =>
  `${weekdayLong.format(utc(date))} ${utc(date).getUTCDate()} ${monthLong.format(utc(date))}`;

/** The short weekday and the day of the month, for a calendar-style badge. */
export const dayBadge = (date: string): { readonly weekday: string; readonly day: number } => {
  const parts = new Map(dayParts.formatToParts(utc(date)).map(({ type, value }) => [type, value]));
  return { weekday: parts.get("weekday") ?? "", day: utc(date).getUTCDate() };
};
