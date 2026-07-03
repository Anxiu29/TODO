import { app, BrowserWindow, globalShortcut, ipcMain, nativeImage, Tray, Menu, screen } from "electron";
import { join, dirname } from "node:path";
import koffi from "koffi";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
const user32 = koffi.load("user32.dll");
const kernel32 = koffi.load("kernel32.dll");
const HWND = koffi.alias("HWND", "void *");
const FindWindowW = user32.func("HWND __stdcall FindWindowW(str16 _lpClassName, str16 _lpWindowName)");
const FindWindowExW = user32.func(
  "HWND __stdcall FindWindowExW(HWND hWndParent, HWND hWndChildAfter, str16 lpszClass, str16 lpszWindow)"
);
const SetParent = user32.func("HWND __stdcall SetParent(HWND hWndChild, HWND hWndNewParent)");
const GetLastError = kernel32.func("uint32 __stdcall GetLastError()");
const SendMessageTimeoutW = user32.func(
  "uintptr_t __stdcall SendMessageTimeoutW(HWND hWnd, uint32 Msg, uintptr_t wParam, intptr_t lParam, uint32 fuFlags, uint32 uTimeout, _Out_ uintptr_t *lpdwResult)"
);
const WM_SPAWN_WORKER = 1324;
const readHwnd = (window) => {
  const handle = window.getNativeWindowHandle();
  return koffi.decode(handle, HWND);
};
const findDesktopWorkerW = () => {
  const progman = FindWindowW("Progman", null);
  if (!progman) {
    return null;
  }
  const resultPtr = koffi.alloc("uintptr_t", 1);
  SendMessageTimeoutW(progman, WM_SPAWN_WORKER, 0, 0, 0, 1e3, resultPtr);
  koffi.free(resultPtr);
  let workerw = null;
  let current = null;
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
const attachWindowToDesktop = async (window) => {
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
const TODO_RATING_MIN = 1;
const TODO_RATING_MAX = 5;
const TODO_RATING_DEFAULT = 1;
const normalizeTodoRating = (rating) => {
  if (rating === void 0 || !Number.isFinite(rating)) return TODO_RATING_DEFAULT;
  return Math.min(TODO_RATING_MAX, Math.max(TODO_RATING_MIN, Math.round(rating)));
};
const todayKey = (date = /* @__PURE__ */ new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const sortTodos = (todos) => [...todos].sort((a, b) => {
  if (a.status !== b.status) return a.status === "active" ? -1 : 1;
  const ratingDiff = normalizeTodoRating(b.rating) - normalizeTodoRating(a.rating);
  if (ratingDiff !== 0) return ratingDiff;
  return a.createdAt.localeCompare(b.createdAt);
});
const buildTodoSnapshot = (database, date = todayKey()) => {
  const sorted = sortTodos(database.todos);
  return {
    today: date,
    activeTodos: sorted.filter((todo) => todo.status === "active" && todo.scheduledDate === date),
    completedToday: sorted.filter((todo) => todo.status === "completed" && todo.completedAt?.startsWith(date))
  };
};
const refreshDatabaseForDate = (database, date = todayKey()) => {
  if (database.lastRefreshDate === date) {
    return database;
  }
  return {
    ...database,
    lastRefreshDate: date,
    todos: database.todos.map((todo) => todo.status === "active" ? { ...todo, scheduledDate: date } : todo)
  };
};
const getCalendarForMonth = (database, year, month) => {
  const monthPrefix = `${year}-${String(month).padStart(2, "0")}`;
  const completedByDate = /* @__PURE__ */ new Map();
  for (const todo of database.todos) {
    if (todo.status !== "completed" || !todo.completedAt?.startsWith(monthPrefix)) continue;
    const date = todo.completedAt.slice(0, 10);
    const current = completedByDate.get(date) ?? [];
    current.push(todo);
    completedByDate.set(date, current);
  }
  return [...completedByDate.entries()].sort(([dateA], [dateB]) => dateA.localeCompare(dateB)).map(([date, completedTodos]) => ({
    date,
    completedCount: completedTodos.length,
    completedTodos: sortTodos(completedTodos)
  }));
};
const nowIso = () => (/* @__PURE__ */ new Date()).toISOString();
const createEmptyDatabase = (date = todayKey()) => ({
  version: 1,
  lastRefreshDate: date,
  todos: [],
  settings: {
    displayMode: "desktop",
    launchAtLogin: false,
    shortcut: "CommandOrControl+Alt+T",
    showWidgetShortcut: "CommandOrControl+Alt+W"
  }
});
class TodoStore {
  constructor(filePath = join(app.getPath("userData"), "todos.json")) {
    this.filePath = filePath;
    this.database = this.load();
    this.refreshDaily();
  }
  filePath;
  database;
  getSnapshot() {
    return buildTodoSnapshot(this.database);
  }
  addTodo(draft) {
    const title = draft.title.trim();
    if (!title) {
      return this.getSnapshot();
    }
    const timestamp = nowIso();
    this.database.todos.push({
      id: randomUUID(),
      title,
      createdAt: timestamp,
      scheduledDate: todayKey(),
      status: "active",
      rating: 1
    });
    this.save();
    return this.getSnapshot();
  }
  completeTodo(id) {
    const todo = this.database.todos.find((item) => item.id === id);
    if (todo && todo.status === "active") {
      todo.status = "completed";
      todo.completedAt = nowIso();
      this.save();
    }
    return this.getSnapshot();
  }
  reopenTodo(id) {
    const todo = this.database.todos.find((item) => item.id === id);
    if (todo && todo.status === "completed") {
      todo.status = "active";
      todo.completedAt = void 0;
      todo.scheduledDate = todayKey();
      this.save();
    }
    return this.getSnapshot();
  }
  deleteTodo(id) {
    this.database.todos = this.database.todos.filter((todo) => todo.id !== id);
    this.save();
    return this.getSnapshot();
  }
  setTodoRating(id, rating) {
    const todo = this.database.todos.find((item) => item.id === id);
    if (todo) {
      todo.rating = Math.min(5, Math.max(1, Math.round(rating)));
      this.save();
    }
    return this.getSnapshot();
  }
  getCalendar(year, month) {
    return getCalendarForMonth(this.database, year, month);
  }
  /** 跨天时把未完成待办滚到当天，并更新 lastRefreshDate。 */
  refreshDaily(date = todayKey()) {
    const refreshed = refreshDatabaseForDate(this.database, date);
    if (refreshed !== this.database) {
      this.database = refreshed;
      this.save();
    }
    return this.getSnapshot();
  }
  updateWidgetBounds(bounds) {
    this.database.settings.widgetBounds = bounds;
    this.save();
  }
  getSettings() {
    return this.database.settings;
  }
  setShortcut(shortcut) {
    this.database.settings.shortcut = shortcut;
    this.save();
    return this.database.settings;
  }
  setShowWidgetShortcut(shortcut) {
    this.database.settings.showWidgetShortcut = shortcut;
    this.save();
    return this.database.settings;
  }
  setDisplayMode(displayMode) {
    this.database.settings.displayMode = displayMode;
    this.save();
    return this.database.settings;
  }
  setLaunchAtLogin(launchAtLogin) {
    this.database.settings.launchAtLogin = launchAtLogin;
    this.save();
    return this.database.settings;
  }
  /** 从磁盘加载 JSON；文件不存在或解析失败时返回空库。 */
  load() {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      return {
        ...createEmptyDatabase(),
        ...parsed,
        settings: {
          ...createEmptyDatabase().settings,
          ...parsed.settings
        },
        todos: Array.isArray(parsed.todos) ? parsed.todos.map((todo) => ({
          ...todo,
          rating: typeof todo.rating === "number" ? Math.min(5, Math.max(1, Math.round(todo.rating))) : 1
        })) : []
      };
    } catch {
      return createEmptyDatabase();
    }
  }
  save() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.database, null, 2), "utf8");
  }
}
let widgetWindow = null;
let addTodoWindow = null;
let calendarWindow = null;
let settingsWindow = null;
let tray = null;
let store;
let saveBoundsTimer;
let showOnCurrentPageOverride = false;
let desktopAttachTimer;
const rendererUrl = process.env.ELECTRON_RENDERER_URL;
const fallbackShortcuts = ["CommandOrControl+Alt+T", "CommandOrControl+Alt+N", "CommandOrControl+Shift+Space"];
const fallbackTrayIconDataUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0284c7"/><path d="M9 16.5l4 4L23 10.5" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`
);
const loadRenderer = async (window, view) => {
  if (rendererUrl) {
    await window.loadURL(`${rendererUrl}?view=${view}`);
    return;
  }
  await window.loadFile(join(__dirname, "../renderer/index.html"), {
    query: { view }
  });
};
const normalizeShortcut = (input) => {
  const parts = input.trim().replace(/\s+/g, "").split("+").filter(Boolean);
  const normalized = parts.map((part) => {
    const lower = part.toLowerCase();
    if (["ctrl", "control", "cmdorctrl", "commandorcontrol"].includes(lower)) return "CommandOrControl";
    if (["cmd", "command"].includes(lower)) return "Command";
    if (lower === "option") return "Alt";
    if (lower === "escape") return "Esc";
    if (lower === "spacebar") return "Space";
    return part.length === 1 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1);
  });
  return normalized.join("+");
};
const broadcastSnapshot = () => {
  const snapshot = store.getSnapshot();
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("todos:changed", snapshot);
  }
};
const broadcastSettings = () => {
  const settings = store.getSettings();
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("settings:changed", settings);
  }
};
const showWidgetWindow = () => {
  if (!widgetWindow) {
    void createWidgetWindow();
    return;
  }
  if (store.getSettings().displayMode === "float" || showOnCurrentPageOverride) {
    widgetWindow.setAlwaysOnTop(true, "floating");
    widgetWindow.setSkipTaskbar(false);
    widgetWindow.moveTop();
    widgetWindow.show();
    widgetWindow.focus();
    return;
  }
  widgetWindow.showInactive();
};
const showWidgetOnCurrentPage = async () => {
  const needsRecreate = store.getSettings().displayMode !== "float" && !showOnCurrentPageOverride;
  showOnCurrentPageOverride = true;
  if (!widgetWindow || needsRecreate) {
    await recreateWidgetWindow();
    return;
  }
  showWidgetWindow();
};
const returnWidgetToDesktop = async () => {
  if (store.getSettings().displayMode !== "desktop" || !showOnCurrentPageOverride) {
    return;
  }
  showOnCurrentPageOverride = false;
  await recreateWidgetWindow();
};
const applyLoginSetting = (enabled) => {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath
  });
};
const recreateWidgetWindow = async () => {
  const existingWindow = widgetWindow;
  widgetWindow = null;
  clearTimeout(desktopAttachTimer);
  if (existingWindow && !existingWindow.isDestroyed()) {
    store.updateWidgetBounds(existingWindow.getBounds());
    existingWindow.destroy();
  }
  await createWidgetWindow();
};
const applyWidgetDisplayMode = async () => {
  if (!widgetWindow) return;
  const settings = store.getSettings();
  if (settings.displayMode === "float" || showOnCurrentPageOverride) {
    widgetWindow.setSkipTaskbar(false);
    widgetWindow.setAlwaysOnTop(true, "floating");
    widgetWindow.show();
    widgetWindow.focus();
    widgetWindow.moveTop();
    widgetWindow.webContents.send("desktop-attach:result", true);
    return;
  }
  widgetWindow.setSkipTaskbar(true);
  widgetWindow.setAlwaysOnTop(false);
  widgetWindow.showInactive();
  const attached = await attachWindowToDesktop(widgetWindow);
  widgetWindow.webContents.send("desktop-attach:result", attached);
  scheduleDesktopAttachRetries();
};
const scheduleDesktopAttachRetries = () => {
  clearTimeout(desktopAttachTimer);
  if (!widgetWindow || store.getSettings().displayMode !== "desktop" || showOnCurrentPageOverride) {
    return;
  }
  const delays = [150, 600, 1500];
  const retry = async (index) => {
    if (!widgetWindow || store.getSettings().displayMode !== "desktop" || showOnCurrentPageOverride) {
      return;
    }
    widgetWindow.showInactive();
    const attached = await attachWindowToDesktop(widgetWindow);
    widgetWindow.webContents.send("desktop-attach:result", attached);
    if (index + 1 < delays.length) {
      desktopAttachTimer = setTimeout(() => {
        void retry(index + 1);
      }, delays[index + 1]);
    }
  };
  desktopAttachTimer = setTimeout(() => {
    void retry(0);
  }, delays[0]);
};
const defaultWidgetBounds = () => {
  const display = screen.getPrimaryDisplay().workArea;
  return {
    x: display.x + display.width - 360,
    y: display.y + 72,
    width: 320,
    height: 460
  };
};
const persistWidgetBounds = () => {
  if (!widgetWindow) return;
  clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(() => {
    if (!widgetWindow) return;
    store.updateWidgetBounds(widgetWindow.getBounds());
  }, 300);
};
const createWidgetWindow = async () => {
  const settings = store.getSettings();
  const bounds = settings.widgetBounds ?? defaultWidgetBounds();
  widgetWindow = new BrowserWindow({
    ...bounds,
    minWidth: 280,
    minHeight: 360,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: true,
    skipTaskbar: settings.displayMode === "desktop" && !showOnCurrentPageOverride,
    show: false,
    title: "桌面代办",
    webPreferences: {
      preload: join(__dirname, "../preload/preload.mjs"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  widgetWindow.on("move", persistWidgetBounds);
  widgetWindow.on("resize", persistWidgetBounds);
  widgetWindow.on("blur", () => {
    if (store.getSettings().displayMode !== "desktop" || !showOnCurrentPageOverride) {
      return;
    }
    setTimeout(() => {
      void returnWidgetToDesktop();
    }, 120);
  });
  widgetWindow.on("closed", () => {
    widgetWindow = null;
  });
  await loadRenderer(widgetWindow, "widget");
  widgetWindow.once("ready-to-show", async () => {
    await applyWidgetDisplayMode();
  });
};
const createAddTodoWindow = async () => {
  if (addTodoWindow) {
    addTodoWindow.show();
    addTodoWindow.focus();
    addTodoWindow.webContents.send("quick-add:focus");
    return;
  }
  const display = screen.getPrimaryDisplay().workArea;
  addTodoWindow = new BrowserWindow({
    width: 420,
    height: 178,
    x: Math.round(display.x + display.width / 2 - 210),
    y: Math.round(display.y + display.height / 2 - 89),
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    title: "添加代办",
    webPreferences: {
      preload: join(__dirname, "../preload/preload.mjs"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  addTodoWindow.on("blur", () => addTodoWindow?.hide());
  addTodoWindow.on("closed", () => {
    addTodoWindow = null;
  });
  await loadRenderer(addTodoWindow, "add");
  addTodoWindow.once("ready-to-show", () => {
    addTodoWindow?.show();
    addTodoWindow?.focus();
    addTodoWindow?.webContents.send("quick-add:focus");
  });
};
const createCalendarWindow = async () => {
  if (calendarWindow) {
    calendarWindow.show();
    calendarWindow.focus();
    return;
  }
  calendarWindow = new BrowserWindow({
    width: 760,
    height: 640,
    minWidth: 620,
    minHeight: 520,
    title: "完成日历",
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/preload.mjs"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  calendarWindow.on("closed", () => {
    calendarWindow = null;
  });
  await loadRenderer(calendarWindow, "calendar");
  calendarWindow.once("ready-to-show", () => calendarWindow?.show());
};
const createSettingsWindow = async () => {
  if (settingsWindow) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 520,
    height: 640,
    minWidth: 420,
    minHeight: 520,
    title: "设置",
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/preload.mjs"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
  await loadRenderer(settingsWindow, "settings");
  settingsWindow.once("ready-to-show", () => settingsWindow?.show());
};
const applySettings = (settings) => {
  broadcastSettings();
  return settings;
};
const registerIpc = () => {
  ipcMain.handle("todos:getSnapshot", () => store.refreshDaily());
  ipcMain.handle("todos:add", (_event, draft) => {
    const snapshot = store.addTodo(draft);
    broadcastSnapshot();
    return snapshot;
  });
  ipcMain.handle("todos:complete", (_event, id) => {
    const snapshot = store.completeTodo(id);
    broadcastSnapshot();
    return snapshot;
  });
  ipcMain.handle("todos:reopen", (_event, id) => {
    const snapshot = store.reopenTodo(id);
    broadcastSnapshot();
    return snapshot;
  });
  ipcMain.handle("todos:delete", (_event, id) => {
    const snapshot = store.deleteTodo(id);
    broadcastSnapshot();
    return snapshot;
  });
  ipcMain.handle("todos:setRating", (_event, id, rating) => {
    const snapshot = store.setTodoRating(id, rating);
    broadcastSnapshot();
    return snapshot;
  });
  ipcMain.handle("todos:getCalendar", (_event, year, month) => store.getCalendar(year, month));
  ipcMain.handle("settings:get", () => store.getSettings());
  ipcMain.handle("settings:setDisplayMode", async (_event, displayMode) => {
    showOnCurrentPageOverride = false;
    const settings = store.setDisplayMode(displayMode);
    await recreateWidgetWindow();
    return applySettings(settings);
  });
  ipcMain.handle("settings:setLaunchAtLogin", (_event, enabled) => {
    applyLoginSetting(enabled);
    return applySettings(store.setLaunchAtLogin(enabled));
  });
  ipcMain.handle("settings:setShortcut", (_event, shortcut) => updateShortcut("quickAdd", shortcut));
  ipcMain.handle("settings:setShowWidgetShortcut", (_event, shortcut) => updateShortcut("showWidget", shortcut));
  ipcMain.handle("windows:openAddTodo", () => createAddTodoWindow());
  ipcMain.handle("windows:openCalendar", () => createCalendarWindow());
  ipcMain.handle("windows:openSettings", () => createSettingsWindow());
  ipcMain.handle("windows:closeCurrent", (event) => BrowserWindow.fromWebContents(event.sender)?.hide());
  ipcMain.handle("app:quit", () => app.quit());
};
const getShortcutValue = (kind) => kind === "quickAdd" ? store.getSettings().shortcut : store.getSettings().showWidgetShortcut;
const setShortcutValue = (kind, shortcut) => {
  if (kind === "quickAdd") {
    store.setShortcut(shortcut);
    return;
  }
  store.setShowWidgetShortcut(shortcut);
};
const runShortcutAction = (kind) => {
  if (kind === "quickAdd") {
    void createAddTodoWindow();
    return;
  }
  void showWidgetOnCurrentPage();
};
const registerShortcut = (kind, requestedShortcut) => {
  const preferredShortcut = requestedShortcut ? normalizeShortcut(requestedShortcut) : getShortcutValue(kind);
  const shortcutCandidates = requestedShortcut ? [preferredShortcut] : [preferredShortcut, ...fallbackShortcuts].filter((shortcut, index, shortcuts) => shortcuts.indexOf(shortcut) === index);
  for (const shortcut of shortcutCandidates) {
    let registered = false;
    try {
      registered = globalShortcut.register(shortcut, () => {
        runShortcutAction(kind);
      });
    } catch {
      registered = false;
    }
    if (registered) {
      setShortcutValue(kind, shortcut);
      if (shortcut !== preferredShortcut) {
        console.warn(`Preferred shortcut unavailable. Registered fallback shortcut: ${shortcut}`);
      }
      return {
        settings: store.getSettings(),
        registered: true,
        requestedShortcut: preferredShortcut,
        activeShortcut: shortcut
      };
    }
  }
  console.warn(`Failed to register shortcuts: ${shortcutCandidates.join(", ")}`);
  if (requestedShortcut) {
    registerShortcut(kind);
  }
  return {
    settings: store.getSettings(),
    registered: false,
    requestedShortcut: preferredShortcut,
    activeShortcut: getShortcutValue(kind)
  };
};
const registerGlobalShortcuts = () => {
  globalShortcut.unregisterAll();
  registerShortcut("quickAdd");
  registerShortcut("showWidget");
};
const updateShortcut = (kind, shortcut) => {
  const requestedShortcut = normalizeShortcut(shortcut);
  const otherKind = kind === "quickAdd" ? "showWidget" : "quickAdd";
  if (requestedShortcut === getShortcutValue(otherKind)) {
    return {
      settings: store.getSettings(),
      registered: false,
      requestedShortcut,
      activeShortcut: getShortcutValue(kind)
    };
  }
  globalShortcut.unregisterAll();
  const result = registerShortcut(kind, requestedShortcut);
  registerShortcut(otherKind);
  broadcastSettings();
  return result;
};
const createTray = () => {
  const appIcon = nativeImage.createFromPath(process.execPath);
  const trayIcon = appIcon.isEmpty() ? nativeImage.createFromDataURL(fallbackTrayIconDataUrl) : appIcon.resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon);
  tray.setToolTip("桌面代办");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "退出",
        click: () => app.quit()
      }
    ])
  );
  tray.on("click", () => void showWidgetOnCurrentPage());
};
const boot = async () => {
  store = new TodoStore();
  applyLoginSetting(store.getSettings().launchAtLogin);
  store.refreshDaily();
  registerIpc();
  await createWidgetWindow();
  registerGlobalShortcuts();
  createTray();
};
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showWidgetWindow();
  });
  app.whenReady().then(boot);
}
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWidgetWindow();
  }
});
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
app.on("window-all-closed", () => {
});
