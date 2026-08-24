import { describe, expect, it } from "vitest";
import { getCalendarWeekCount, getLocalMonthDays, getMondayFirstWeekday } from "../src/data/calendar";

describe("local month calendar", () => {
  it("lists every day in February 2026", () => {
    const days = getLocalMonthDays(2026, 1);
    expect(days).toHaveLength(28);
    expect(days[0]?.getDate()).toBe(1);
    expect(days[27]?.getDate()).toBe(28);
  });

  it("treats Monday as the first weekday", () => {
    // 2026-08-01 is Saturday
    expect(getMondayFirstWeekday(2026, 7)).toBe(5);
  });

  it("counts calendar rows including the leading blank cells", () => {
    expect(getCalendarWeekCount(2026, 7)).toBe(6);
  });
});
