/*
 * A calendar of the world's own: its months, how many days each has, the year the story starts in, and what years
 * are called ("AE"). Story time comes from the app's timeline as day numbers (app.project.storyTime), with day 1 the
 * first day of the start year. It's kept in World's shared data, so every book of the series uses the same calendar.
 */

export interface Month {
  name: string;
  days: number;
}

export interface WorldCalendar {
  months: Month[];
  startYear: number;
  /** Written after a year: "1203 AE". */
  era: string;
}

/** A date in the world's calendar. `month` counts from 0. */
export interface WorldDate {
  year: number;
  month: number;
  day: number;
}

/** Reads the months from the text the writer typed: one month a line, its name and then its number of days. */
export function parseMonths(text: string): Month[] {
  return text
    .split("\n")
    .map((line) => line.trim().match(/^(.+?)[\s:,]+(\d{1,4})$/u))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ name: m[1].trim(), days: Math.min(1000, Math.max(1, Number(m[2]))) }))
    .slice(0, 100);
}

/** The months as the writer edits them. */
export const monthsText = (months: Month[]) => months.map((m) => `${m.name} ${m.days}`).join("\n");

/** Reads the calendar from World's shared data, or null if the writer hasn't set one up. */
export function readCalendar(shared: unknown): WorldCalendar | null {
  const raw = shared && typeof shared === "object" ? (shared as { calendar?: unknown }).calendar : undefined;
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Partial<WorldCalendar>;
  const months = Array.isArray(c.months)
    ? c.months.filter((m): m is Month => !!m && typeof m.name === "string" && Number.isInteger(m.days) && m.days > 0)
    : [];
  if (!months.length) return null;
  return { months, startYear: Number.isFinite(c.startYear) ? Number(c.startYear) : 1, era: typeof c.era === "string" ? c.era : "" };
}

/** Returns the world's date for a story day: day 1 is the first day of the start year. Days before it count back. */
export function worldDate(storyDay: number, calendar: WorldCalendar): WorldDate {
  const yearLength = calendar.months.reduce((n, m) => n + m.days, 0);
  const index = Math.floor(storyDay) - 1;
  const year = Math.floor(index / yearLength);
  let rest = index - year * yearLength;
  let month = 0;
  while (rest >= calendar.months[month].days) rest -= calendar.months[month++].days;
  return { year: calendar.startYear + year, month, day: rest + 1 };
}

/** The year as the world writes it: "1203 AE". */
export const yearLabel = (year: number, calendar: WorldCalendar) => (calendar.era ? `${year} ${calendar.era}` : String(year));
