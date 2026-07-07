/**
 * Electron 主进程入口。
 *
 * 职责概览：
 * - 管理四个 BrowserWindow：桌面挂件、快捷添加、完成日历、设置
 * - 通过 TodoStore 读写 todos.json，经 IPC 与渲染进程通信
 * - 注册全局快捷键（快捷添加 / 显示挂件）与系统托盘
 * - 控制挂件两种显示模式：贴桌面（WorkerW 子窗口）或悬浮置顶
 *
 * 启动顺序：configureUserDataPath → requestSingleInstanceLock → app.whenReady → boot
 */
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, screen, Tray } from "electron";
import { join } from "node:path";
import { configureUserDataPath, getAppIconPath } from "./appPaths";
import { attachWindowToDesktop, detachWindowFromDesktop } from "./desktop/attachToDesktop";
import { TodoStore } from "./todoStore";
import { checkForUpdates, getAppVersionInfo, getUpdateStatus, quitAndInstallUpdate, setupAutoUpdater } from "./updater";
import type { ShortcutRegistrationResult, TodoDraft, TodoUpdate, WindowBounds } from "../src/types/todo";

/** 桌面挂件窗口（无边框透明，可贴桌面或悬浮） */
let widgetWindow: BrowserWindow | null = null;
/** 全局快捷键唤起的快捷添加浮窗 */
let addTodoWindow: BrowserWindow | null = null;
/** 完成日历独立窗口 */
let calendarWindow: BrowserWindow | null = null;
/** 偏好设置独立窗口 */
let settingsWindow: BrowserWindow | null = null;
/** 系统托盘图标，点击可临时显示挂件 */
let tray: Tray | null = null;
/** 待办数据持久化层，构造时即加载 todos.json */
let store: TodoStore;
/** 防抖定时器：窗口 move/resize 后 300ms 再写入 widgetBounds */
let saveBoundsTimer: NodeJS.Timeout | undefined;
/** 用户手动开启的「始终置顶」模式（设置里 pin 按钮） */
let pinnedFloat = false;
/** 托盘/快捷键触发的临时悬浮，失焦后自动贴回桌面 */
let temporaryFloat = false;
/** 桌面附着失败时的延迟重试定时器 */
let desktopAttachTimer: NodeJS.Timeout | undefined;

/** 当前是否处于悬浮模式（手动置顶 或 临时显示） */
const isFloating = (): boolean => pinnedFloat || temporaryFloat;

/** 开发模式下 Vite 热更新地址；生产环境为 undefined，走 loadFile */
const rendererUrl = process.env.ELECTRON_RENDERER_URL;
/** 首选快捷键注册失败时依次尝试的备选组合 */
const fallbackShortcuts = ["CommandOrControl+Alt+T", "CommandOrControl+Alt+N", "CommandOrControl+Shift+Space"];

const loadAppIcon = () => {
  const icon = nativeImage.createFromPath(getAppIconPath());
  return icon.isEmpty() ? nativeImage.createFromPath(process.execPath) : icon;
};

/**
 * 加载渲染页面。四个窗口共用同一 index.html，通过 ?view= 区分组件。
 * 开发：http://localhost:xxx?view=widget；生产：file://.../index.html?view=widget
 */
const loadRenderer = async (window: BrowserWindow, view: "widget" | "add" | "calendar" | "settings"): Promise<void> => {
  if (rendererUrl) {
    await window.loadURL(`${rendererUrl}?view=${view}`);
    return;
  }

  await window.loadFile(join(__dirname, "../renderer/index.html"), {
    query: { view }
  });
};

/**
 * 将用户输入的快捷键字符串规范化为 Electron globalShortcut 格式。
 * 例："ctrl+alt+t" → "CommandOrControl+Alt+T"
 */
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

/** 待办数据变更后，向所有已打开窗口推送最新快照，保持 UI 同步 */
const broadcastSnapshot = (): void => {
  const snapshot = store.getSnapshot();
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("todos:changed", snapshot);
  }
};

/** 设置变更后广播给所有窗口（快捷键、开机启动等） */
const broadcastSettings = (): void => {
  const settings = store.getSettings();
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("settings:changed", settings);
  }
};

/** 置顶状态切换后通知挂件 UI 更新 pin 按钮样式 */
const broadcastFloatState = (): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("widget:float-state-changed", pinnedFloat);
  }
};

/** 显示挂件窗口：置顶模式聚焦显示，桌面模式仅 showInactive 避免抢焦点。 */
const showWidgetWindow = (): void => {
  if (!widgetWindow) {
    void createWidgetWindow();
    return;
  }

  if (isFloating()) {
    widgetWindow.setAlwaysOnTop(true, "floating");
    widgetWindow.setSkipTaskbar(false);
    widgetWindow.moveTop();
    widgetWindow.show();
    widgetWindow.focus();
    return;
  }

  widgetWindow.showInactive();
};

