import { contextBridge, ipcRenderer } from "electron";
const api = {
  getSnapshot: () => ipcRenderer.invoke("todos:getSnapshot"),
  addTodo: (draft) => ipcRenderer.invoke("todos:add", draft),
  completeTodo: (id) => ipcRenderer.invoke("todos:complete", id),
  reopenTodo: (id) => ipcRenderer.invoke("todos:reopen", id),
  deleteTodo: (id) => ipcRenderer.invoke("todos:delete", id),
  setTodoRating: (id, rating) => ipcRenderer.invoke("todos:setRating", id, rating),
  getCalendar: (year, month) => ipcRenderer.invoke("todos:getCalendar", year, month),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setDesktopAttachEnabled: (enabled) => ipcRenderer.invoke("settings:setDesktopAttachEnabled", enabled),
  setDisplayMode: (displayMode) => ipcRenderer.invoke("settings:setDisplayMode", displayMode),
  setLaunchAtLogin: (enabled) => ipcRenderer.invoke("settings:setLaunchAtLogin", enabled),
  setShortcut: (shortcut) => ipcRenderer.invoke("settings:setShortcut", shortcut),
  setShowWidgetShortcut: (shortcut) => ipcRenderer.invoke("settings:setShowWidgetShortcut", shortcut),
  openAddTodo: () => ipcRenderer.invoke("windows:openAddTodo"),
  openCalendar: () => ipcRenderer.invoke("windows:openCalendar"),
  openSettings: () => ipcRenderer.invoke("windows:openSettings"),
  closeCurrentWindow: () => ipcRenderer.invoke("windows:closeCurrent"),
  hideWidget: () => ipcRenderer.invoke("windows:hideWidget"),
  showWidget: () => ipcRenderer.invoke("windows:showWidget"),
  quitApp: () => ipcRenderer.invoke("app:quit"),
  onTodosChanged: (callback) => {
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on("todos:changed", listener);
    return () => ipcRenderer.removeListener("todos:changed", listener);
  },
  onDesktopAttachResult: (callback) => {
    const listener = (_event, attached) => callback(attached);
    ipcRenderer.on("desktop-attach:result", listener);
    return () => ipcRenderer.removeListener("desktop-attach:result", listener);
  },
  onSettingsChanged: (callback) => {
    const listener = (_event, settings) => callback(settings);
    ipcRenderer.on("settings:changed", listener);
    return () => ipcRenderer.removeListener("settings:changed", listener);
  },
  onQuickAddFocus: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("quick-add:focus", listener);
    return () => ipcRenderer.removeListener("quick-add:focus", listener);
  }
};
contextBridge.exposeInMainWorld("todoApi", api);
