/**
 * Dates written the way people say them: "today", "this tue", "next friday", "in 3 days",
 * "24 nov", "end of month". Worked out in plain code, so the answer is exact and the same
 * every time; the editor shows the date before anything is written.
 *
 * Conventions (shown in the preview, so a different reading is easy to spot):
 * - "tue" and "this tue": the coming Tuesday, today included.
 * - "next tue": Tuesday of next week (weeks start on Monday), as Todoist reads it.
 * - "next week": Monday of next week; "next month": the 1st of next month.
 * - A day and month without a year ("24 nov"): this year, or next year if it's passed.
 * - Numbers ("24/11"): in the browser's day/month order; a part over 12 settles it.
 */

const DAY_MS = 86_400_000;

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

const MONTHS: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

const WD = Object.keys(WEEKDAYS).join("|");
const MON = Object.keys(MONTHS).join("|");

/** Midnight (local) of a day. */
const day = (y: number, m: number, d: number) => new Date(y, m, d);
const startOf = (now: Date) => day(now.getFullYear(), now.getMonth(), now.getDate());
const addDays = (d: Date, n: number) => day(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** Monday-based weekday: 0 = Monday … 6 = Sunday. */
const isoWeekday = (d: Date) => (d.getDay() + 6) % 7;

/** Adds months, keeping the day where the month has it (31 Jan + 1 month = 28/29 Feb). */
function addMonths(d: Date, n: number): Date {
  const first = day(d.getFullYear(), d.getMonth() + n, 1);
  const last = day(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return day(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), last));
}

/** A real calendar date, or null (31 Feb, month 13). */
function valid(y: number, m: number, d: number): Date | null {
  if (m < 0 || m > 11 || d < 1) return null;
  const date = day(y, m, d);
  return date.getMonth() === m ? date : null;
}

/** A day and month with no year: the next time it comes round, today included. */
function upcoming(today: Date, m: number, d: number): Date | null {
  const thisYear = valid(today.getFullYear(), m, d);
  if (thisYear && thisYear >= today) return thisYear;
  return valid(today.getFullYear() + 1, m, d) ?? thisYear;
}

const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/** Whether this browser writes numeric dates day first (24/11) or month first (11/24). */
export function numericOrder(locale?: string): "dmy" | "mdy" {
  try {
    const parts = new Intl.DateTimeFormat(locale, { day: "numeric", month: "numeric" }).formatToParts(new Date(2026, 10, 24));
    const d = parts.findIndex((p) => p.type === "day");
    const m = parts.findIndex((p) => p.type === "month");
    return m !== -1 && d !== -1 && m < d ? "mdy" : "dmy";
  } catch {
    return "dmy";
  }
}

const UNITS: Record<string, "day" | "week" | "month" | "year"> = {
  d: "day", day: "day", days: "day",
  w: "week", wk: "week", wks: "week", week: "week", weeks: "week",
  m: "month", mo: "month", month: "month", months: "month",
  y: "year", yr: "year", yrs: "year", year: "year", years: "year",
};

