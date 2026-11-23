import { describe, expect, it } from "vitest";
import { describeDate, isoDate, numericOrder, parseNaturalDate, relativeDay } from "./natural";

// Monday 23 November 2026, mid-morning.
const NOW = new Date(2026, 10, 23, 10, 30);
const parse = (s: string, now = NOW, order: "dmy" | "mdy" = "dmy") => {
  const d = parseNaturalDate(s, now, order);
  return d ? isoDate(d) : null;
};

describe("parseNaturalDate", () => {
  it("reads the everyday words", () => {
    expect(parse("today")).toBe("2026-11-23");
    expect(parse("Tomorrow")).toBe("2026-11-24");
    expect(parse("tmrw")).toBe("2026-11-24");
    expect(parse("yesterday")).toBe("2026-11-22");
    expect(parse("day after tomorrow")).toBe("2026-11-25");
  });

  it("reads weekdays: the coming one, or next week's with 'next'", () => {
    expect(parse("this tue")).toBe("2026-11-24");
    expect(parse("tue")).toBe("2026-11-24");
    expect(parse("Friday")).toBe("2026-11-27");
    expect(parse("this mon")).toBe("2026-11-23"); // today counts
    expect(parse("sun")).toBe("2026-11-29");
    expect(parse("next tue")).toBe("2026-12-01");
    expect(parse("next mon")).toBe("2026-11-30");
    expect(parse("next sun")).toBe("2026-12-06");
    expect(parse("last fri")).toBe("2026-11-20");
    expect(parse("last mon")).toBe("2026-11-16");
    // From a Sunday, "next tue" is still Tuesday of the following week.
    expect(parse("next tue", new Date(2026, 10, 29))).toBe("2026-12-01");
  });

  it("reads weeks, months and the ends of them", () => {
    expect(parse("next week")).toBe("2026-11-30");
    expect(parse("next month")).toBe("2026-12-01");
    expect(parse("next year")).toBe("2027-01-01");
    expect(parse("this weekend")).toBe("2026-11-28");
    expect(parse("end of week")).toBe("2026-11-27");
    expect(parse("end of month")).toBe("2026-11-30");
    expect(parse("eoy")).toBe("2026-12-31");
  });

  it("counts days, weeks, months and years from today", () => {
    expect(parse("in 3 days")).toBe("2026-11-26");
    expect(parse("3 days")).toBe("2026-11-26");
    expect(parse("+10d")).toBe("2026-12-03");
    expect(parse("in a week")).toBe("2026-11-30");
    expect(parse("in two weeks")).toBe("2026-12-07");
    expect(parse("in 1 month")).toBe("2026-12-23");
    expect(parse("2 days ago")).toBe("2026-11-21");
    expect(parse("in 1 month", new Date(2027, 0, 31))).toBe("2027-02-28"); // no 31 Feb
  });

  it("reads written dates, in this year unless it's passed", () => {
    expect(parse("24 nov")).toBe("2026-11-24");
    expect(parse("24th of November")).toBe("2026-11-24");
    expect(parse("nov 24")).toBe("2026-11-24");
    expect(parse("December 3rd")).toBe("2026-12-03");
    expect(parse("3 jan")).toBe("2027-01-03");
    expect(parse("23 nov")).toBe("2026-11-23");
    expect(parse("24 nov 2027")).toBe("2027-11-24");
    expect(parse("nov 24, 2027")).toBe("2027-11-24");
    expect(parse("2026-12-25")).toBe("2026-12-25");
    expect(parse("the 25th")).toBe("2026-11-25");
    expect(parse("the 5th")).toBe("2026-12-05");
    expect(parse("31st", new Date(2026, 10, 23))).toBe("2026-12-31"); // November has no 31st
  });

  it("reads numbers in the browser's order, unless a part over 12 settles it", () => {
    expect(parse("4/12")).toBe("2026-12-04");
    expect(parse("4/12", NOW, "mdy")).toBe("2027-04-12");
    expect(parse("24/11")).toBe("2026-11-24");
    expect(parse("11/24", NOW, "dmy")).toBe("2026-11-24");
    expect(parse("24/11/2027")).toBe("2027-11-24");
    expect(parse("24.11.27")).toBe("2027-11-24");
  });

  it("ignores filler words and punctuation, and refuses what isn't a date", () => {
    expect(parse("on friday.")).toBe("2026-11-27");
    expect(parse("by  next   tue")).toBe("2026-12-01");
    for (const s of ["", "soon", "next", "31 feb", "13/13", "tuesdayish", "next t", "in 3 lemons", "2026-02-30"]) {
      expect(parse(s), s).toBeNull();
    }
  });
});

describe("describing a date", () => {
  it("says the day, with the year only when it isn't this year", () => {
    expect(describeDate(new Date(2026, 10, 24), NOW)).toBe("Tue 24 Nov");
    expect(describeDate(new Date(2027, 0, 3), NOW)).toBe("Sun 3 Jan 2027");
  });

  it("says how far away it is", () => {
    expect(relativeDay(new Date(2026, 10, 23), NOW)).toBe("today");
    expect(relativeDay(new Date(2026, 10, 24), NOW)).toBe("tomorrow");
    expect(relativeDay(new Date(2026, 11, 1), NOW)).toBe("in 8 days");
    expect(relativeDay(new Date(2026, 10, 20), NOW)).toBe("3 days ago");
  });

  it("finds the browser's numeric order", () => {
    expect(numericOrder("en-GB")).toBe("dmy");
    expect(numericOrder("en-US")).toBe("mdy");
  });
});
