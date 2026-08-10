/**
 * Windows 桌面窗口附着模块。
 *
 * 两条路径：
 * 1) setparent：挂到顶层 sibling WorkerW（壁纸软件/旧系统常见）。挂件在图标下，Win+D 仍在。
 * 2) owner：把窗口 Owner 设为 SHELLDLL_DefView（不 SetParent）。
 *    Win11 24H2 系统壁纸下 WorkerW 在 DefView 之下，SetParent(WorkerW) 会「看得见点不到」；
 *    Owner=DefView 可保持可点击，且 Show Desktop / Win+D 后仍显示。
 */
import koffi from "koffi";
import type { BrowserWindow } from "electron";

const user32 = koffi.load("user32.dll");
const kernel32 = koffi.load("kernel32.dll");

const HWND = koffi.alias("HWND", "void *");
type Hwnd = object | null;

export type DesktopAttachHost = "workerw-sibling" | "defview-owner";
export type DesktopAttachStrategy = "wallpaper-app" | "system";

type AttachTarget = {
  host: DesktopAttachHost;
  /** setparent 时为 WorkerW；owner 时为 SHELLDLL_DefView */
  hwnd: Hwnd;
  method: "setparent" | "owner";
};

const FindWindowW = user32.func("HWND __stdcall FindWindowW(str16 _lpClassName, str16 _lpWindowName)");
const FindWindowExW = user32.func(
  "HWND __stdcall FindWindowExW(HWND hWndParent, HWND hWndChildAfter, str16 lpszClass, str16 lpszWindow)"
);
const GetParent = user32.func("HWND __stdcall GetParent(HWND hWnd)");
const GetWindow = user32.func("HWND __stdcall GetWindow(HWND hWnd, uint32 uCmd)");
const SetParent = user32.func("HWND __stdcall SetParent(HWND hWndChild, HWND hWndNewParent)");
const ShowWindow = user32.func("int __stdcall ShowWindow(HWND hWnd, int nCmdShow)");
const GetWindowLongPtrW = user32.func("intptr_t __stdcall GetWindowLongPtrW(HWND hWnd, int nIndex)");
const SetWindowLongPtrW = user32.func("intptr_t __stdcall SetWindowLongPtrW(HWND hWnd, int nIndex, intptr_t dwNewLong)");
const GetLastError = kernel32.func("uint32 __stdcall GetLastError()");
const SetLastError = kernel32.func("void __stdcall SetLastError(uint32 dwErrCode)");
const SendMessageTimeoutW = user32.func(
  "uintptr_t __stdcall SendMessageTimeoutW(HWND hWnd, uint32 Msg, uintptr_t wParam, intptr_t lParam, uint32 fuFlags, uint32 uTimeout, _Out_ uintptr_t *lpdwResult)"
);

const WM_SPAWN_WORKER = 0x052c;
const SW_SHOWNA = 8;
const GW_OWNER = 4;
/** 对顶层窗口设置 Owner（文档名含 PARENT，实际改的是 owner） */
const GWLP_HWNDPARENT = -8;
const GWL_EXSTYLE = -20;
const WS_EX_LAYERED = 0x00080000;
const WS_EX_TRANSPARENT = 0x00000020;
const WS_EX_TOOLWINDOW = 0x00000080;
const SYSTEM_SPAWN_VARIANTS: Array<[number, number]> = [
  [0, 0],
  [0xd, 0],
  [0xd, 1]
];

const readHwnd = (window: BrowserWindow): Hwnd => {
  const handle = window.getNativeWindowHandle();
  return koffi.decode(handle, HWND);
};

const hwndToPtr = (hwnd: Hwnd): number | bigint => {
  if (!hwnd) {
    return 0;
  }
  return koffi.address(hwnd);
};

const isSameHwnd = (left: Hwnd, right: Hwnd): boolean => {
  if (!left || !right) {
    return false;
  }
  try {
    return koffi.address(left) === koffi.address(right);
  } catch {
    return left === right;
  }
};