/** 托盘点击或快捷键触发：未开启置顶时临时浮到当前页面，失焦后回到桌面。 */
const showWidgetOnCurrentPage = async (): Promise<void> => {
  if (pinnedFloat) {
    showWidgetWindow();
    return;
  }

  temporaryFloat = true;

  if (!widgetWindow) {
    await createWidgetWindow();
    return;
  }

  await applyWidgetDisplayMode();
};

/** 从悬浮状态贴回桌面（仅用于关闭置顶或临时显示结束）。 */
const returnWidgetToDesktop = async (): Promise<void> => {
  if (pinnedFloat || !isFloating()) {
    return;
  }

  temporaryFloat = false;

  if (!widgetWindow) {
    await createWidgetWindow();
    return;
  }

  await applyWidgetDisplayMode();
};

/** 同步 Windows 登录项设置，与 todos.json 中的 launchAtLogin 保持一致 */
const applyLoginSetting = (enabled: boolean): void => {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath
  });
};

/** 应用挂件显示：置顶悬浮时浮在当前页面上方，否则贴到桌面 WorkerW。 */
const applyWidgetDisplayMode = async (): Promise<void> => {
  if (!widgetWindow) return;

  const bounds = widgetWindow.getBounds();

  if (isFloating()) {
    detachWindowFromDesktop(widgetWindow);
    widgetWindow.setBounds(bounds);
    widgetWindow.setSkipTaskbar(false);
    widgetWindow.setAlwaysOnTop(true, "floating");
    widgetWindow.show();
    widgetWindow.focus();
    widgetWindow.moveTop();
    widgetWindow.webContents.send("desktop-attach:result", true);
    return;
  }

  widgetWindow.setAlwaysOnTop(false);
  widgetWindow.setSkipTaskbar(true);
  detachWindowFromDesktop(widgetWindow);
  widgetWindow.setBounds(bounds);
  widgetWindow.show();
  const attached = await attachWindowToDesktop(widgetWindow);
  widgetWindow.showInactive();
  widgetWindow.webContents.send("desktop-attach:result", attached);
  scheduleDesktopAttachRetries();
};

