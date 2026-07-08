import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app, BrowserWindow } from "electron";
import electronUpdater from "electron-updater";
import type { UpdateDownloadedEvent } from "electron-updater";
import type { AppVersionInfo, UpdateStatus } from "../src/types/update";

const { autoUpdater } = electronUpdater;

let currentStatus: UpdateStatus = { state: "idle" };
let portableDownloadedFile: string | null = null;

const isPortableApp = (): boolean =>
  !!process.env.PORTABLE_EXECUTABLE_DIR && !!process.env.PORTABLE_EXECUTABLE_FILE;

const broadcastStatus = (status: UpdateStatus): void => {
  currentStatus = status;
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("update:status", status);
  }
};

export const getAppVersionInfo = (): AppVersionInfo => ({
  currentVersion: app.getVersion(),
  updateSupported: app.isPackaged
});

export const getUpdateStatus = (): UpdateStatus => currentStatus;

export const checkForUpdates = async (): Promise<UpdateStatus> => {
  if (!app.isPackaged) {
    const status: UpdateStatus = { state: "error", message: "开发模式下无法检查更新" };
    broadcastStatus(status);
    return status;
  }

  try {
    broadcastStatus({ state: "checking" });
    await autoUpdater.checkForUpdates();
    return currentStatus;
  } catch (error) {
    const message = error instanceof Error ? error.message : "检查更新失败";
    const status: UpdateStatus = { state: "error", message };
    broadcastStatus(status);
    return status;
  }
};

const installPortableUpdate = (): void => {
  const targetExe = process.env.PORTABLE_EXECUTABLE_FILE;
  const sourceExe = portableDownloadedFile;

  if (!targetExe || !sourceExe) {
    broadcastStatus({ state: "error", message: "未找到已下载的便携版更新文件" });
    return;
  }

  const updaterScript = join(dirname(targetExe), ".update-portable.cmd");
  const script = [
    "@echo off",
    "timeout /t 2 /nobreak >nul",
    `copy /y "${sourceExe}" "${targetExe}"`,
    `start "" "${targetExe}"`,
    "del \"%~f0\""
  ].join("\r\n");

  writeFileSync(updaterScript, script, "utf8");
  spawn("cmd.exe", ["/c", updaterScript], { detached: true, stdio: "ignore" }).unref();
  app.quit();
};

export const quitAndInstallUpdate = (): void => {
  if (!app.isPackaged) return;

  if (isPortableApp()) {
    installPortableUpdate();
    return;
  }

  autoUpdater.quitAndInstall();
};

/** 注册 autoUpdater 事件，并在启动后延迟检查更新。 */
export const setupAutoUpdater = (): void => {
  if (!app.isPackaged) return;

  if (isPortableApp()) {
    // 便携版读 portable.yml，避免误下 NSIS 安装包（latest.yml）
    autoUpdater.channel = "portable";
    autoUpdater.autoInstallOnAppQuit = false;
  }

  autoUpdater.autoDownload = true;

  autoUpdater.on("checking-for-update", () => {
    broadcastStatus({ state: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    broadcastStatus({ state: "available", version: info.version });
  });

  autoUpdater.on("update-not-available", () => {
    broadcastStatus({ state: "not-available" });
  });

  autoUpdater.on("download-progress", (progress) => {
    broadcastStatus({ state: "downloading", percent: progress.percent });
  });

  autoUpdater.on("update-downloaded", (info: UpdateDownloadedEvent) => {
    if (isPortableApp()) {
      portableDownloadedFile = info.downloadedFile;
    }
    broadcastStatus({ state: "downloaded", version: info.version });
  });

  autoUpdater.on("error", (error) => {
    broadcastStatus({ state: "error", message: error.message });
  });

  setTimeout(() => {
    void checkForUpdates();
  }, 5000);
};