const spawnDesktopWorker = (progman: Hwnd, wParam: number, lParam: number): void => {
  const resultPtr = koffi.alloc("uintptr_t", 1);
  SendMessageTimeoutW(progman, WM_SPAWN_WORKER, wParam, lParam, 0, 1000, resultPtr);
  koffi.free(resultPtr);
};

const spawnWorkersForStrategy = (progman: Hwnd, strategy: DesktopAttachStrategy): void => {
  if (strategy === "wallpaper-app") {
    spawnDesktopWorker(progman, 0, 0);
    spawnDesktopWorker(progman, 0xd, 0);
    return;
  }

  for (const [wParam, lParam] of SYSTEM_SPAWN_VARIANTS) {
    spawnDesktopWorker(progman, wParam, lParam);
  }
};

/** 经典：含 DefView 的 WorkerW 之后的 sibling 壁纸层 */
const findSiblingWorkerW = (): Hwnd => {
  let current: Hwnd = null;
  while (true) {
    current = FindWindowExW(null, current, "WorkerW", null);
    if (!current) {
      break;
    }

    const shellView = FindWindowExW(current, null, "SHELLDLL_DefView", null);
    if (shellView) {
      return FindWindowExW(null, current, "WorkerW", null);
    }
  }

  return null;
};

/** 在 Progman 或各 WorkerW 下查找 SHELLDLL_DefView */
const findShellDefView = (): Hwnd => {
  const progman = FindWindowW("Progman", null);
  if (progman) {
    const underProgman = FindWindowExW(progman, null, "SHELLDLL_DefView", null);
    if (underProgman) {
      return underProgman;
    }
  }

  let worker: Hwnd = null;
  while (true) {
    worker = FindWindowExW(null, worker, "WorkerW", null);
    if (!worker) {
      break;
    }
    const defView = FindWindowExW(worker, null, "SHELLDLL_DefView", null);
    if (defView) {
      return defView;
    }
  }

  return null;
};

const findDesktopAttachTarget = (strategy: DesktopAttachStrategy): AttachTarget | null => {
  const progman = FindWindowW("Progman", null);
  if (!progman) {
    return null;
  }

  const resolve = (): AttachTarget | null => {
    // 壁纸软件：优先经典 sibling WorkerW（SetParent）
    if (strategy === "wallpaper-app") {
      const sibling = findSiblingWorkerW();
      if (sibling) {
        return { host: "workerw-sibling", hwnd: sibling, method: "setparent" };
      }
    }

    // 系统壁纸 / Win11 24H2：Owner=DefView，保证可点击
    const defView = findShellDefView();
    if (defView) {
      return { host: "defview-owner", hwnd: defView, method: "owner" };
    }

    // 系统策略下若仍有 sibling，再退回 SetParent
    const sibling = findSiblingWorkerW();
    if (sibling) {
      return { host: "workerw-sibling", hwnd: sibling, method: "setparent" };
    }

    return null;
  };

  if (strategy === "wallpaper-app") {
    const existing = resolve();
    if (existing) {
      return existing;
    }
  }

  spawnWorkersForStrategy(progman, strategy);
  return resolve();
};

/** 可点击：分层窗 + 去掉穿透；工具窗避免多余任务栏按钮 */
const ensureInteractiveWindowStyle = (hwnd: Hwnd): void => {
  const exStyle = Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
  const next = (exStyle | WS_EX_LAYERED | WS_EX_TOOLWINDOW) & ~WS_EX_TRANSPARENT;
  if (next !== exStyle) {
    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next);
  }
};

const clearDesktopOwner = (hwnd: Hwnd): void => {
  SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, 0);
};

const setDesktopOwner = (hwnd: Hwnd, owner: Hwnd): boolean => {
  SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, hwndToPtr(owner));
  return isSameHwnd(GetWindow(hwnd, GW_OWNER), owner);
};

