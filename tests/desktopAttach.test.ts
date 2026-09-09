/** 模拟 Win32 句柄：验证 Owner 与 Parent 区分，以及鼠标交互修复绝不唤醒窗口。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";

const native = vi.hoisted(() => ({ calls: new Map<string, ReturnType<typeof vi.fn>>() }));
vi.mock("koffi", () => ({ default: {
  load: () => ({ func: (signature: string) => {
    const name = signature.match(/__stdcall (\w+)/)![1];
    const call = vi.fn();
    native.calls.set(name, call);
    return call;
  } }),
  alias: () => "HWND",
  decode: () => 10,
  address: (handle: unknown) => handle,
  alloc: vi.fn(), free: vi.fn()
} }));

import { attachWindowToDesktop, isWindowDesktopAttached, isWindowDesktopChild, raiseDesktopWidgetForInput } from "../electron/desktop/attachToDesktop";
const call = (name: string) => native.calls.get(name)!;
const fakeWindow = () => ({
  getNativeWindowHandle: vi.fn(() => Buffer.alloc(8)),
  getBounds: vi.fn(() => ({ x: 0, y: 0, width: 300, height: 500 })),
  setBounds: vi.fn(), setIgnoreMouseEvents: vi.fn(), show: vi.fn(), focus: vi.fn()
});

beforeEach(() => {
  vi.resetAllMocks();
  call("GetDesktopWindow").mockReturnValue(1);
  call("GetAncestor").mockReturnValue(1);
  call("FindWindowW").mockReturnValue(2);
  call("FindWindowExW").mockImplementation((parent, _after, name) => parent === 2 && name === "SHELLDLL_DefView" ? 3 : null);
  call("GetWindow").mockReturnValue(3);
  call("GetWindowLongPtrW").mockReturnValue(0);
});

describe.skipIf(process.platform !== "win32")("desktop attachment", () => {
  it("does not mistake a desktop-owned top-level window for a child", () => {
    const win = fakeWindow() as unknown as BrowserWindow;
    expect(isWindowDesktopChild(win)).toBe(false);
    expect(isWindowDesktopAttached(win)).toBe(true);
    call("GetAncestor").mockReturnValue(4);
    expect(isWindowDesktopChild(win)).toBe(true);
  });
  it("does not reparent or show an already attached owner window", async () => {
    expect(await attachWindowToDesktop(fakeWindow() as unknown as BrowserWindow, "system"))
      .toEqual({ ok: true, changed: false, host: "defview-owner" });
    expect(call("SetParent")).not.toHaveBeenCalled();
    expect(call("ShowWindow")).not.toHaveBeenCalled();
    expect(call("SendMessageTimeoutW")).not.toHaveBeenCalled();
  });
  it("repairs mouse input without displaying or focusing the widget", () => {
    const win = fakeWindow();
    raiseDesktopWidgetForInput(win as unknown as BrowserWindow);
    expect(win.setIgnoreMouseEvents).toHaveBeenCalledWith(false);
    expect(call("ShowWindow")).not.toHaveBeenCalled();
    expect(win.show).not.toHaveBeenCalled();
    expect(win.focus).not.toHaveBeenCalled();
  });
});
