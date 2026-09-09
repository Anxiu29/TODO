/** 验证日切失败会重试，停止后解锁/恢复不会重新启动巡检。 */
import { afterEach, expect, it, vi } from "vitest";
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  return { powerMonitor: new EventEmitter() };
});
import { powerMonitor } from "electron";
import { createDailyRefreshWatch } from "../electron/dailyRefreshWatch";
afterEach(() => { powerMonitor.removeAllListeners(); vi.clearAllTimers(); vi.useRealTimers(); });

it("retries failed rollover and releases wake listeners on stop", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 9, 12));
  const refresh = vi.fn().mockImplementationOnce(() => { throw new Error("disk full"); });
  const watch = createDailyRefreshWatch(refresh); watch.start("2026-09-08");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(refresh).toHaveBeenCalledTimes(2);
  watch.stop();
  powerMonitor.emit("resume"); powerMonitor.emit("unlock-screen");
  expect(vi.getTimerCount()).toBe(0);
  expect(refresh).toHaveBeenCalledTimes(2);
  watch.start("2026-09-09");
  expect(powerMonitor.listenerCount("resume")).toBe(1);
  watch.stop();
});
