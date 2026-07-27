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

/**
 * 便携版安装：用 WScript 异步拉起 PowerShell EncodedCommand，再覆盖/换名。
 *
 * 踩过的坑：
 * 1) 直接 spawn powershell 再 quit → 被 Electron Job Object 杀掉
 * 2) `shell:true` + `start "" ... EncodedCommand` → Node/cmd 嵌套引号常把 start 吃掉，脚本根本不跑
 *    （表现为 pending 已下完、无 .update-portable.log、版本不变）
 * 3) 落盘 .ps1 含中文路径时，默认代码页/杀软可能拦
 * 因此：PowerShell 逻辑仍走 EncodedCommand（UTF-16 Base64，路径安全）；
 * 启动器写纯 ASCII 的 .vbs，经 wscript 异步 Run，彻底脱离作业对象。
 */
const installPortableUpdate = (): void => {
  const oldExe = process.env.PORTABLE_EXECUTABLE_FILE;
  const sourceExe = portableDownloadedFile;

  if (!oldExe || !sourceExe) {
    broadcastStatus({ state: "error", message: "未找到已下载的便携版更新文件" });
    return;
  }

  const finalExe = join(dirname(oldExe), basename(sourceExe));
  const logPath = join(dirname(oldExe), ".update-portable.log");
  /** pending 目录一般为 ASCII，适合落启动器 */
  const launcherDir = dirname(sourceExe);
  const vbsPath = join(launcherDir, ".install-portable-update.vbs");
  const removeOld =
    oldExe.toLowerCase() === finalExe.toLowerCase()
      ? ""
      : `Remove-Item -LiteralPath ${psQuote(oldExe)} -Force -ErrorAction SilentlyContinue; `;

  const psScript = [
    "$ErrorActionPreference='Stop'",
    `$log=${psQuote(logPath)}`,
    "function L($m){Add-Content -LiteralPath $log -Value ((Get-Date -Format o)+' '+$m) -Encoding UTF8}",
    "try{",
    "L 'start';",
    "Start-Sleep -Seconds 3;",
    `if(-not(Test-Path -LiteralPath ${psQuote(sourceExe)})){throw 'pending missing'};`,
    `Copy-Item -LiteralPath ${psQuote(sourceExe)} -Destination ${psQuote(finalExe)} -Force;`,
    "L 'copied';",
    removeOld,
    `Start-Process -FilePath ${psQuote(finalExe)};`,
    "L 'started'",
    `Remove-Item -LiteralPath ${psQuote(vbsPath)} -Force -ErrorAction SilentlyContinue;`,
    "}catch{L ('error: '+$_.Exception.Message); exit 1}"
  ].join(" ");

  // PowerShell -EncodedCommand 要求 UTF-16LE Base64（内容仅为 A-Za-z0-9+/=，可进 ASCII VBS）
  const encoded = Buffer.from(psScript, "utf16le").toString("base64");
  const vbs = [
    'Set sh = CreateObject("WScript.Shell")',
    // 0=隐藏窗口，False=不等待；由 WScript 创建的进程不在 Electron 作业对象内
    `sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}", 0, False`
  ].join("\r\n");

  try {
    // 主进程先落一行，区分「没点安装」与「启动器失败」
    writeFileSync(logPath, `${new Date().toISOString()} launch-requested\n`, "utf8");
    writeFileSync(vbsPath, vbs, "ascii");
  } catch (error) {
    const message = error instanceof Error ? error.message : "写入更新启动器失败";
    broadcastStatus({ state: "error", message });
    return;
  }

  const child = spawn("wscript.exe", ["//B", "//Nologo", vbsPath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();

  // 稍等 wscript 完成 CreateProcess，再退出宿主
  setTimeout(() => {
    app.quit();
  }, 1200);
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