/** 桌面附着可能因 Explorer 未就绪失败，延迟重试数次。 */
const scheduleDesktopAttachRetries = (): void => {
  clearTimeout(desktopAttachTimer);
  if (!widgetWindow || isFloating()) {
    return;
  }

  const delays = [150, 600, 1500];
  const retry = async (index: number): Promise<void> => {
    if (!widgetWindow || isFloating()) {
      return;
    }

    widgetWindow.show();
    const attached = await attachWindowToDesktop(widgetWindow);
    widgetWindow.showInactive();
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

/** 首次启动或无保存位置时，默认放在主屏工作区右上角 */
const defaultWidgetBounds = (): WindowBounds => {
  const display = screen.getPrimaryDisplay().workArea;
  return {
    x: display.x + display.width - 360,
    y: display.y + 72,
    width: 320,
    height: 460
  };
};

/** 拖动/缩放挂件时防抖写入 widgetBounds，避免频繁写盘 */
const persistWidgetBounds = (): void => {
  if (!widgetWindow) return;

  clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(() => {
    if (!widgetWindow) return;
    store.updateWidgetBounds(widgetWindow.getBounds());
  }, 300);
};

/**
 * 创建桌面挂件窗口。
 * - 无边框 + 透明背景，配合 CSS 实现圆角卡片
 * - blur 事件：临时悬浮模式下失焦 120ms 后贴回桌面
 * - ready-to-show 后调用 applyWidgetDisplayMode 决定贴桌面或置顶
 */
const createWidgetWindow = async (): Promise<void> => {
  const bounds = store.getSettings().widgetBounds ?? defaultWidgetBounds();

  widgetWindow = new BrowserWindow({
    ...bounds,
    minWidth: 280,
    minHeight: 360,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: true,
    skipTaskbar: !isFloating(),
    show: false,
    title: "桌面代办",
    icon: getAppIconPath(),
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
    if (pinnedFloat || !temporaryFloat) {
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

/** 创建或聚焦快捷添加窗口；失焦自动 hide，不销毁实例以便复用 */
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
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    title: "添加代办",
    icon: getAppIconPath(),
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
    backgroundColor: "#f1f5f9",
    icon: getAppIconPath(),
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

  settingsWindow = new BrowserWindow({
    width: 520,
    height: 640,
    minWidth: 420,
    minHeight: 520,
    title: "设置",
    show: false,
    backgroundColor: "#f1f5f9",
    icon: getAppIconPath(),
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

/** 设置写入 store 后广播，并返回最新 settings 供 IPC 响应 */
const applySettings = (settings: ReturnType<TodoStore["getSettings"]>): ReturnType<TodoStore["getSettings"]> => {
  broadcastSettings();
  return settings;
};

/** 注册渲染进程 IPC：待办 CRUD、设置、窗口控制。 */
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
  ipcMain.handle("todos:update", (_event, id: string, update: TodoUpdate) => {
    const snapshot = store.updateTodo(id, update);
    broadcastSnapshot();
    return snapshot;
  });
  ipcMain.handle("todos:setRating", (_event, id: string, rating: number) => {
    const snapshot = store.setTodoRating(id, rating);
    broadcastSnapshot();
    return snapshot;
  });
  ipcMain.handle("todos:getCalendar", (_event, year: number, month: number) => store.getCalendar(year, month));
  ipcMain.handle("settings:get", () => store.getSettings());
  ipcMain.handle("settings:setLaunchAtLogin", (_event, enabled: boolean) => {
    applyLoginSetting(enabled);
    return applySettings(store.setLaunchAtLogin(enabled));
  });
  ipcMain.handle("settings:setShortcut", (_event, shortcut: string) => updateShortcut("quickAdd", shortcut));
  ipcMain.handle("settings:setShowWidgetShortcut", (_event, shortcut: string) => updateShortcut("showWidget", shortcut));
  ipcMain.handle("windows:openAddTodo", () => createAddTodoWindow());
  ipcMain.handle("windows:openCalendar", () => createCalendarWindow());
  ipcMain.handle("windows:openSettings", () => createSettingsWindow());
  ipcMain.handle("windows:closeCurrent", (event) => BrowserWindow.fromWebContents(event.sender)?.hide());
  ipcMain.handle("widget:getFloatOnPage", () => pinnedFloat);
  ipcMain.handle("widget:toggleFloatOnPage", async () => {
    pinnedFloat = !pinnedFloat;
    temporaryFloat = false;
    broadcastFloatState();

    if (!widgetWindow) {
      await createWidgetWindow();
    } else {
      await applyWidgetDisplayMode();
    }

    return pinnedFloat;
  });
  ipcMain.handle("widget:minimize", () => {
    widgetWindow?.hide();
  });
  ipcMain.handle("app:quit", () => app.quit());
  ipcMain.handle("app:getVersion", () => getAppVersionInfo());
  ipcMain.handle("app:getUpdateStatus", () => getUpdateStatus());
  ipcMain.handle("app:checkForUpdates", () => checkForUpdates());
  ipcMain.handle("app:quitAndInstall", () => quitAndInstallUpdate());
}

/** 两类全局快捷键：唤起添加窗口 / 临时显示挂件 */
type ShortcutKind = "quickAdd" | "showWidget";

const getShortcutValue = (kind: ShortcutKind): string =>
  kind === "quickAdd" ? store.getSettings().shortcut : store.getSettings().showWidgetShortcut;

const setShortcutValue = (kind: ShortcutKind, shortcut: string): void => {
  if (kind === "quickAdd") {
    store.setShortcut(shortcut);
    return;
  }

  store.setShowWidgetShortcut(shortcut);
};

const runShortcutAction = (kind: ShortcutKind): void => {
  if (kind === "quickAdd") {
    void createAddTodoWindow();
    return;
  }

  void showWidgetOnCurrentPage();
};

/**
 * 注册单个全局快捷键。
 * - 首选组合被占用时依次尝试 fallbackShortcuts
 * - 全部失败则保留原设置并返回 registered: false
 */
const registerShortcut = (kind: ShortcutKind, requestedShortcut?: string): ShortcutRegistrationResult => {
  const preferredShortcut = requestedShortcut ? normalizeShortcut(requestedShortcut) : getShortcutValue(kind);
  const shortcutCandidates = requestedShortcut
    ? [preferredShortcut]
    : [preferredShortcut, ...fallbackShortcuts].filter((shortcut, index, shortcuts) => shortcuts.indexOf(shortcut) === index);

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

const registerGlobalShortcuts = (): void => {
  globalShortcut.unregisterAll();
  registerShortcut("quickAdd");
  registerShortcut("showWidget");
};

/**
 * 用户修改快捷键时调用。
 * 先检查是否与另一类快捷键冲突，再 unregisterAll 后分别重注册两个快捷键。
 */
const updateShortcut = (kind: ShortcutKind, shortcut: string): ShortcutRegistrationResult => {
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

/** 创建系统托盘：左键临时显示挂件，右键菜单仅「退出」 */
const createTray = (): void => {
  const trayIcon = loadAppIcon().resize({ width: 16, height: 16 });

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

/** 应用启动：初始化存储、窗口、全局快捷键与托盘。 */
const boot = async (): Promise<void> => {
  store = new TodoStore();
  applyLoginSetting(store.getSettings().launchAtLogin);
  store.refreshDaily();
  registerIpc();
  await createWidgetWindow();
  registerGlobalShortcuts();
  createTray();
  setupAutoUpdater();
};

// 须在 requestSingleInstanceLock / TodoStore 之前执行，见 appPaths.ts
configureUserDataPath();

// 单实例锁：已有实例运行时，第二次启动会触发 second-instance 并聚焦挂件
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
