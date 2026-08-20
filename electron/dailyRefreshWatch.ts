/**
 * 常驻日切巡检：对准午夜、短间隔轮询、休眠/解锁唤醒。
 * 主进程在 boot 时 start，will-quit 时 stop；日期变化时回调方负责 refreshDaily + 广播。
 */
import { powerMonitor } from "electron";
import { msUntilNextLocalMidnight, todayKey } from "../src/data/todoStore";

const POLL_MS = 30_000;

export type DailyRefreshWatch = {
  /** 以当前已日切的日期键启动巡检 */
  start: (initialToday: string) => void;
  stop: () => void;
};

/**
 * @param onDateChanged 本地日期相对上次观察值变化时调用（应先 refreshDaily 再广播）
 */
export const createDailyRefreshWatch = (onDateChanged: () => void): DailyRefreshWatch => {
  let pollTimer: NodeJS.Timeout | undefined;
  let midnightTimer: NodeJS.Timeout | undefined;
  let observedDateKey: string | undefined;
  let wakeBound = false;

  const syncIfDateChanged = (): void => {
    if (todayKey() === observedDateKey) {
      return;
    }
    onDateChanged();
    observedDateKey = todayKey();
  };

  const armMidnightTimer = (): void => {
    clearTimeout(midnightTimer);
    midnightTimer = setTimeout(() => {
      syncIfDateChanged();
      armMidnightTimer();
    }, msUntilNextLocalMidnight());
  };

  const onWake = (): void => {
    syncIfDateChanged();
    armMidnightTimer();
  };

  return {
    start: (initialToday: string): void => {
      clearInterval(pollTimer);
      clearTimeout(midnightTimer);
      observedDateKey = initialToday;

      pollTimer = setInterval(() => {
        syncIfDateChanged();
      }, POLL_MS);
      armMidnightTimer();

      if (!wakeBound) {
        wakeBound = true;
        powerMonitor.on("resume", onWake);
        powerMonitor.on("unlock-screen", onWake);
      }
    },
    stop: (): void => {
      clearInterval(pollTimer);
      pollTimer = undefined;
      clearTimeout(midnightTimer);
      midnightTimer = undefined;
    }
  };
};
