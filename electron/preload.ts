/**
 * Preload 脚本：在渲染进程与主进程之间建立安全桥接。
 *
 * 通过 contextBridge 将 todoApi 暴露到 window，渲染进程无法直接访问 Node/Electron 主进程 API。
 * 所有跨进程通信均走 ipcRenderer.invoke / ipcRenderer.on，通道名与 main.ts 中 ipcMain.handle 一一对应。
 */
import { contextBridge, ipcRenderer } from "electron";
import type { AppSettings, ShortcutRegistrationResult, TodoCalendarDay, TodoDraft, TodoSnapshot, TodoUpdate } from "../src/types/todo";
import type { AppVersionInfo, UpdateStatus } from "../src/types/update";

/** 渲染进程可调用的 API，经 contextBridge 安全暴露给 window.todoApi */
const api = {
  // ── 待办 CRUD ──────────────────────────────────────────────
  /** 获取当日快照，主进程会先执行日切 refreshDaily */
  getSnapshot: (): Promise<TodoSnapshot> => ipcRenderer.invoke("todos:getSnapshot"),
  addTodo: (draft: TodoDraft): Promise<TodoSnapshot> => ipcRenderer.invoke("todos:add", draft),
  completeTodo: (id: string): Promise<TodoSnapshot> => ipcRenderer.invoke("todos:complete", id),
  reopenTodo: (id: string): Promise<TodoSnapshot> => ipcRenderer.invoke("todos:reopen", id),
  deleteTodo: (id: string): Promise<TodoSnapshot> => ipcRenderer.invoke("todos:delete", id),
  updateTodo: (id: string, update: TodoUpdate): Promise<TodoSnapshot> =>
    ipcRenderer.invoke("todos:update", id, update),
  setTodoRating: (id: string, rating: number): Promise<TodoSnapshot> => ipcRenderer.invoke("todos:setRating", id, rating),
  /** 按年月查询已完成待办，供日历视图使用 */
  getCalendar: (year: number, month: number): Promise<TodoCalendarDay[]> =>
    ipcRenderer.invoke("todos:getCalendar", year, month),

  // ── 应用设置 ──────────────────────────────────────────────
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke("settings:get"),
  setLaunchAtLogin: (enabled: boolean): Promise<AppSettings> => ipcRenderer.invoke("settings:setLaunchAtLogin", enabled),
  setShortcut: (shortcut: string): Promise<ShortcutRegistrationResult> => ipcRenderer.invoke("settings:setShortcut", shortcut),
  setShowWidgetShortcut: (shortcut: string): Promise<ShortcutRegistrationResult> =>
    ipcRenderer.invoke("settings:setShowWidgetShortcut", shortcut),

  // ── 窗口控制 ──────────────────────────────────────────────
  openAddTodo: (): Promise<void> => ipcRenderer.invoke("windows:openAddTodo"),
  openCalendar: (): Promise<void> => ipcRenderer.invoke("windows:openCalendar"),
  openSettings: (): Promise<void> => ipcRenderer.invoke("windows:openSettings"),
  /** 隐藏当前窗口（快捷添加窗口 blur 时也走此通道） */
  closeCurrentWindow: (): Promise<void> => ipcRenderer.invoke("windows:closeCurrent"),
  prepareWidgetDrag: (): Promise<void> => ipcRenderer.invoke("widget:prepareDrag"),
  getFloatOnPage: (): Promise<boolean> => ipcRenderer.invoke("widget:getFloatOnPage"),
  toggleFloatOnPage: (): Promise<boolean> => ipcRenderer.invoke("widget:toggleFloatOnPage"),
  minimizeWidget: (): Promise<void> => ipcRenderer.invoke("widget:minimize"),
  quitApp: (): Promise<void> => ipcRenderer.invoke("app:quit"),
  getAppVersion: (): Promise<AppVersionInfo> => ipcRenderer.invoke("app:getVersion"),
  getUpdateStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke("app:getUpdateStatus"),
  checkForUpdates: (): Promise<UpdateStatus> => ipcRenderer.invoke("app:checkForUpdates"),
  quitAndInstall: (): Promise<void> => ipcRenderer.invoke("app:quitAndInstall"),

  // ── 主进程 → 渲染进程 事件订阅 ─────────────────────────────
  /** 任意窗口修改待办后广播；返回取消订阅函数，组件 unmount 时必须调用 */
  onTodosChanged: (callback: (snapshot: TodoSnapshot) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: TodoSnapshot): void => callback(snapshot);
    ipcRenderer.on("todos:changed", listener);
    return () => ipcRenderer.removeListener("todos:changed", listener);
  },
  /** 桌面附着成功/失败结果，挂件 footer 据此显示提示 */
  onDesktopAttachResult: (callback: (attached: boolean) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, attached: boolean): void => callback(attached);
    ipcRenderer.on("desktop-attach:result", listener);
    return () => ipcRenderer.removeListener("desktop-attach:result", listener);
  },
  onSettingsChanged: (callback: (settings: AppSettings) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, settings: AppSettings): void => callback(settings);
    ipcRenderer.on("settings:changed", listener);
    return () => ipcRenderer.removeListener("settings:changed", listener);
  },
  /** 置顶模式切换时同步 pin 按钮状态 */
  onFloatStateChanged: (callback: (floating: boolean) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, floating: boolean): void => callback(floating);
    ipcRenderer.on("widget:float-state-changed", listener);
    return () => ipcRenderer.removeListener("widget:float-state-changed", listener);
  },
  /** 快捷添加窗口被再次唤起时聚焦输入框 */
  onQuickAddFocus: (callback: () => void): (() => void) => {
    const listener = (): void => callback();
    ipcRenderer.on("quick-add:focus", listener);
    return () => ipcRenderer.removeListener("quick-add:focus", listener);
  },
  onUpdateStatusChanged: (callback: (status: UpdateStatus) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: UpdateStatus): void => callback(status);
    ipcRenderer.on("update:status", listener);
    return () => ipcRenderer.removeListener("update:status", listener);
  }
};

contextBridge.exposeInMainWorld("todoApi", api);

export type TodoApi = typeof api;
