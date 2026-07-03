import { contextBridge, ipcRenderer } from "electron";
import type { AppSettings, ShortcutRegistrationResult, TodoCalendarDay, TodoDraft, TodoSnapshot, TodoUpdate } from "../src/types/todo";

/** 渲染进程可调用的 API，经 contextBridge 安全暴露给 window.todoApi。 */
const api = {
  getSnapshot: (): Promise<TodoSnapshot> => ipcRenderer.invoke("todos:getSnapshot"),
  addTodo: (draft: TodoDraft): Promise<TodoSnapshot> => ipcRenderer.invoke("todos:add", draft),
  completeTodo: (id: string): Promise<TodoSnapshot> => ipcRenderer.invoke("todos:complete", id),
  reopenTodo: (id: string): Promise<TodoSnapshot> => ipcRenderer.invoke("todos:reopen", id),
  deleteTodo: (id: string): Promise<TodoSnapshot> => ipcRenderer.invoke("todos:delete", id),
  updateTodo: (id: string, update: TodoUpdate): Promise<TodoSnapshot> =>
    ipcRenderer.invoke("todos:update", id, update),
  setTodoRating: (id: string, rating: number): Promise<TodoSnapshot> => ipcRenderer.invoke("todos:setRating", id, rating),
  getCalendar: (year: number, month: number): Promise<TodoCalendarDay[]> =>
    ipcRenderer.invoke("todos:getCalendar", year, month),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke("settings:get"),
  setDisplayMode: (displayMode: AppSettings["displayMode"]): Promise<AppSettings> =>
    ipcRenderer.invoke("settings:setDisplayMode", displayMode),
  setLaunchAtLogin: (enabled: boolean): Promise<AppSettings> => ipcRenderer.invoke("settings:setLaunchAtLogin", enabled),
  setShortcut: (shortcut: string): Promise<ShortcutRegistrationResult> => ipcRenderer.invoke("settings:setShortcut", shortcut),
  setShowWidgetShortcut: (shortcut: string): Promise<ShortcutRegistrationResult> =>
    ipcRenderer.invoke("settings:setShowWidgetShortcut", shortcut),
  openAddTodo: (): Promise<void> => ipcRenderer.invoke("windows:openAddTodo"),
  openCalendar: (): Promise<void> => ipcRenderer.invoke("windows:openCalendar"),
  openSettings: (): Promise<void> => ipcRenderer.invoke("windows:openSettings"),
  closeCurrentWindow: (): Promise<void> => ipcRenderer.invoke("windows:closeCurrent"),
  quitApp: (): Promise<void> => ipcRenderer.invoke("app:quit"),
  onTodosChanged: (callback: (snapshot: TodoSnapshot) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: TodoSnapshot): void => callback(snapshot);
    ipcRenderer.on("todos:changed", listener);
    return () => ipcRenderer.removeListener("todos:changed", listener);
  },
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
  onQuickAddFocus: (callback: () => void): (() => void) => {
    const listener = (): void => callback();
    ipcRenderer.on("quick-add:focus", listener);
    return () => ipcRenderer.removeListener("quick-add:focus", listener);
  }
};

contextBridge.exposeInMainWorld("todoApi", api);

export type TodoApi = typeof api;
