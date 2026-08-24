/**
 * 本地月历格纯函数。日历窗口用，避免和业务日切 todayKey 缠在一起。
 */

/** 给定年、月（0–11），生成该月每一天的 Date（本地时区） */
export const getLocalMonthDays = (year: number, monthIndex: number): Date[] => {
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  return Array.from({ length: daysInMonth }, (_, index) => new Date(year, monthIndex, index + 1));
};

/** 当月 1 日是星期几；周一 = 0，周日 = 6（与中文周历表头对齐） */
export const getMondayFirstWeekday = (year: number, monthIndex: number): number => {
  const first = new Date(year, monthIndex, 1);
  return (first.getDay() + 6) % 7;
};

/** 月历需要几行（含月初空白），至少 1 */
export const getCalendarWeekCount = (year: number, monthIndex: number): number => {
  const days = getLocalMonthDays(year, monthIndex).length;
  const offset = getMondayFirstWeekday(year, monthIndex);
  return Math.max(1, Math.ceil((offset + days) / 7));
};
