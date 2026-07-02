import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, screen, Tray } from "electron";
import { join } from "node:path";
import { attachWindowToDesktop } from "./desktop/attachToDesktop";
import { TodoStore } from "./todoStore";
import type { TodoDraft, WindowBounds } from "../src/types/todo";

let widgetWindow: BrowserWindow | null = null;
let addTodoWindow: BrowserWindow | null = null;
let calendarWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let store: TodoStore;
let saveBoundsTimer: NodeJS.Timeout | undefined;

const rendererUrl = process.env.ELECTRON_RENDERER_URL;
const fallbackShortcuts = ["CommandOrControl+Alt+T", "CommandOrControl+Alt+N", "CommandOrControl+Shift+Space"];
const fallbackTrayIconDataUrl =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0284c7"/><path d="M9 16.5l4 4L23 10.5" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  );

const loadRenderer = async (window: BrowserWindow, view: "widget" | "add" | "calendar"): Promise<void> => {
  if (rendererUrl) {
    await window.loadURL(`${rendererUrl}?view=${view}`);
    return;
  }

  await window.loadFile(join(__dirname, "../renderer/index.html"), {
    query: { view }
  });
};

const broadcastSnapshot = (): void => {
  const snapshot = store.getSnapshot();
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("todos:changed", snapshot);
  }
};

const showWidgetWindow = (): void => {
  if (!widgetWindow) {
    void createWidgetWindow();
    return;
  }

  widgetWindow.showInactive();
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
    skipTaskbar: true,
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
  widgetWindow.on("closed", () => {
    widgetWindow = null;
  });

  await loadRenderer(widgetWindow, "widget");
  widgetWindow.once("ready-to-show", async () => {
    widgetWindow?.showInactive();

    if (settings.desktopAttachEnabled && widgetWindow) {
      const attached = await attachWindowToDesktop(widgetWindow);
      widgetWindow.webContents.send("desktop-attach:result", attached);
    }
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
  ipcMain.handle("settings:setShortcut", (_event, shortcut: string) => registerShortcut(shortcut));
  ipcMain.handle("windows:openAddTodo", () => createAddTodoWindow());
  ipcMain.handle("windows:openCalendar", () => createCalendarWindow());
  ipcMain.handle("windows:closeCurrent", (event) => BrowserWindow.fromWebContents(event.sender)?.hide());
  ipcMain.handle("windows:hideWidget", () => widgetWindow?.hide());
  ipcMain.handle("windows:showWidget", () => showWidgetWindow());
  ipcMain.handle("app:quit", () => app.quit());
}

const registerShortcut = (requestedShortcut?: string): ReturnType<TodoStore["getSettings"]> => {
  globalShortcut.unregisterAll();
  const preferredShortcut = requestedShortcut?.trim() || store.getSettings().shortcut;
  const shortcutCandidates = [preferredShortcut, ...fallbackShortcuts].filter(
    (shortcut, index, shortcuts) => shortcuts.indexOf(shortcut) === index
  );

  for (const shortcut of shortcutCandidates) {
    const registered = globalShortcut.register(shortcut, () => {
      void createAddTodoWindow();
    });

    if (registered) {
      store.setShortcut(shortcut);
      if (shortcut !== preferredShortcut) {
        console.warn(`Preferred shortcut unavailable. Registered fallback shortcut: ${shortcut}`);
      }
      return store.getSettings();
    }
  }

  console.warn(`Failed to register shortcuts: ${shortcutCandidates.join(", ")}`);
  return store.getSettings();
};

const createTray = (): void => {
  const appIcon = nativeImage.createFromPath(process.execPath);
  const trayIcon = appIcon.isEmpty() ? nativeImage.createFromDataURL(fallbackTrayIconDataUrl) : appIcon.resize({ width: 16, height: 16 });

  tray = new Tray(trayIcon);
  tray.setToolTip("桌面代办");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "显示组件",
        click: () => showWidgetWindow()
      },
      {
        label: "快捷添加",
        click: () => void createAddTodoWindow()
      },
      {
        label: "完成日历",
        click: () => void createCalendarWindow()
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => app.quit()
      }
    ])
  );
  tray.on("click", () => showWidgetWindow());
};

const boot = async (): Promise<void> => {
  store = new TodoStore();
  store.setDesktopAttachEnabled(true);
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
