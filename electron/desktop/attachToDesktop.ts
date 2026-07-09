/**
 * Windows 桌面窗口附着模块。
 *
 * 原理：Windows 桌面由 Progman → WorkerW → SHELLDLL_DefView 层级构成。
 * 将 Electron 窗口 SetParent 到 WorkerW 后，窗口会显示在壁纸之上、桌面图标之下，
 * 实现「嵌入桌面」的挂件效果。
 *
 * 依赖 koffi 调用 user32.dll / kernel32.dll，仅 win32 平台有效。
 */
import koffi from "koffi";
import type { BrowserWindow } from "electron";

/** 加载 Windows 用户界面与内核 API 动态库 */
const user32 = koffi.load("user32.dll");
const kernel32 = koffi.load("kernel32.dll");

/** HWND 在 koffi 中映射为 void* 指针 */
const HWND = koffi.alias("HWND", "void *");
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
/** 带超时的 SendMessage，避免 Explorer 无响应时阻塞主进程 */
const SendMessageTimeoutW = user32.func(
  "uintptr_t __stdcall SendMessageTimeoutW(HWND hWnd, uint32 Msg, uintptr_t wParam, intptr_t lParam, uint32 fuFlags, uint32 uTimeout, _Out_ uintptr_t *lpdwResult)"
);

/** 向 Progman 发送此消息会创建承载桌面图标的 WorkerW 层（Windows 10/11 通用技巧） */
const WM_SPAWN_WORKER = 0x052c;
const SW_SHOWNA = 8;

/** 从 Electron BrowserWindow 取出原生 HWND 句柄 */
const readHwnd = (window: BrowserWindow): Hwnd => {
  const handle = window.getNativeWindowHandle();
  return koffi.decode(handle, HWND);
};

/**
 * 查找承载桌面图标的 WorkerW 窗口。
 *
 * 步骤：
 * 1. 找到 Progman 窗口
 * 2. 发送 WM_SPAWN_WORKER 确保 WorkerW 存在
 * 3. 遍历所有 WorkerW，找到内含 SHELLDLL_DefView（桌面图标视图）的那个
 * 4. 返回其 sibling WorkerW；找不到则返回 null（不再回退到 Progman，避免可见但无法点击）
 */
const findDesktopWorkerW = (): Hwnd => {
  const progman = FindWindowW("Progman", null);
  if (!progman) {
    return null;
  }

  const resultPtr = koffi.alloc("uintptr_t", 1);
  SendMessageTimeoutW(progman, WM_SPAWN_WORKER, 0, 0, 0, 1000, resultPtr);
  koffi.free(resultPtr);

  let workerw: Hwnd = null;
  let current: Hwnd = null;

  while (true) {
    current = FindWindowExW(null, current, "WorkerW", null);
    if (!current) {
      break;
    }

    const shellView = FindWindowExW(current, null, "SHELLDLL_DefView", null);
    if (shellView) {
      workerw = FindWindowExW(null, current, "WorkerW", null);
      break;
    }
  }

  return workerw;
};

/** 将窗口从桌面 WorkerW 恢复为普通顶层窗口（切换悬浮模式前必须调用） */
export const detachWindowFromDesktop = (window: BrowserWindow): boolean => {
  if (process.platform !== "win32") {
    return false;
  }

  try {
    const targetHwnd = readHwnd(window);
    SetParent(targetHwnd, null);
    return true;
  } catch {
    return false;
  }
};

/**
 * 将 Electron 窗口设为桌面 WorkerW 的子窗口。
 *
 * 调用前先 detach 避免重复 SetParent；成功后用 SW_SHOWNA 显示且不抢焦点。
 * Explorer 未就绪时可能失败，主进程会通过 scheduleDesktopAttachRetries 重试。
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

    const previousParent = SetParent(targetHwnd, workerw);
    const lastError = GetLastError();
    if (!previousParent && lastError !== 0) {
      return false;
    }

    ShowWindow(targetHwnd, SW_SHOWNA);
    return true;
  } catch {
    return false;
  }
};