/** The date a phrase means, or null if it isn't one. */
export function parseNaturalDate(input: string, now = new Date(), order: "dmy" | "mdy" = numericOrder()): Date | null {
  const s = input
    .toLowerCase()
    .trim()
    .replace(/[.,!?]+$/, "")
    .replace(/\s+/g, " ")
    .replace(/^(?:on|by|due|for) /, "");
  if (!s) return null;
  const today = startOf(now);

  if (s === "today" || s === "tod" || s === "now" || s === "tonight") return today;
  if (s === "tomorrow" || s === "tmr" || s === "tmrw" || s === "tom") return addDays(today, 1);
  if (s === "yesterday") return addDays(today, -1);
  if (s === "day after tomorrow") return addDays(today, 2);

  // Weekdays.
  let m = new RegExp(`^(?:(this|next|last|coming) )?(${WD})$`).exec(s);
  if (m) {
    const target = (WEEKDAYS[m[2]] + 6) % 7; // Monday-based
    const here = isoWeekday(today);
    if (m[1] === "next") return addDays(today, 7 - here + target);
    if (m[1] === "last") return addDays(today, -(((here - target + 6) % 7) + 1));
    return addDays(today, (target - here + 7) % 7);
  }

  // This/next week, month, year; weekends; ends of periods.
  if (s === "next week") return addDays(today, 7 - isoWeekday(today));
  if (s === "next month") return day(today.getFullYear(), today.getMonth() + 1, 1);
  if (s === "next year") return day(today.getFullYear() + 1, 0, 1);
  if (s === "this weekend" || s === "weekend" || s === "the weekend") return addDays(today, (5 - isoWeekday(today) + 7) % 7);
  if (s === "next weekend") return addDays(today, 7 - isoWeekday(today) + 5);
  if (s === "end of week" || s === "end of the week" || s === "eow") return addDays(today, (4 - isoWeekday(today) + 7) % 7); // Friday
  if (s === "end of month" || s === "end of the month" || s === "eom") return day(today.getFullYear(), today.getMonth() + 1, 0);
  if (s === "end of year" || s === "end of the year" || s === "eoy") return day(today.getFullYear(), 11, 31);

  // "in 3 days", "3 days", "in a week", "+2w", "2 weeks ago".
  m = /^(?:in |\+)?(a|an|one|two|three|four|five|six|seven|\d{1,3}) ?([a-z]+)( ago)?$/.exec(s);
  if (m && UNITS[m[2]]) {
    const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
    const n = (words[m[1]] ?? Number(m[1])) * (m[3] ? -1 : 1);
    const unit = UNITS[m[2]];
    return unit === "day" ? addDays(today, n) : unit === "week" ? addDays(today, 7 * n) : unit === "month" ? addMonths(today, n) : addMonths(today, 12 * n);
  }

  // ISO: 2026-11-24.
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return valid(Number(m[1]), Number(m[2]) - 1, Number(m[3]));

  // "24 nov", "24th of november 2027", "nov 24", "november 24th, 2027".
  m = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?(?: of)? (${MON})(?:,? (\\d{4}|'\\d{2}))?$`).exec(s);
  if (m) return m[3] ? valid(fullYear(m[3].replace("'", "")), MONTHS[m[2]], Number(m[1])) : upcoming(today, MONTHS[m[2]], Number(m[1]));
  m = new RegExp(`^(${MON}) (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}|'\\d{2}))?$`).exec(s);
  if (m) return m[3] ? valid(fullYear(m[3].replace("'", "")), MONTHS[m[1]], Number(m[2])) : upcoming(today, MONTHS[m[1]], Number(m[2]));

  // "the 24th": that day this month, or next month if it's passed.
  m = /^(?:the )?(\d{1,2})(?:st|nd|rd|th)$/.exec(s);
  if (m) {
    const d = Number(m[1]);
    for (let k = 0; k <= 12; k++) {
      const month = day(today.getFullYear(), today.getMonth() + k, 1);
      const date = valid(month.getFullYear(), month.getMonth(), d);
      if (date && date >= today) return date;
    }
    return null;
  }

  // "24/11", "24/11/2027", "11-24" (with the browser's order unless a part over 12 settles it).
  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?$/.exec(s);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    const dayFirst = a > 12 ? true : b > 12 ? false : order === "dmy";
    const [d, mo] = dayFirst ? [a, b] : [b, a];
    return m[3] ? valid(fullYear(m[3]), mo - 1, d) : upcoming(today, mo - 1, d);
  }

  return null;
}

/** "2026-11-24", the form the app writes into notes. */
export function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Tue 24 Nov", with the year when it isn't this year's. */
export function describeDate(d: Date, now = new Date()): string {
  const base = `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** "today", "tomorrow", "in 8 days", "3 days ago". */
export function relativeDay(d: Date, now = new Date()): string {
  const n = Math.round((startOf(d).getTime() - startOf(now).getTime()) / DAY_MS);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/**
 * Phrases to suggest while one is being typed ("next t" → "next tue", "next thu"), most
 * useful first. Each still goes through parseNaturalDate.
 */
export const DATE_PHRASES = [
  "today",
  "tomorrow",
  ...["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => `this ${d}`),
  ...["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => `next ${d}`),
  "next week",
  "this weekend",
  "end of week",
  "end of month",
  "next month",
  "in 3 days",
  "in 1 week",
  "in 2 weeks",
  "in 1 month",
  ...["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
];
