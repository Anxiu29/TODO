/**
 * Preload 脚本：在渲染进程与主进程之间建立安全桥接。
 *
 * 通过 contextBridge 将 todoApi 暴露到 window，渲染进程无法直接访问 Node/Electron 主进程 API。
 * 所有跨进程通信均走 ipcRenderer.invoke / ipcRenderer.on，通道名与 main.ts 中 ipcMain.handle 一一对应。
 */
import { contextBridge, ipcRenderer } from "electron";
import type {
  AppSettings,
  EditTodoPayload,
  QuickAddFocusPayload,
  ShortcutRegistrationResult,
  TodoCalendarDay,
  TodoDraft,
  TodoSnapshot,
  TodoUpdate,
  WidgetDisplayMode,
  WidgetTheme
} from "../src/types/todo";
import type { AppVersionInfo, UpdateStatus } from "../src/types/update";

/** 订阅主进程 push 事件；返回取消函数，组件 unmount 时必须调用 */
const subscribe = <T>(channel: string, callback: (payload: T) => void): (() => void) => {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

/** 渲染进程可调用的 API，经 contextBridge 安全暴露给 window.todoApi */
const api = {
  // ── 待办 CRUD ──────────────────────────────────────────────
  /** 获取当日快照，主进程会先执行日切 refreshDaily */
  getSnapshot: (): Promise<TodoSnapshot> => ipcRenderer.invoke("todos:getSnapshot"),
  addTodo: (draft: TodoDraft): Promise<TodoSnapshot> => ipcRenderer.invoke("todos:add", draft),
  completeTodo: (id: string): Promise<TodoSnapshot> => ipcRenderer.invoke("todos:complete", id),
  reopenTodo: (id: string): Promise<TodoSnapshot> => ipcRenderer.invoke("todos:reopen", id),
  deleteTodo: (id: string): Promise<TodoSnapshot> => ipcRenderer.invoke("todos:delete", id),
  /** 撤回最近一次待办删除（随 todos.json 的 lastDeletedTodo 落盘） */
  undoLastDelete: (): Promise<TodoSnapshot> => ipcRenderer.invoke("todos:undoLastDelete"),
  updateTodo: (id: string, update: TodoUpdate): Promise<TodoSnapshot> =>
    ipcRenderer.invoke("todos:update", id, update),
  setTodoRating: (id: string, rating: number): Promise<TodoSnapshot> => ipcRenderer.invoke("todos:setRating", id, rating),
  setTodoTags: (id: string, tags: string[]): Promise<TodoSnapshot> => ipcRenderer.invoke("todos:setTags", id, tags),
  /** 设置预计完成天数；传 null 清除 */
  setTodoDueDays: (id: string, dueDays: number | null): Promise<TodoSnapshot> =>
    ipcRenderer.invoke("todos:setDueDays", id, dueDays),
  /** 标记等待中；首次写入 waitingSince，已等待则只更新原因 */
  setTodoWaiting: (id: string, options?: { reason?: string | null }): Promise<TodoSnapshot> =>
    ipcRenderer.invoke("todos:setWaiting", id, options),
  /** 等待中恢复为进行中 */
  resumeTodo: (id: string): Promise<TodoSnapshot> => ipcRenderer.invoke("todos:resume", id),
  addTodoSubtask: (id: string, title: string): Promise<TodoSnapshot> =>
    ipcRenderer.invoke("todos:addSubtask", id, title),
  toggleTodoSubtask: (id: string, subtaskId: string): Promise<TodoSnapshot> =>
    ipcRenderer.invoke("todos:toggleSubtask", id, subtaskId),
  updateTodoSubtask: (id: string, subtaskId: string, title: string): Promise<TodoSnapshot> =>
    ipcRenderer.invoke("todos:updateSubtask", id, subtaskId, title),
  deleteTodoSubtask: (id: string, subtaskId: string): Promise<TodoSnapshot> =>
    ipcRenderer.invoke("todos:deleteSubtask", id, subtaskId),
  /** 按年月查询已完成待办，供日历视图使用 */
  getCalendar: (year: number, month: number): Promise<TodoCalendarDay[]> =>
    ipcRenderer.invoke("todos:getCalendar", year, month),

  // ── 应用设置 ──────────────────────────────────────────────
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke("settings:get"),
  setLaunchAtLogin: (enabled: boolean): Promise<AppSettings> => ipcRenderer.invoke("settings:setLaunchAtLogin", enabled),
  setDisplayMode: (displayMode: WidgetDisplayMode): Promise<AppSettings> =>
    ipcRenderer.invoke("settings:setDisplayMode", displayMode),
  setTheme: (theme: WidgetTheme): Promise<AppSettings> => ipcRenderer.invoke("settings:setTheme", theme),
  setWidgetOpacity: (opacity: number): Promise<AppSettings> => ipcRenderer.invoke("settings:setWidgetOpacity", opacity),
  /** 挂件标签筛选；null=全部，持久化以便重启恢复 */
  setTagFilter: (tagFilter: string | null): Promise<AppSettings> =>
    ipcRenderer.invoke("settings:setTagFilter", tagFilter),
  setShortcut: (shortcut: string): Promise<ShortcutRegistrationResult> => ipcRenderer.invoke("settings:setShortcut", shortcut),
  setShowWidgetShortcut: (shortcut: string): Promise<ShortcutRegistrationResult> =>
    ipcRenderer.invoke("settings:setShowWidgetShortcut", shortcut),

  // ── 窗口控制 ──────────────────────────────────────────────
  /** 打开快捷添加；可传入初始标签（如当前筛选标签） */
  openAddTodo: (options?: { tags?: string[] }): Promise<void> =>
    ipcRenderer.invoke("windows:openAddTodo", options),
  openCalendar: (): Promise<void> => ipcRenderer.invoke("windows:openCalendar"),
  openSettings: (): Promise<void> => ipcRenderer.invoke("windows:openSettings"),
  /** 打开独立编辑窗；不占用挂件内部空间 */
  openEditTodo: (todoId: string): Promise<void> => ipcRenderer.invoke("windows:openEditTodo", todoId),
  /** 隐藏当前窗口（添加/编辑/日历/设置的关闭按钮与 Escape） */
  closeCurrentWindow: (): Promise<void> => ipcRenderer.invoke("windows:closeCurrent"),
  /** 添加/编辑窗标题换行后，按卡片高度调整窗口 */
  resizeAddTodoWindow: (height: number): Promise<void> => ipcRenderer.invoke("windows:resizeAddTodo", height),
  wakeWidget: (): Promise<void> => ipcRenderer.invoke("widget:wake"),
  prepareWidgetDrag: (): Promise<void> => ipcRenderer.invoke("widget:prepareDrag"),
  getFloatOnPage: (): Promise<boolean> => ipcRenderer.invoke("widget:getFloatOnPage"),
  toggleFloatOnPage: (): Promise<boolean> => ipcRenderer.invoke("widget:toggleFloatOnPage"),
  minimizeWidget: (): Promise<void> => ipcRenderer.invoke("widget:minimize"),
  quitApp: (): Promise<void> => ipcRenderer.invoke("app:quit"),
  getAppVersion: (): Promise<AppVersionInfo> => ipcRenderer.invoke("app:getVersion"),
  getUpdateStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke("app:getUpdateStatus"),
  checkForUpdates: (): Promise<UpdateStatus> => ipcRenderer.invoke("app:checkForUpdates"),
  downloadUpdate: (): Promise<UpdateStatus> => ipcRenderer.invoke("app:downloadUpdate"),
  dismissUpdate: (): Promise<UpdateStatus> => ipcRenderer.invoke("app:dismissUpdate"),
  quitAndInstall: (): Promise<void> => ipcRenderer.invoke("app:quitAndInstall"),
  /** 用系统浏览器打开白名单外链（发行页下载） */
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("app:openExternal", url),

  // ── 主进程 → 渲染进程 事件订阅 ─────────────────────────────
  /** 任意窗口修改待办后广播；返回取消订阅函数，组件 unmount 时必须调用 */
  onTodosChanged: (callback: (snapshot: TodoSnapshot) => void): (() => void) =>
    subscribe("todos:changed", callback),
  /** 桌面附着成功/失败结果，挂件 footer 据此显示提示 */
  onDesktopAttachResult: (callback: (attached: boolean) => void): (() => void) =>
    subscribe("desktop-attach:result", callback),
  onSettingsChanged: (callback: (settings: AppSettings) => void): (() => void) =>
    subscribe("settings:changed", callback),
  /** 置顶模式切换时同步 pin 按钮状态 */
  onFloatStateChanged: (callback: (floating: boolean) => void): (() => void) =>
    subscribe("widget:float-state-changed", callback),
  /** 快捷添加窗口被再次唤起时聚焦输入框，并同步预填标签 */
  onQuickAddFocus: (callback: (payload: QuickAddFocusPayload) => void): (() => void) =>
    subscribe<QuickAddFocusPayload>("quick-add:focus", (payload) => callback(payload ?? { tags: [] })),
  /** 编辑窗被再次唤起或切换待办时灌入标题 */
  onEditTodoOpen: (callback: (payload: EditTodoPayload) => void): (() => void) =>
    subscribe("edit-todo:open", callback),
  onUpdateStatusChanged: (callback: (status: UpdateStatus) => void): (() => void) =>
    subscribe("update:status", callback)
};

contextBridge.exposeInMainWorld("todoApi", api);

export type TodoApi = typeof api;
