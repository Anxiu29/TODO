/** 运行真实主进程事件处理器，模拟窗口与时钟，覆盖鼠标、隐藏和延迟恢复的竞争。 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  windows: [] as any[],
  ready: undefined as undefined | (() => Promise<void>),
  raise: vi.fn(), attach: vi.fn(), sync: vi.fn(),
  register: vi.fn(), unregister: vi.fn(), unregisterAll: vi.fn(), saveShortcut: vi.fn(),
  settingsHandlers: undefined as any
}));

vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  class Window extends EventEmitter {
    visible = false;
    focused = false;
    webContents = Object.assign(new EventEmitter(), { send: vi.fn() });
    constructor(..._args: any[]) { super(); state.windows.push(this); }
    show = vi.fn(() => { this.visible = true; });
    showInactive = vi.fn(() => { this.visible = true; });
    focus = vi.fn(() => { this.focused = true; });
    hide = vi.fn(() => { this.visible = false; });
    restore = vi.fn(); moveTop = vi.fn();
    setAlwaysOnTop = vi.fn(); setSkipTaskbar = vi.fn(); setMinimizable = vi.fn();
    setIgnoreMouseEvents = vi.fn(); setBounds = vi.fn();
    getBounds = () => ({ x: 0, y: 0, width: 320, height: 600 });
    isDestroyed = () => false;
    isVisible = () => this.visible;
    isFocused = () => this.focused;
    loadFile = async () => { this.emit("ready-to-show"); };
    static getAllWindows = () => state.windows;
  }
  const icon = { isEmpty: () => false, resize: () => icon };
  const display = { workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
  return {
    BrowserWindow: Window,
    app: { isPackaged: false, requestSingleInstanceLock: () => true, on: vi.fn(),
      whenReady: () => ({ then: (fn: () => Promise<void>) => { state.ready = fn; return { catch: vi.fn() }; } }) },
    ipcMain: { handle: (name: string, fn: (...args: any[]) => any) => state.handlers.set(name, fn), on: vi.fn() },
    globalShortcut: { register: state.register, unregister: state.unregister, unregisterAll: state.unregisterAll },
    Menu: { buildFromTemplate: vi.fn() }, nativeImage: { createFromPath: () => icon },
    Tray: class extends EventEmitter { setToolTip() {} setContextMenu() {} },
    screen: { getPrimaryDisplay: () => display, getDisplayNearestPoint: () => display }
  };
});
vi.mock("../electron/appPaths", () => ({ configureUserDataPath: vi.fn(), getAppIconPath: () => "icon.png", getLoginExecutablePath: () => "todo.exe" }));
vi.mock("../electron/dailyRefreshWatch", () => ({ createDailyRefreshWatch: () => ({ start: vi.fn(), stop: vi.fn() }) }));
vi.mock("../electron/ipcApp", () => ({ registerAppIpc: vi.fn() }));
vi.mock("../electron/ipcSettings", () => ({ registerSettingsIpc: (handlers: any) => { state.settingsHandlers = handlers; } }));
vi.mock("../electron/ipcTodos", () => ({ registerTodoIpc: vi.fn() }));
vi.mock("../electron/updater", () => ({ setupAutoUpdater: vi.fn() }));
vi.mock("../electron/todoStore", () => ({ TodoStore: class {
  getSettings = () => ({ displayMode: "system", shortcut: "CommandOrControl+2", showWidgetShortcut: "CommandOrControl+1" });
  refreshDaily = () => ({ today: "2026-09-09" });
  getSnapshot = () => ({ activeTodos: [{ id: "test", title: "测试" }], completedToday: [] });
  updateWidgetBounds = vi.fn(); setShortcut = state.saveShortcut; setShowWidgetShortcut = vi.fn();
} }));
vi.mock("../electron/desktop/attachToDesktop", () => ({
  attachWindowToDesktop: state.attach, detachWindowFromDesktop: vi.fn(),
  isWindowDesktopAttached: () => true, isWindowDesktopChild: () => false,
  raiseDesktopWidgetForInput: state.raise, syncDesktopWindowBounds: state.sync
}));

beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); vi.clearAllMocks();
  state.handlers.clear(); state.windows.length = 0;
  state.register.mockReset().mockReturnValue(true);
  state.saveShortcut.mockReset();
  state.attach.mockResolvedValue({ ok: true, changed: true });
  await import("../electron/main");
  await state.ready!();
  await vi.advanceTimersByTimeAsync(1600);
  vi.clearAllMocks();
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

it("does not show or focus the widget on hover or idle time", async () => {
  state.handlers.get("widget:wake")!();
  await vi.advanceTimersByTimeAsync(5000);
  expect(state.raise).toHaveBeenCalledTimes(1);
  expect(state.windows[0].show).not.toHaveBeenCalled();
  expect(state.windows[0].showInactive).not.toHaveBeenCalled();
  expect(state.windows[0].focus).not.toHaveBeenCalled();
});

it("preserves both original shortcuts when a requested combination is unavailable", () => {
  state.register.mockReturnValue(false);
  const result = state.settingsHandlers.setShortcut("Ctrl+3");
  expect(result.registered).toBe(false);
  expect(result.activeShortcut).toBe("CommandOrControl+2");
  expect(state.unregister).not.toHaveBeenCalled();
  expect(state.unregisterAll).not.toHaveBeenCalled();
});

it("unregisters only the new shortcut if its settings fail to save", () => {
  state.saveShortcut.mockImplementation(() => { throw new Error("disk full"); });
  expect(() => state.settingsHandlers.setShortcut("Ctrl+3")).toThrow("disk full");
  expect(state.unregister).toHaveBeenCalledExactlyOnceWith("CommandOrControl+3");
  expect(state.unregisterAll).not.toHaveBeenCalled();
});

it("replaces only the changed shortcut after successful persistence", () => {
  expect(state.settingsHandlers.setShortcut("Ctrl+3").registered).toBe(true);
  expect(state.unregister).toHaveBeenCalledExactlyOnceWith("CommandOrControl+2");
  expect(state.unregisterAll).not.toHaveBeenCalled();
});

it("does not revive a hidden widget from a pending resize callback", async () => {
  state.windows[0].emit("resized");
  state.handlers.get("widget:minimize")!();
  state.handlers.get("widget:wake")!();
  await vi.advanceTimersByTimeAsync(500);
  expect(state.sync).not.toHaveBeenCalled();
  expect(state.raise).not.toHaveBeenCalled();
  expect(state.windows[0].visible).toBe(false);
});

it("leaves widget interaction untouched while an edit window is open", async () => {
  await state.handlers.get("windows:openEditTodo")!({}, "test");
  expect(state.windows[1].visible).toBe(true);
  state.handlers.get("widget:wake")!();
  expect(state.raise).not.toHaveBeenCalled();
  expect(state.windows[0].focus).not.toHaveBeenCalled();
});

it("keeps explicit floating available but cancels delayed restore after hiding", async () => {
  await state.handlers.get("widget:toggleFloatOnPage")!();
  const win = state.windows[0];
  expect(win.show).toHaveBeenCalled();
  expect(win.focus).toHaveBeenCalled();
  win.emit("minimize");
  state.handlers.get("widget:minimize")!();
  await vi.advanceTimersByTimeAsync(100);
  expect(win.restore).not.toHaveBeenCalled();
  expect(win.visible).toBe(false);
});
