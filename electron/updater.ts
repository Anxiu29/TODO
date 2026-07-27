import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { app, BrowserWindow } from "electron";
import electronUpdater from "electron-updater";
import type { UpdateDownloadedEvent, UpdateInfo } from "electron-updater";
import type { AppVersionInfo, UpdateStatus } from "../src/types/update";

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
/** 当前更新源；检查失败时从 gitee 切到 github 一次 */
let activeFeed: "gitee" | "github" = "gitee";
/** 本轮检查是否已尝试过 GitHub 回退，避免 error 事件循环重试 */
let githubFallbackAttempted = false;

type SetupOptions = {
  /** 发现新版本且尚未提示过时调用（例如打开设置页展示更新日志） */
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

/** 解码常见 HTML 实体，避免剥标签后仍残留 &amp; 等 */
const decodeHtmlEntities = (text: string): string =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");

/**
 * GitHub Release 经 electron-updater 常为 HTML；设置页按纯文本展示，需剥标签并保留换行结构。
 */
const htmlToPlainText = (html: string): string => {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|h[1-6]|tr|table|section|blockquote)\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "• ")
    .replace(/<\s*\/\s*li\s*>/gi, "\n")
    .replace(/<\s*\/\s*(ul|ol)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  return decodeHtmlEntities(withBreaks)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
  activeFeed = feed;
  if (feed === "gitee") {
    autoUpdater.setFeedURL({ provider: "generic", url: GITEE_FEED_URL });
  } else {
    autoUpdater.setFeedURL(GITHUB_FEED);
  }
  if (isPortableApp()) {
    autoUpdater.channel = "portable";
  }
};

export const checkForUpdates = async (): Promise<UpdateStatus> => {
  if (!app.isPackaged) {
    const status: UpdateStatus = { state: "error", message: "开发模式下无法检查更新" };
    broadcastStatus(status);
    return status;
  }

  githubFallbackAttempted = false;
  applyUpdateFeed("gitee");

  try {
    broadcastStatus({ state: "checking" });
    await autoUpdater.checkForUpdates();
    return currentStatus;
  } catch {
    // Promise 拒绝时立刻回退；异步 error 事件里也会再兜一层
    if (!githubFallbackAttempted) {
      githubFallbackAttempted = true;
      applyUpdateFeed("github");
      try {
        broadcastStatus({ state: "checking" });
        await autoUpdater.checkForUpdates();
        return currentStatus;
      } catch (fallbackError) {
        const message =
          fallbackError instanceof Error ? fallbackError.message : "检查更新失败";
        const status: UpdateStatus = { state: "error", message };
        broadcastStatus(status);
        return status;
      }
    }
    const status: UpdateStatus = { state: "error", message: "检查更新失败" };
    broadcastStatus(status);
    return status;
  }
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
  if (currentStatus.state === "available") {
    promptedAvailableVersion = currentStatus.version;
  }
  const status: UpdateStatus = { state: "idle" };
  broadcastStatus(status);
  return status;
};

/** PowerShell 单引号字符串转义 */
const psQuote = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/** 路径须为可打印 ASCII，否则 Windows CMD 会把中文路径弄乱 */
const isCmdSafePath = (value: string): boolean => /^[\x20-\x7e]+$/.test(value);

/**
 * 便携版安装：写 ASCII .cmd，经 `cmd /c start` 脱离 Electron 作业对象后覆盖/换名。
 *
 * 踩过的坑：
 * 1) 直接 spawn 再 quit → 子进程被 Job Object 杀掉
 * 2) 中文文件名在 Electron 的 process.env 里会乱码（便携版→便携�?），
 *    不能把「当前 exe 完整路径」写进脚本；发版产物必须用纯 ASCII 名
 * 3) 旧版中文名迁移：只要求目录为 ASCII，用 PowerShell 按「保留新文件名、删同目录其它 exe」清理
 */
