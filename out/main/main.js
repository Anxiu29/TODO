import { app, BrowserWindow, globalShortcut, ipcMain, nativeImage, Tray, Menu, screen } from "electron";
import { join, dirname } from "node:path";
import { spawn } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
const readHwnd = (window) => {
  const handle = window.getNativeWindowHandle();
  return process.arch === "x64" ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE());
};
const attachWindowToDesktop = async (window) => {
  if (process.platform !== "win32") {
    return false;
  }
  const hwnd = readHwnd(window);
  const script = `
param([IntPtr]$targetHwnd)

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class Win32Desktop {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr FindWindowEx(IntPtr parentHandle, IntPtr childAfter, string className, string windowTitle);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr SetParent(IntPtr child, IntPtr newParent);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
}
"@

$progman = [Win32Desktop]::FindWindow("Progman", $null)
$result = [IntPtr]::Zero
[Win32Desktop]::SendMessageTimeout($progman, 0x052C, [IntPtr]::Zero, [IntPtr]::Zero, 0, 1000, [ref]$result) | Out-Null

$workerw = [IntPtr]::Zero
$current = [IntPtr]::Zero
do {
  $current = [Win32Desktop]::FindWindowEx([IntPtr]::Zero, $current, "WorkerW", $null)
  $shellView = [Win32Desktop]::FindWindowEx($current, [IntPtr]::Zero, "SHELLDLL_DefView", $null)
  if ($shellView -ne [IntPtr]::Zero) {
    $workerw = [Win32Desktop]::FindWindowEx([IntPtr]::Zero, $current, "WorkerW", $null)
  }
} while ($current -ne [IntPtr]::Zero -and $workerw -eq [IntPtr]::Zero)

if ($workerw -eq [IntPtr]::Zero) {
  $workerw = $progman
}

if ($workerw -eq [IntPtr]::Zero) {
  exit 2
}

$parent = [Win32Desktop]::SetParent($targetHwnd, $workerw)
$lastError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
if ($parent -eq [IntPtr]::Zero -and $lastError -ne 0) {
  exit 3
}

exit 0
`;
  return await new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script, "-targetHwnd", hwnd],
      {
        windowsHide: true,
        stdio: "ignore"
      }
    );
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
};
const todayKey = (date = /* @__PURE__ */ new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const sortTodos = (todos) => [...todos].sort((a, b) => {
  if (a.status !== b.status) return a.status === "active" ? -1 : 1;
  return a.createdAt.localeCompare(b.createdAt);
});
const buildTodoSnapshot = (database, date = todayKey()) => {
  const allTodos = sortTodos(database.todos);
  return {
    today: date,
    activeTodos: allTodos.filter((todo) => todo.status === "active" && todo.scheduledDate === date),
    completedToday: allTodos.filter((todo) => todo.status === "completed" && todo.completedAt?.startsWith(date)),
    allTodos
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
    desktopAttachEnabled: true,
    displayMode: "desktop",
    launchAtLogin: false,
    shortcut: "CommandOrControl+Alt+T"
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
      status: "active"
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
  getCalendar(year, month) {
    return getCalendarForMonth(this.database, year, month);
  }
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
  setDesktopAttachEnabled(enabled) {
    this.database.settings.desktopAttachEnabled = enabled;
    this.save();
    return this.database.settings;
  }
  setShortcut(shortcut) {
    this.database.settings.shortcut = shortcut;
    this.save();
    return this.database.settings;
  }
  setDisplayMode(displayMode) {
    this.database.settings.displayMode = displayMode;
    this.database.settings.desktopAttachEnabled = displayMode === "desktop";
    this.save();
    return this.database.settings;
  }
  setLaunchAtLogin(launchAtLogin) {
    this.database.settings.launchAtLogin = launchAtLogin;
    this.save();
    return this.database.settings;
  }
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
        todos: Array.isArray(parsed.todos) ? parsed.todos : []
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
  const parentBounds = widgetWindow?.getBounds() ?? defaultWidgetBounds();
  settingsWindow = new BrowserWindow({
    width: 420,
    height: 420,
    x: parentBounds.x + 24,
    y: parentBounds.y + 64,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    title: "设置",
    webPreferences: {
      preload: join(__dirname, "../preload/preload.mjs"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  settingsWindow.on("blur", () => settingsWindow?.hide());
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
  await loadRenderer(settingsWindow, "settings");
  settingsWindow.once("ready-to-show", () => {
    settingsWindow?.show();
    settingsWindow?.focus();
  });
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
  ipcMain.handle("todos:getCalendar", (_event, year, month) => store.getCalendar(year, month));
  ipcMain.handle("settings:get", () => store.getSettings());
  ipcMain.handle("settings:setDesktopAttachEnabled", async (_event, enabled) => {
    const settings = store.setDesktopAttachEnabled(enabled);
    if (enabled && widgetWindow) {
      const attached = await attachWindowToDesktop(widgetWindow);
      widgetWindow.webContents.send("desktop-attach:result", attached);
    }
    return settings;
  });
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
  ipcMain.handle("settings:setShortcut", (_event, shortcut) => registerShortcut(shortcut));
  ipcMain.handle("windows:openAddTodo", () => createAddTodoWindow());
  ipcMain.handle("windows:openCalendar", () => createCalendarWindow());
  ipcMain.handle("windows:openSettings", () => createSettingsWindow());
  ipcMain.handle("windows:closeCurrent", (event) => BrowserWindow.fromWebContents(event.sender)?.hide());
  ipcMain.handle("windows:hideWidget", () => widgetWindow?.hide());
  ipcMain.handle("windows:showWidget", () => showWidgetWindow());
  ipcMain.handle("app:quit", () => app.quit());
};
const registerShortcut = (requestedShortcut) => {
  globalShortcut.unregisterAll();
  const preferredShortcut = requestedShortcut ? normalizeShortcut(requestedShortcut) : store.getSettings().shortcut;
  const shortcutCandidates = requestedShortcut ? [preferredShortcut] : [preferredShortcut, ...fallbackShortcuts].filter((shortcut, index, shortcuts) => shortcuts.indexOf(shortcut) === index);
  for (const shortcut of shortcutCandidates) {
    let registered = false;
    try {
      registered = globalShortcut.register(shortcut, () => {
        void createAddTodoWindow();
      });
    } catch {
      registered = false;
    }
    if (registered) {
      store.setShortcut(shortcut);
      if (shortcut !== preferredShortcut) {
        console.warn(`Preferred shortcut unavailable. Registered fallback shortcut: ${shortcut}`);
      }
      broadcastSettings();
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
    registerShortcut();
  }
  return {
    settings: store.getSettings(),
    registered: false,
    requestedShortcut: preferredShortcut,
    activeShortcut: store.getSettings().shortcut
  };
};
const createTray = () => {
  const appIcon = nativeImage.createFromPath(process.execPath);
  const trayIcon = appIcon.isEmpty() ? nativeImage.createFromDataURL(fallbackTrayIconDataUrl) : appIcon.resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon);
  tray.setToolTip("桌面代办");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      // {
      //   label: "快捷添加",
      //   click: () => void createAddTodoWindow()
      // },
      // {
      //   label: "完成日历",
      //   click: () => void createCalendarWindow()
      // },
      // {
      //   label: "设置",
      //   click: () => void createSettingsWindow()
      // },
      //{ type: "separator" },
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
  registerShortcut();
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
