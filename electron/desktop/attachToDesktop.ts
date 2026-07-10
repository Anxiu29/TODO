/**
 * Windows 桌面窗口附着模块。
 *
 * 原理：Windows 桌面由 Progman → WorkerW → SHELLDLL_DefView 层级构成。
 * 将 Electron 窗口 SetParent 到 WorkerW 后，窗口会显示在壁纸之上、桌面图标之下，
 * 实现「嵌入桌面」的挂件效果。
 *
 * 注意：只能挂到 sibling WorkerW，不能回退到 Progman（会导致黑边且无法点击）。
 *
 * 依赖 koffi 调用 user32.dll / kernel32.dll，仅 win32 平台有效。
 */
import koffi from "koffi";
import type { BrowserWindow } from "electron";

/** 加载 Windows 用户界面与内核 API 动态库 */
const user32 = koffi.load("user32.dll");
const kernel32 = koffi.load("kernel32.dll");
const gdi32 = koffi.load("gdi32.dll");

/** HWND 在 koffi 中映射为 void* 指针 */
const HWND = koffi.alias("HWND", "void *");
const HRGN = koffi.alias("HRGN", "void *");
type Hwnd = object | null;

/** 按类名/标题查找顶层窗口，Progman 即 Program Manager 桌面容器 */
const FindWindowW = user32.func("HWND __stdcall FindWindowW(str16 _lpClassName, str16 _lpWindowName)");
/** 在父窗口子窗口链中查找下一个匹配窗口，用于遍历 WorkerW 列表 */
const FindWindowExW = user32.func(
  "HWND __stdcall FindWindowExW(HWND hWndParent, HWND hWndChildAfter, str16 lpszClass, str16 lpszWindow)"
);
/** 改变窗口父级；hWndNewParent 为 null 时恢复为桌面顶层窗口 */
const SetParent = user32.func("HWND __stdcall SetParent(HWND hWndChild, HWND hWndNewParent)");
/** 控制窗口显示状态；SW_SHOWNA(8) = 显示但不激活、不抢焦点 */
const ShowWindow = user32.func("int __stdcall ShowWindow(HWND hWnd, int nCmdShow)");
/** SetParent 失败时读取 Win32 错误码 */
const GetLastError = kernel32.func("uint32 __stdcall GetLastError()");
/** SetParent 前清空旧错误码，避免成功调用被之前 API 的错误误判为失败 */
const SetLastError = kernel32.func("void __stdcall SetLastError(uint32 dwErrCode)");
/** 带超时的 SendMessage，避免 Explorer 无响应时阻塞主进程 */
const SendMessageTimeoutW = user32.func(
  "uintptr_t __stdcall SendMessageTimeoutW(HWND hWnd, uint32 Msg, uintptr_t wParam, intptr_t lParam, uint32 fuFlags, uint32 uTimeout, _Out_ uintptr_t *lpdwResult)"
);
const SetWindowPos = user32.func(
  "int __stdcall SetWindowPos(HWND hWnd, HWND hWndInsertAfter, int X, int Y, int cx, int cy, uint32 uFlags)"
);
const SetWindowRgn = user32.func("int __stdcall SetWindowRgn(HWND hWnd, HRGN hRgn, int bRedraw)");
const CreateRoundRectRgn = gdi32.func("HRGN __stdcall CreateRoundRectRgn(int left, int top, int right, int bottom, int w, int h)");

/** 向 Progman 发送此消息会创建承载桌面图标的 WorkerW 层（Windows 10/11 通用技巧） */
const WM_SPAWN_WORKER = 0x052c;
const SW_SHOWNA = 8;
const SWP_NOACTIVATE = 0x0010;
const SWP_NOSENDCHANGING = 0x0400;
const SWP_SHOWWINDOW = 0x0040;
const HWND_TOP = null;

/** 从 Electron BrowserWindow 取出原生 HWND 句柄 */
const readHwnd = (window: BrowserWindow): Hwnd => {
  const handle = window.getNativeWindowHandle();
  return koffi.decode(handle, HWND);
};

/**
 * 查找承载桌面图标的 sibling WorkerW 窗口。
 *
 * 只返回 sibling WorkerW；找不到则返回 null（不回退 Progman，避免黑边）。
 */
const findDesktopWorkerW = (): Hwnd => {
  const progman = FindWindowW("Progman", null);
  if (!progman) {
    return null;
  }

  const resultPtr = koffi.alloc("uintptr_t", 1);
  SendMessageTimeoutW(progman, WM_SPAWN_WORKER, 0, 0, 0, 1000, resultPtr);
  koffi.free(resultPtr);

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

/** 用圆角区域裁剪窗口，减少透明窗口在桌面层上的黑边。 */
export const refreshDesktopWindowRegion = (window: BrowserWindow, radius = 28): void => {
  try {
    const targetHwnd = readHwnd(window);
    const { width, height } = window.getBounds();
    const region = CreateRoundRectRgn(0, 0, width + 1, height + 1, radius, radius);
    SetWindowRgn(targetHwnd, region, 1);
  } catch {
    // 裁剪失败不影响主流程
  }
};

/** 清除窗口区域裁剪，恢复普通矩形窗口。 */
const clearWindowRegion = (window: BrowserWindow): void => {
  try {
    const targetHwnd = readHwnd(window);
    SetWindowRgn(targetHwnd, null, 1);
  } catch {
    // ignore
  }
};

/** 探测当前环境是否支持桌面固定（WorkerW 是否可用）。 */
export const isDesktopHostAvailable = (): boolean => process.platform === "win32" && findDesktopWorkerW() !== null;

/** 将窗口从桌面 WorkerW 恢复为普通顶层窗口（切换悬浮模式前必须调用） */
export const detachWindowFromDesktop = (window: BrowserWindow): boolean => {
  if (process.platform !== "win32") {
    return false;
  }

  try {
    const targetHwnd = readHwnd(window);
    SetParent(targetHwnd, null);
    clearWindowRegion(window);
    return true;
  } catch {
    return false;
  }
};

/**
 * 将 Electron 窗口设为桌面 WorkerW 的子窗口。
 *
 * 调用前先 detach 避免重复 SetParent；成功后用 SW_SHOWNA 显示且不抢焦点。
 * Explorer 未就绪时可能失败，主进程会降级为普通窗口。
 */
export const attachWindowToDesktop = async (window: BrowserWindow): Promise<boolean> => {
  if (process.platform !== "win32") {
    return false;
  }

  try {
    const targetHwnd = readHwnd(window);
    detachWindowFromDesktop(window);

    const workerw = findDesktopWorkerW();
    if (!workerw) {
      return false;
    }

    SetLastError(0);
    const previousParent = SetParent(targetHwnd, workerw);
    const lastError = GetLastError();
    if (!previousParent && lastError !== 0) {
      return false;
    }

    const bounds = window.getBounds();
    SetWindowPos(
      targetHwnd,
      HWND_TOP,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      SWP_NOACTIVATE | SWP_NOSENDCHANGING | SWP_SHOWWINDOW
    );
    refreshDesktopWindowRegion(window);
    ShowWindow(targetHwnd, SW_SHOWNA);
    return true;
  } catch {
    return false;
  }
};
