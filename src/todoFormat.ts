/**
 * 待办展示用日期与等待文案。
 * 一律吃 snapshot.today，避免各窗口自己 new Date() 和日切不同步。
 */
import { daysBetweenDateKeys, daysSinceCreatedOn } from "./data/todoStore";

/** YYYY-MM-DD →「7月4日 星期六」；空串原样 */
export const formatDate = (date: string): string => {
  if (!date) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long"
  }).format(new Date(`${date}T00:00:00`));
};

/** ISO 创建时间 →「2026/7/21 15:30」 */
export const formatCreatedAt = (iso: string): string =>
  new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(iso));

/** 按快照「今天」起算：今天添加 / 已过去 N 天 */
export const formatDaysAgo = (iso: string, today: string): string => {
  const days = daysSinceCreatedOn(iso, today);
  if (days === 0) return "今天添加";
  return `已过去 ${days} 天`;
};

/** 根据 waitingSince 与今日日期键格式化等待文案 */
export const formatWaitingDays = (waitingSince: string | undefined, today: string): string => {
  if (!waitingSince) return "等待中";
  const days = daysBetweenDateKeys(waitingSince, today);
  if (days === 0) return "今天开始等待";
  return `已等待 ${days} 天`;
};

/** YYYY-MM-DD →「M月D日」，非法键原样返回 */
export const formatWaitDate = (dateKey: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return dateKey;
  return `${Number(match[2])}月${Number(match[3])}日`;
};

/** 等待段时长：同日为「当天」，否则「N 天」 */
export const formatWaitSpan = (startedAt: string, endedAt: string): string => {
  const days = daysBetweenDateKeys(startedAt, endedAt);
  if (days === 0) return "当天";
  return `${days} 天`;
};
