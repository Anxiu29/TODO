import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, screen, Tray } from "electron";
import { join } from "node:path";
import { attachWindowToDesktop } from "./desktop/attachToDesktop";
import { TodoStore } from "./todoStore";
import type { ShortcutRegistrationResult, TodoDraft, WidgetDisplayMode, WindowBounds } from "../src/types/todo";

let widgetWindow: BrowserWindow | null = null;
let addTodoWindow: BrowserWindow | null = null;
let calendarWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let store: TodoStore;
let saveBoundsTimer: NodeJS.Timeout | undefined;
let showOnCurrentPageOverride = false;
let desktopAttachTimer: NodeJS.Timeout | undefined;

const rendererUrl = process.env.ELECTRON_RENDERER_URL;
const fallbackShortcuts = ["CommandOrControl+Alt+T", "CommandOrControl+Alt+N", "CommandOrControl+Shift+Space"];
const fallbackTrayIconDataUrl =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0284c7"/><path d="M9 16.5l4 4L23 10.5" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  );

const loadRenderer = async (window: BrowserWindow, view: "widget" | "add" | "calendar" | "settings"): Promise<void> => {
  if (rendererUrl) {
    await window.loadURL(`${rendererUrl}?view=${view}`);
    return;
  }

  await window.loadFile(join(__dirname, "../renderer/index.html"), {
    query: { view }
  });
};

const normalizeShortcut = (input: string): string => {
  const parts = input
    .trim()
    .replace(/\s+/g, "")
    .split("+")
    .filter(Boolean);

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

const broadcastSnapshot = (): void => {
  const snapshot = store.getSnapshot();
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("todos:changed", snapshot);
  }
};

const broadcastSettings = (): void => {
  const settings = store.getSettings();
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("settings:changed", settings);
  }
};

const showWidgetWindow = (): void => {
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

const showWidgetOnCurrentPage = async (): Promise<void> => {
  const needsRecreate = store.getSettings().displayMode !== "float" && !showOnCurrentPageOverride;
  showOnCurrentPageOverride = true;

  if (!widgetWindow || needsRecreate) {
    await recreateWidgetWindow();
    return;
  }

  showWidgetWindow();
};

const returnWidgetToDesktop = async (): Promise<void> => {
  if (store.getSettings().displayMode !== "desktop" || !showOnCurrentPageOverride) {
    return;
  }

  showOnCurrentPageOverride = false;
  await recreateWidgetWindow();
};

const applyLoginSetting = (enabled: boolean): void => {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath
  });
};

const recreateWidgetWindow = async (): Promise<void> => {
  const existingWindow = widgetWindow;
  widgetWindow = null;
  clearTimeout(desktopAttachTimer);
  if (existingWindow && !existingWindow.isDestroyed()) {
    store.updateWidgetBounds(existingWindow.getBounds());
    existingWindow.destroy();
  }
  await createWidgetWindow();
};

const applyWidgetDisplayMode = async (): Promise<void> => {
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

const scheduleDesktopAttachRetries = (): void => {
  clearTimeout(desktopAttachTimer);
  if (!widgetWindow || store.getSettings().displayMode !== "desktop" || showOnCurrentPageOverride) {
    return;
  }

  const delays = [150, 600, 1500];
  const retry = async (index: number): Promise<void> => {
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

const defaultWidgetBounds = (): WindowBounds => {
  const display = screen.getPrimaryDisplay().workArea;
  return {
    x: display.x + display.width - 360,
    y: display.y + 72,
    width: 320,
    height: 460
  };
};

const persistWidgetBounds = (): void => {
  if (!widgetWindow) return;

  clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(() => {
    if (!widgetWindow) return;
    store.updateWidgetBounds(widgetWindow.getBounds());
  }, 300);
};

const createWidgetWindow = async (): Promise<void> => {
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

const createAddTodoWindow = async (): Promise<void> => {
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

const createCalendarWindow = async (): Promise<void> => {
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

const createSettingsWindow = async (): Promise<void> => {
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

const applySettings = (settings: ReturnType<TodoStore["getSettings"]>): ReturnType<TodoStore["getSettings"]> => {
  broadcastSettings();
  return settings;
};

const registerIpc = (): void => {
  ipcMain.handle("todos:getSnapshot", () => store.refreshDaily());
  ipcMain.handle("todos:add", (_event, draft: TodoDraft) => {
    const snapshot = store.addTodo(draft);
    broadcastSnapshot();
    return snapshot;
  });
  ipcMain.handle("todos:complete", (_event, id: string) => {
    const snapshot = store.completeTodo(id);
    broadcastSnapshot();
    return snapshot;
  });
  ipcMain.handle("todos:reopen", (_event, id: string) => {
    const snapshot = store.reopenTodo(id);
    broadcastSnapshot();
    return snapshot;
  });
  ipcMain.handle("todos:delete", (_event, id: string) => {
    const snapshot = store.deleteTodo(id);
    broadcastSnapshot();
    return snapshot;
  });
  ipcMain.handle("todos:getCalendar", (_event, year: number, month: number) => store.getCalendar(year, month));
  ipcMain.handle("settings:get", () => store.getSettings());
  ipcMain.handle("settings:setDesktopAttachEnabled", async (_event, enabled: boolean) => {
    const settings = store.setDesktopAttachEnabled(enabled);
    if (enabled && widgetWindow) {
      const attached = await attachWindowToDesktop(widgetWindow);
      widgetWindow.webContents.send("desktop-attach:result", attached);
    }
    return settings;
  });
  ipcMain.handle("settings:setDisplayMode", async (_event, displayMode: WidgetDisplayMode) => {
    showOnCurrentPageOverride = false;
    const settings = store.setDisplayMode(displayMode);
    await recreateWidgetWindow();
    return applySettings(settings);
  });
  ipcMain.handle("settings:setLaunchAtLogin", (_event, enabled: boolean) => {
    applyLoginSetting(enabled);
    return applySettings(store.setLaunchAtLogin(enabled));
  });
  ipcMain.handle("settings:setShortcut", (_event, shortcut: string) => registerShortcut(shortcut));
  ipcMain.handle("windows:openAddTodo", () => createAddTodoWindow());
  ipcMain.handle("windows:openCalendar", () => createCalendarWindow());
  ipcMain.handle("windows:openSettings", () => createSettingsWindow());
  ipcMain.handle("windows:closeCurrent", (event) => BrowserWindow.fromWebContents(event.sender)?.hide());
  ipcMain.handle("windows:hideWidget", () => widgetWindow?.hide());
  ipcMain.handle("windows:showWidget", () => showWidgetWindow());
  ipcMain.handle("app:quit", () => app.quit());
}

const registerShortcut = (requestedShortcut?: string): ShortcutRegistrationResult => {
  globalShortcut.unregisterAll();
  const preferredShortcut = requestedShortcut ? normalizeShortcut(requestedShortcut) : store.getSettings().shortcut;
  const shortcutCandidates = requestedShortcut
    ? [preferredShortcut]
    : [preferredShortcut, ...fallbackShortcuts].filter((shortcut, index, shortcuts) => shortcuts.indexOf(shortcut) === index);

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

const createTray = (): void => {
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

const boot = async (): Promise<void> => {
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
  // Keep the app alive so the global shortcut can reopen the quick-add window.
});
