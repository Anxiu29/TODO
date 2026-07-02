import { contextBridge, ipcRenderer } from "electron";
import type { AppSettings, TodoCalendarDay, TodoDraft, TodoSnapshot } from "../src/types/todo";

const api = {
  getSnapshot: (): Promise<TodoSnapshot> => ipcRenderer.invoke("todos:getSnapshot"),
  addTodo: (draft: TodoDraft): Promise<TodoSnapshot> => ipcRenderer.invoke("todos:add", draft),
  completeTodo: (id: string): Promise<TodoSnapshot> => ipcRenderer.invoke("todos:complete", id),
  reopenTodo: (id: string): Promise<TodoSnapshot> => ipcRenderer.invoke("todos:reopen", id),
  deleteTodo: (id: string): Promise<TodoSnapshot> => ipcRenderer.invoke("todos:delete", id),
  getCalendar: (year: number, month: number): Promise<TodoCalendarDay[]> =>
    ipcRenderer.invoke("todos:getCalendar", year, month),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke("settings:get"),
  setDesktopAttachEnabled: (enabled: boolean): Promise<AppSettings> =>
    ipcRenderer.invoke("settings:setDesktopAttachEnabled", enabled),
  setShortcut: (shortcut: string): Promise<AppSettings> => ipcRenderer.invoke("settings:setShortcut", shortcut),
  openAddTodo: (): Promise<void> => ipcRenderer.invoke("windows:openAddTodo"),
  openCalendar: (): Promise<void> => ipcRenderer.invoke("windows:openCalendar"),
  closeCurrentWindow: (): Promise<void> => ipcRenderer.invoke("windows:closeCurrent"),
  hideWidget: (): Promise<void> => ipcRenderer.invoke("windows:hideWidget"),
  showWidget: (): Promise<void> => ipcRenderer.invoke("windows:showWidget"),
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
  onQuickAddFocus: (callback: () => void): (() => void) => {
    const listener = (): void => callback();
    ipcRenderer.on("quick-add:focus", listener);
    return () => ipcRenderer.removeListener("quick-add:focus", listener);
  }
};

contextBridge.exposeInMainWorld("todoApi", api);

export type TodoApi = typeof api;
