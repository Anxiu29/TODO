/** 应用更新状态，由主进程通过 update:status 事件推送给渲染进程 */
export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; version: string; releaseNotes: string }
  | { state: "not-available" }
  | { state: "downloading"; percent: number }
  | { state: "downloaded"; version: string }
  | { state: "error"; message: string };

/** 当前版本与是否支持应用内更新（仅打包后的生产环境为 true） */
export type AppVersionInfo = {
  currentVersion: string;
  updateSupported: boolean;
};
