/**
 * 渲染窗口共用构造项。
 *
 * Node / koffi 只在主进程；渲染走 preload + contextIsolation。
 * 必须 sandbox: false：Electron 沙箱里的 preload 不能用 ESM import，
 * 而 electron-vite 打出的是 preload.mjs，开沙箱会导致 todoApi 挂不上、透明窗像没显示。
 */
import { BrowserWindow, screen, type BrowserWindowConstructorOptions } from "electron";
import { join } from "node:path";
import { getAppIconPath } from "./appPaths";

/** preload 相对主进程打包目录 out/main/ */
const preloadPath = (): string => join(__dirname, "../preload/preload.mjs");

/** 渲染进程 webPreferences：隔离、禁止 Node；沙箱保持关闭（见文件头） */
export const rendererWebPreferences = (): Electron.WebPreferences => ({
  preload: preloadPath(),
  sandbox: false,
  contextIsolation: true,
  nodeIntegration: false
});

/**
 * 无边框透明窗的共同外观；调用方再覆盖宽高、是否置顶等。
 * webPreferences 放在 extra 之后强制写回，避免误传冲掉沙箱。
 */
export const transparentWindowOptions = (
  extra: BrowserWindowConstructorOptions
): BrowserWindowConstructorOptions => ({
  frame: false,
  transparent: true,
  backgroundColor: "#00000000",
  hasShadow: false,
  show: false,
  icon: getAppIconPath(),
  ...extra,
  webPreferences: rendererWebPreferences()
});

/** 主屏工作区居中；添加/编辑浮窗用 */
export const centeredOnPrimaryWorkArea = (width: number, height: number): { x: number; y: number; width: number; height: number } => {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    width,
    height,
    x: Math.round(area.x + area.width / 2 - width / 2),
    y: Math.round(area.y + area.height / 2 - height / 2)
  };
};

/**
 * 注册 ready-to-show / did-finish-load；返回同一揭示函数，调用方可在 load 后再挂超时兜底。
 * 三者先到先揭示，避免某一事件没来导致白屏一直藏着。
 */
export const attachRevealOnce = (window: BrowserWindow, reveal: () => void): (() => void) => {
  let revealed = false;
  const run = (): void => {
    if (revealed || window.isDestroyed()) return;
    revealed = true;
    reveal();
  };
  window.once("ready-to-show", run);
  window.webContents.once("did-finish-load", run);
  return run;
};

type AuxView = "calendar" | "settings";

/**
 * 日历/设置：已有实例则聚焦，否则按共用透明窗选项创建并揭示。
 */
export const openOrFocusAuxWindow = async (args: {
  existing: BrowserWindow | null;
  setWindow: (win: BrowserWindow | null) => void;
  view: AuxView;
  title: string;
  bounds: { width: number; height: number; minWidth: number; minHeight: number };
  load: (win: BrowserWindow, view: AuxView) => Promise<void>;
}): Promise<void> => {
  if (args.existing && !args.existing.isDestroyed()) {
    args.existing.show();
    args.existing.focus();
    return;
  }

  const win = new BrowserWindow(
    transparentWindowOptions({
      ...args.bounds,
      thickFrame: false,
      title: args.title
    })
  );
  args.setWindow(win);
  win.on("closed", () => args.setWindow(null));
  const revealOnce = attachRevealOnce(win, () => {
    if (win.isDestroyed()) return;
    win.show();
    win.focus();
  });
  await args.load(win, args.view);
  setTimeout(revealOnce, 1000);
};
