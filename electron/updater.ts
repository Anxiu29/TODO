import { mkdtempSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { buildPortableInstallScript, preparePortableInstall } from "./portableUpdate";
import { app, BrowserWindow } from "electron";
import electronUpdater from "electron-updater";
import type { UpdateDownloadedEvent, UpdateInfo } from "electron-updater";
import type { AppVersionInfo, UpdateStatus } from "../src/types/update";
import { htmlToPlainText } from "../src/updateNotes";

const { autoUpdater } = electronUpdater;

/** 国内优先：Gitee latest 浮动发行版；失败再回退 GitHub */
const GITEE_FEED_URL = "https://gitee.com/anxiu29/TODO/releases/download/latest";
const GITHUB_FEED = {
  provider: "github" as const,
  owner: "Anxiu29",
  repo: "TODO"
};

let currentStatus: UpdateStatus = { state: "idle" };
let portableDownloadedFile: string | null = null;
/** 同一版本只自动打开一次设置页，避免反复打扰 */
let promptedAvailableVersion: string | null = null;
/** 检查共享同一个 Promise，避免重复点击或事件回调并发切换更新源。 */
let checkInFlight: Promise<UpdateStatus> | undefined;

type SetupOptions = {
  /** 发现新版本且尚未提示过时调用；不要在这里弹窗（开机自启会挡桌面） */
  onUpdateAvailable?: (version: string) => void;
};

const isPortableApp = (): boolean =>
  !!process.env.PORTABLE_EXECUTABLE_DIR && !!process.env.PORTABLE_EXECUTABLE_FILE;

const broadcastStatus = (status: UpdateStatus): void => {
  currentStatus = status;
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("update:status", status);
  }
};

