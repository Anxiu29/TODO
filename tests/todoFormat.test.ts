/**
 * 完成用时与完成时刻文案：日历回看时按完成日而不是今天起算。
 */
import { describe, expect, it } from "vitest";
import {
  formatCompletedAt,
  formatCompletedDays,
  formatCreatedAt,
  formatWaitDate
} from "../src/todoFormat";

describe("completed todo labels", () => {
  it("formats duration from created day to the completion date, not today", () => {
    const createdToday = new Date(2026, 6, 1, 8, 0, 0).toISOString();
    const createdThreeDaysAgo = new Date(2026, 5, 28, 8, 0, 0).toISOString();

    expect(formatCompletedDays(createdToday, "2026-07-01")).toBe("当天完成");
    expect(formatCompletedDays(createdThreeDaysAgo, "2026-07-01")).toBe("用时 3 天");
    expect(formatCompletedDays(createdThreeDaysAgo, "2026-07-01T10:00:00.000Z")).toBe("用时 3 天");
    expect(formatCompletedDays(createdToday)).toBe("");
  });

  it("formats completion time as a date label or clock time", () => {
    expect(formatCompletedAt("2026-07-01")).toBe(formatWaitDate("2026-07-01"));
    expect(formatCompletedAt("not-a-date")).toBe("not-a-date");

    const iso = new Date(2026, 6, 1, 15, 30, 0).toISOString();
    expect(formatCompletedAt(iso)).toBe(formatCreatedAt(iso));
  });
});