export const isDesktopHostAvailable = (): boolean => process.platform === "win32" && FindWindowW("Progman", null) !== null;

export const isWindowDesktopAttached = (window: BrowserWindow): boolean => {
  if (process.platform !== "win32") {
    return false;
  }

  try {
    const hwnd = readHwnd(window);
    const parent = GetParent(hwnd);
    if (parent) {
      return true;
    }

    const owner = GetWindow(hwnd, GW_OWNER);
    if (!owner) {
      return false;
    }

    // Owner 是否为当前桌面 DefView
    const defView = findShellDefView();
    return Boolean(defView && isSameHwnd(owner, defView));
  } catch {
    return false;
  }
};

export const detachWindowFromDesktop = (window: BrowserWindow): boolean => {
  if (process.platform !== "win32") {
    return false;
  }

  try {
    const hwnd = readHwnd(window);
    clearDesktopOwner(hwnd);
    SetParent(hwnd, null);
    return true;
  } catch {
    return false;
  }
};

/** 已附着时同步尺寸/位置 */
export const syncDesktopWindowBounds = (window: BrowserWindow): void => {
  if (!isWindowDesktopAttached(window)) {
    return;
  }

  const bounds = window.getBounds();
  window.setBounds(bounds);
  ShowWindow(readHwnd(window), SW_SHOWNA);
};

/**
 * Owner 模式下窗口本身可点，此处主要用于清穿透样式。
 * 保留导出供 main 在 wake 时调用。
 */
export const raiseDesktopWidgetForInput = (window: BrowserWindow): void => {
  if (process.platform !== "win32") {
    return;
  }

  try {
    const hwnd = readHwnd(window);
    ensureInteractiveWindowStyle(hwnd);
    window.setIgnoreMouseEvents(false);
    ShowWindow(hwnd, SW_SHOWNA);
  } catch {
    // ignore
  }
};

export type DesktopAttachResult = {
  ok: boolean;
  changed: boolean;
  host?: DesktopAttachHost;
};

export const attachWindowToDesktop = async (
  window: BrowserWindow,
  strategy: DesktopAttachStrategy = "system"
): Promise<DesktopAttachResult> => {
  if (process.platform !== "win32") {
    return { ok: false, changed: false };
  }

  try {
    const targetHwnd = readHwnd(window);
    const bounds = window.getBounds();
    const target = findDesktopAttachTarget(strategy);
    if (!target?.hwnd) {
      return { ok: false, changed: false };
    }

    // 已用同一方式附着则跳过
    if (target.method === "setparent") {
      const currentParent = GetParent(targetHwnd);
      if (isSameHwnd(currentParent, target.hwnd)) {
        ensureInteractiveWindowStyle(targetHwnd);
        return { ok: true, changed: false, host: target.host };
      }
    } else {
      const currentOwner = GetWindow(targetHwnd, GW_OWNER);
      if (isSameHwnd(currentOwner, target.hwnd) && !GetParent(targetHwnd)) {
        ensureInteractiveWindowStyle(targetHwnd);
        return { ok: true, changed: false, host: target.host };
      }
    }

    detachWindowFromDesktop(window);
    ensureInteractiveWindowStyle(targetHwnd);
    window.setIgnoreMouseEvents(false);

    if (target.method === "setparent") {
      SetLastError(0);
      const previousParent = SetParent(targetHwnd, target.hwnd);
      const lastError = GetLastError();
      if (!previousParent && lastError !== 0) {
        return { ok: false, changed: false };
      }
    } else {
      // Owner=DefView：保持顶层窗，可点击，且跟桌面一起不响应 Win+D 收起
      if (!setDesktopOwner(targetHwnd, target.hwnd)) {
        return { ok: false, changed: false };
      }
    }

    window.setBounds(bounds);
    ShowWindow(targetHwnd, SW_SHOWNA);
    return { ok: true, changed: true, host: target.host };
  } catch {
    return { ok: false, changed: false };
  }
};
