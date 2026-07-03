import koffi from "koffi";
import type { BrowserWindow } from "electron";

const user32 = koffi.load("user32.dll");
const kernel32 = koffi.load("kernel32.dll");

const HWND = koffi.alias("HWND", "void *");
type Hwnd = object | null;
const FindWindowW = user32.func("HWND __stdcall FindWindowW(str16 _lpClassName, str16 _lpWindowName)");
const FindWindowExW = user32.func(
  "HWND __stdcall FindWindowExW(HWND hWndParent, HWND hWndChildAfter, str16 lpszClass, str16 lpszWindow)"
);
const SetParent = user32.func("HWND __stdcall SetParent(HWND hWndChild, HWND hWndNewParent)");
const GetLastError = kernel32.func("uint32 __stdcall GetLastError()");
const SendMessageTimeoutW = user32.func(
  "uintptr_t __stdcall SendMessageTimeoutW(HWND hWnd, uint32 Msg, uintptr_t wParam, intptr_t lParam, uint32 fuFlags, uint32 uTimeout, _Out_ uintptr_t *lpdwResult)"
);

const WM_SPAWN_WORKER = 0x052c;

const readHwnd = (window: BrowserWindow): Hwnd => {
  const handle = window.getNativeWindowHandle();
  return koffi.decode(handle, HWND);
};

/**
 * 查找承载桌面图标的 WorkerW 窗口。
 * 先向 Progman 发送 0x052c 消息生成 WorkerW，再遍历找到带 SHELLDLL_DefView 的层级。
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

  return workerw ?? progman;
};

/** 将 Electron 窗口设为桌面 WorkerW 的子窗口，使其显示在壁纸之上、图标之下。 */
export const attachWindowToDesktop = async (window: BrowserWindow): Promise<boolean> => {
  if (process.platform !== "win32") {
    return false;
  }

  try {
    const targetHwnd = readHwnd(window);
    const workerw = findDesktopWorkerW();
    if (!workerw) {
      return false;
    }

    const previousParent = SetParent(targetHwnd, workerw);
    const lastError = GetLastError();
    if (!previousParent && lastError !== 0) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
};