/** 将 electron-updater 的 releaseNotes 规范为纯文本（剥掉 HTML） */
const normalizeReleaseNotes = (notes: UpdateInfo["releaseNotes"]): string => {
  if (!notes) return "";
  if (typeof notes === "string") return htmlToPlainText(notes);
  return notes
    .map((item) => {
      const body = htmlToPlainText(item.note ?? "");
      if (!body) return "";
      return `v${item.version}\n${body}`;
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
};

export const getAppVersionInfo = (): AppVersionInfo => ({
  currentVersion: app.getVersion(),
  updateSupported: app.isPackaged
});

export const getUpdateStatus = (): UpdateStatus => currentStatus;

/** 切换更新源；setFeedURL 后需重新设 channel，否则便携版可能读错 yml */
const applyUpdateFeed = (feed: "gitee" | "github"): void => {
  if (feed === "gitee") {
    autoUpdater.setFeedURL({ provider: "generic", url: GITEE_FEED_URL });
  } else {
    autoUpdater.setFeedURL(GITHUB_FEED);
  }
  if (isPortableApp()) {
    autoUpdater.channel = "portable";
  }
};

/** 一次检查按顺序尝试两个源；只由 Promise 失败驱动回退。 */
const runUpdateCheck = async (): Promise<UpdateStatus> => {
  for (const feed of ["gitee", "github"] as const) {
    try {
      applyUpdateFeed(feed);
      broadcastStatus({ state: "checking" });
      await autoUpdater.checkForUpdates();
      return currentStatus;
    } catch (error) {
      if (feed === "github") broadcastStatus({ state: "error", message: error instanceof Error ? error.message : "检查更新失败" });
    }
  }
  return currentStatus;
};

/** 检查期间复用请求，下载中或已下载时保留安装状态。 */
export const checkForUpdates = (): Promise<UpdateStatus> => {
  if (!app.isPackaged) {
    const status: UpdateStatus = { state: "error", message: "开发模式下无法检查更新" };
    broadcastStatus(status);
    return Promise.resolve(status);
  }
  if (checkInFlight) return checkInFlight;
  if (currentStatus.state === "downloading" || currentStatus.state === "downloaded") return Promise.resolve(currentStatus);
  checkInFlight = Promise.resolve().then(runUpdateCheck).finally(() => { checkInFlight = undefined; });
  return checkInFlight;
};

/** 用户确认后再下载；需先处于 available 状态 */
export const downloadUpdate = async (): Promise<UpdateStatus> => {
  if (!app.isPackaged) {
    const status: UpdateStatus = { state: "error", message: "开发模式下无法下载更新" };
    broadcastStatus(status);
    return status;
  }

  if (currentStatus.state !== "available") {
    return currentStatus;
  }

  try {
    broadcastStatus({ state: "downloading", percent: 0 });
    await autoUpdater.downloadUpdate();
    return currentStatus;
  } catch (error) {
    const message = error instanceof Error ? error.message : "下载更新失败";
    const status: UpdateStatus = { state: "error", message };
    broadcastStatus(status);
    return status;
  }
};

/** 用户选择稍后：保留版本信息但清空日志打扰，回到 idle */
export const dismissUpdate = (): UpdateStatus => {
  // 稍后仅关闭可用更新提示，不能清掉正在下载或等待安装的状态。
  if (currentStatus.state !== "available") return currentStatus;
  if (currentStatus.state === "available") {
    promptedAvailableVersion = currentStatus.version;
  }
  const status: UpdateStatus = { state: "idle" };
  broadcastStatus(status);
  return status;
};

/** 路径须为可打印 ASCII；VBS/环境变量对非 ASCII 文件名不可靠 */
const isCmdSafePath = (value: string): boolean => /^[\x20-\x7e]+$/.test(value);

/** 避免多次点击同时启动多个安装脚本。 */
let portableInstalling = false;

/** 先复制并等待脚本就绪再退出；任何准备失败都保留当前程序和旧版 exe。 */
const installPortableUpdate = async (): Promise<void> => {
  if (portableInstalling) return;
  const oldExe = process.env.PORTABLE_EXECUTABLE_FILE;
  const sourceExe = portableDownloadedFile;
  if (!oldExe || !sourceExe || currentStatus.state !== "downloaded") {
    broadcastStatus({ state: "error", message: "请先完成新版下载" });
    return;
  }
  portableInstalling = true;
  try {
    const target = join(dirname(oldExe), basename(sourceExe));
    // 相同文件名不能覆盖正在使用的旧版，确保始终可以回退。
    if (resolve(target).toLowerCase() === resolve(oldExe).toLowerCase()) {
      throw new Error("新版与旧版文件名相同，请手动安装；旧版未改动。");
    }
    if (![sourceExe, target, oldExe].every(isCmdSafePath)) {
      throw new Error("路径含非 ASCII 字符，请手动安装新版；旧版未改动。");
    }
    const work = mkdtempSync(join(dirname(sourceExe), "install-"));
    const paths = {
      source: sourceExe, target, oldExe,
      processId: process.pid,
      script: join(work, "install.vbs"), log: join(dirname(oldExe), ".update-portable.log"),
      ready: join(work, "ready"), proceed: join(work, "proceed")
    };
    writeFileSync(paths.script, buildPortableInstallScript(paths), "ascii");
    await preparePortableInstall(paths);
    app.quit();
  } catch (error) {
    broadcastStatus({ state: "error", message: error instanceof Error ? error.message : "更新安装准备失败" });
  } finally {
    portableInstalling = false;
  }
};

export const quitAndInstallUpdate = (): void => {
  if (!app.isPackaged) return;

  if (isPortableApp()) {
    void installPortableUpdate();
    return;
  }

  autoUpdater.quitAndInstall();
};

/** 注册 autoUpdater 事件，并在启动后延迟检查更新。 */
export const setupAutoUpdater = (options: SetupOptions = {}): void => {
  if (!app.isPackaged) return;

  if (isPortableApp()) {
    // 便携版读 portable.yml，避免误下 NSIS 安装包（latest.yml）
    autoUpdater.autoInstallOnAppQuit = false;
  }

  // 默认走 Gitee；检查失败再回退 GitHub
  applyUpdateFeed("gitee");

  // 发现更新后先展示日志，由用户决定是否下载
  autoUpdater.autoDownload = false;

  autoUpdater.on("checking-for-update", () => {
    broadcastStatus({ state: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    const version = info.version;
    const releaseNotes = normalizeReleaseNotes(info.releaseNotes);
    broadcastStatus({ state: "available", version, releaseNotes });

    if (promptedAvailableVersion !== version) {
      promptedAvailableVersion = version;
      options.onUpdateAvailable?.(version);
    }
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
    // 检查中的错误交给 runUpdateCheck；事件里再次检查会抢占库内部尚未结束的 Promise。
    if (checkInFlight) return;
    broadcastStatus({ state: "error", message: error.message });
  });

  setTimeout(() => {
    void checkForUpdates();
  }, 5000);
};
