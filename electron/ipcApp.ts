/**
 * app:* IPC：版本、更新、退出、白名单外链。
 * 与待办/设置拆开；openExternal 只放行发行页。
 */
import { app, ipcMain, shell } from "electron";
import { ALLOWED_EXTERNAL_URLS } from "../src/constants/projectLinks";
import {
  checkForUpdates,
  dismissUpdate,
  downloadUpdate,
  getAppVersionInfo,
  getUpdateStatus,
  quitAndInstallUpdate
} from "./updater";

/** 注册 app:* 通道 */
export const registerAppIpc = (): void => {
  ipcMain.handle("app:quit", () => app.quit());
  ipcMain.handle("app:getVersion", () => getAppVersionInfo());
  ipcMain.handle("app:getUpdateStatus", () => getUpdateStatus());
  ipcMain.handle("app:checkForUpdates", () => checkForUpdates());
  ipcMain.handle("app:downloadUpdate", () => downloadUpdate());
  ipcMain.handle("app:dismissUpdate", () => dismissUpdate());
  ipcMain.handle("app:quitAndInstall", () => quitAndInstallUpdate());
  /** 仅允许打开白名单发行页（GitHub / Gitee），用系统浏览器下载最新版 */
  ipcMain.handle("app:openExternal", async (_event, url: unknown) => {
    if (typeof url !== "string" || !ALLOWED_EXTERNAL_URLS.has(url)) {
      throw new Error("不允许打开该链接");
    }
    await shell.openExternal(url);
  });
};