const installPortableUpdate = (): void => {
  const oldExe = process.env.PORTABLE_EXECUTABLE_FILE;
  const sourceExe = portableDownloadedFile;

  if (!oldExe || !sourceExe) {
    broadcastStatus({ state: "error", message: "未找到已下载的便携版更新文件" });
    return;
  }

  const targetDir = dirname(oldExe);
  const finalExe = join(targetDir, basename(sourceExe));
  const keepName = basename(finalExe);
  const logPath = join(targetDir, ".update-portable.log");
  const cmdPath = join(dirname(sourceExe), "install-portable-update.cmd");

  // 目录与新包路径必须 ASCII；旧 exe 文件名可含中文（不再写入 cmd）
  for (const [label, path] of [
    ["程序目录", targetDir],
    ["下载缓存", sourceExe],
    ["目标文件", finalExe],
    ["日志", logPath],
    ["启动器", cmdPath]
  ] as const) {
    if (!isCmdSafePath(path)) {
      broadcastStatus({
        state: "error",
        message: `${label}路径含非 ASCII 字符，无法自动安装。请把程序放到英文目录，或手动用新版 exe 覆盖`
      });
      return;
    }
  }

  // 清理同目录其它 exe（兼容旧中文名）；脚本内容仍全 ASCII
  const cleanupPs = [
    `$dir=${psQuote(targetDir)}`,
    `$keep=${psQuote(keepName)}`,
    "Get-ChildItem -LiteralPath $dir -Filter '*.exe' |",
    "Where-Object { $_.Name -ne $keep } |",
    "Remove-Item -Force -ErrorAction SilentlyContinue"
  ].join(" ");
  const cleanupEncoded = Buffer.from(cleanupPs, "utf16le").toString("base64");

  const cmdBody = [
    "@echo off",
    "setlocal",
    `echo %date% %time% start>>"${logPath}"`,
    // ping 延时，等宿主退出并释放 exe 文件锁
    "ping -n 4 127.0.0.1 >nul",
    `if not exist "${sourceExe}" (echo pending missing>>"${logPath}" & exit /b 1)`,
    `copy /Y "${sourceExe}" "${finalExe}" >nul`,
    `if errorlevel 1 (echo copy failed>>"${logPath}" & exit /b 1)`,
    `echo copied>>"${logPath}"`,
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${cleanupEncoded}`,
    `echo cleaned>>"${logPath}"`,
    `start "" "${finalExe}"`,
    `echo started>>"${logPath}"`,
    'del /F /Q "%~f0" 2>nul',
    ""
  ].join("\r\n");

  try {
    writeFileSync(logPath, `${new Date().toISOString()} launch-requested\n`, "utf8");
    writeFileSync(cmdPath, cmdBody, "ascii");
  } catch (error) {
    const message = error instanceof Error ? error.message : "写入更新启动器失败";
    broadcastStatus({ state: "error", message });
    return;
  }

  // start 开新控制台会话，避免随 Electron 作业对象一起被杀
  spawn(process.env.ComSpec || "cmd.exe", ["/c", "start", "", "/min", cmdPath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  }).unref();

  setTimeout(() => {
    app.quit();
  }, 1500);
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
    // 仅在「检查」阶段从 Gitee 回退；下载失败不自动换源，避免状态错乱
    if (
      activeFeed === "gitee" &&
      !githubFallbackAttempted &&
      currentStatus.state === "checking"
    ) {
      githubFallbackAttempted = true;
      console.warn(`Gitee 检查更新失败，回退 GitHub: ${error.message}`);
      applyUpdateFeed("github");
      void autoUpdater.checkForUpdates().catch((fallbackError: unknown) => {
        const message =
          fallbackError instanceof Error ? fallbackError.message : error.message;
        broadcastStatus({ state: "error", message });
      });
      return;
    }
    broadcastStatus({ state: "error", message: error.message });
  });

  setTimeout(() => {
    void checkForUpdates();
  }, 5000);
};
