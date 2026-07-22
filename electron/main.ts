/**
 * Electron 主进程入口。
 *
 * 职责概览：
 * - 管理四个 BrowserWindow：桌面挂件、快捷添加、完成日历、设置
 * - 通过 TodoStore 读写 todos.json，经 IPC 与渲染进程通信
 * - 注册全局快捷键（快捷添加 / 显示挂件）与系统托盘
 * - 控制挂件显示模式：普通窗口、贴桌面（WorkerW 子窗口）或悬浮置顶
 *
 * 启动顺序：configureUserDataPath → requestSingleInstanceLock → app.whenReady → boot
 */
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, screen, Tray } from "electron";
import { join } from "node:path";
import { configureUserDataPath, getAppIconPath, getLoginExecutablePath } from "./appPaths";
import {
  attachWindowToDesktop,
  detachWindowFromDesktop,
  isWindowDesktopAttached,
  syncDesktopWindowBounds
} from "./desktop/attachToDesktop";
import { TodoStore } from "./todoStore";
import { checkForUpdates, dismissUpdate, downloadUpdate, getAppVersionInfo, getUpdateStatus, quitAndInstallUpdate, setupAutoUpdater } from "./updater";
import type { ShortcutRegistrationResult, TodoDraft, TodoUpdate, WidgetDisplayMode, WindowBounds } from "../src/types/todo";

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
/** 用户手动开启的「始终置顶」模式（挂件右上角 pin 按钮） */
let pinnedFloat = false;
/** 托盘/快捷键触发的临时悬浮，失焦后自动贴回桌面 */
let temporaryFloat = false;
/** 桌面附着失败时的延迟重试定时器 */
let desktopAttachTimer: NodeJS.Timeout | undefined;
/** 点击进入拖动准备后，如果没有真的移动，自动恢复桌面附着 */
let dragAttachFallbackTimer: NodeJS.Timeout | undefined;
/** 拖动前已从桌面脱离，待 moved 后重新附着 */
let widgetDragDetached = false;
/** 缩放结束后重新附着的防抖定时器 */
let resizeReattachTimer: NodeJS.Timeout | undefined;
/** 缩放过程中是否已从桌面层脱离 */
let widgetResizeDetached = false;

/** 当前是否处于悬浮模式（手动置顶 或 临时显示） */
const isFloating = (): boolean => pinnedFloat || temporaryFloat;

/** 快捷添加窗口是否正在显示（用于避免其它窗口抢焦点导致其立即 hide） */
const isAddTodoWindowOpen = (): boolean =>
  !!addTodoWindow && !addTodoWindow.isDestroyed() && addTodoWindow.isVisible();

/** 挂件抢焦点前确认不会关掉快捷添加 */
const focusWidgetIfSafe = (): void => {
  if (!widgetWindow || isAddTodoWindowOpen()) {
    return;
  }
  widgetWindow.focus();
};

/** 基础显示模式是否为贴到 Windows 桌面层 */
const isDesktopDisplayMode = (): boolean => store.getSettings().displayMode === "desktop";

/** 开发模式下 Vite 热更新地址；生产环境为 undefined，走 loadFile */
const rendererUrl = process.env.ELECTRON_RENDERER_URL;
/** 首选快捷键注册失败时依次尝试的备选组合 */
const fallbackShortcuts = ["CommandOrControl+2", "CommandOrControl+Alt+T", "CommandOrControl+Alt+N"];

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

/** 显示挂件窗口：置顶/普通模式聚焦显示，桌面固定模式仅 showInactive 避免抢焦点。 */
const showWidgetWindow = (): void => {
  if (!widgetWindow) {
    void createWidgetWindow();
    return;
  }

  if (isFloating()) {
    widgetWindow.setAlwaysOnTop(true, "floating");
    widgetWindow.setSkipTaskbar(true);
    widgetWindow.setMinimizable(false);
    widgetWindow.moveTop();
    widgetWindow.show();
    focusWidgetIfSafe();
    return;
  }

  if (!isDesktopDisplayMode()) {
    widgetWindow.setAlwaysOnTop(false);
    widgetWindow.setMinimizable(true);
    widgetWindow.setSkipTaskbar(false);
    widgetWindow.moveTop();
    widgetWindow.show();
    focusWidgetIfSafe();
    return;
  }

  widgetWindow.showInactive();
};

/** 托盘点击或快捷键触发：桌面固定模式临时浮到当前页面；普通模式直接显示。 */
const showWidgetOnCurrentPage = async (): Promise<void> => {
  if (pinnedFloat) {
    showWidgetWindow();
    return;
  }

  if (!isDesktopDisplayMode()) {
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

/** 从临时悬浮状态贴回桌面固定层。 */
const returnWidgetToDesktop = async (): Promise<void> => {
  if (pinnedFloat || !temporaryFloat || !isDesktopDisplayMode()) {
    return;
  }

  temporaryFloat = false;

  if (!widgetWindow) {
    await createWidgetWindow();
    return;
  }

  await applyWidgetDisplayMode();
};

/** 桌面固定模式下，鼠标进入后预先激活窗口，避免第一次点击只用于激活而不触发按钮。 */
const wakeWidgetForInteraction = (): void => {
  if (!widgetWindow || isFloating() || !isDesktopDisplayMode()) {
    return;
  }

  // 快捷添加打开时勿抢焦点，否则会触发 add 窗口 blur→hide
  if (isAddTodoWindowOpen()) {
    return;
  }

  widgetWindow.show();
  focusWidgetIfSafe();
};

/** 桌面固定失败时降级为可交互的普通窗口，避免黑边/无法点击。 */
const applyNormalWidgetFallback = (bounds?: WindowBounds): void => {
  if (!widgetWindow) return;

  clearTimeout(dragAttachFallbackTimer);
  widgetDragDetached = false;
  detachWindowFromDesktop(widgetWindow);
  if (bounds) {
    widgetWindow.setBounds(bounds);
  }
  widgetWindow.setAlwaysOnTop(false);
  widgetWindow.setMinimizable(true);
  widgetWindow.setSkipTaskbar(false);
  widgetWindow.show();
  focusWidgetIfSafe();
  widgetWindow.webContents.send("desktop-attach:result", false);
};

const attachDesktopWidget = async (): Promise<boolean> => {
  if (!widgetWindow || isFloating() || !isDesktopDisplayMode()) {
    return false;
  }

  widgetWindow.setAlwaysOnTop(false);
  widgetWindow.setMinimizable(false);
  widgetWindow.setSkipTaskbar(true);

  const attached = await attachWindowToDesktop(widgetWindow);
  if (attached) {
    widgetWindow.showInactive();
    widgetWindow.webContents.send("desktop-attach:result", true);
    return true;
  }

  detachWindowFromDesktop(widgetWindow);
  widgetWindow.setMinimizable(true);
  widgetWindow.setSkipTaskbar(false);
  widgetWindow.show();
  return false;
};

/** 规范化 exe 路径，便于比较注册表中的登录项路径是否过期 */
const normalizeExecPath = (filePath: string): string => filePath.replace(/\\/g, "/").toLowerCase();

/** 写入 Windows 登录项（Run 注册表），便携版注册外层 exe，安装版注册当前 exe */
const applyLoginSetting = (enabled: boolean): void => {
  if (!app.isPackaged) {
    return;
  }

  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: getLoginExecutablePath()
  });
};

/**
 * 将系统登录项与 todos.json 对齐。
 * 开启时若路径过期（升级/移动 exe 后常见），自动用当前路径刷新，保证下次开机能拉起。
 */
const syncLoginSetting = (): void => {
  if (!app.isPackaged) {
    return;
  }

  const desired = store.getSettings().launchAtLogin;
  const loginExecutablePath = getLoginExecutablePath();
  const current = app.getLoginItemSettings({ path: loginExecutablePath });
  const execPath = normalizeExecPath(loginExecutablePath);

  if (desired) {
    const registeredPath = current.launchItems.find((item) => item.enabled)?.path;
    const pathStale = !registeredPath || normalizeExecPath(registeredPath) !== execPath;
    if (!current.openAtLogin || pathStale) {
      applyLoginSetting(true);
    }
    return;
  }

  if (current.openAtLogin) {
    applyLoginSetting(false);
  }
};

/** 应用挂件显示：置顶/临时悬浮优先；否则按设置选择普通窗口或桌面固定层。 */
const applyWidgetDisplayMode = async (): Promise<void> => {
  if (!widgetWindow) return;

  const bounds = widgetWindow.getBounds();

  if (isFloating()) {
    clearTimeout(dragAttachFallbackTimer);
    widgetDragDetached = false;
    detachWindowFromDesktop(widgetWindow);
    widgetWindow.setBounds(bounds);
    widgetWindow.setSkipTaskbar(true);
    widgetWindow.setMinimizable(false);
    widgetWindow.setAlwaysOnTop(true, "floating");
    widgetWindow.show();
    focusWidgetIfSafe();
    widgetWindow.moveTop();
    widgetWindow.webContents.send("desktop-attach:result", true);
    return;
  }

  if (!isDesktopDisplayMode()) {
    clearTimeout(dragAttachFallbackTimer);
    widgetDragDetached = false;
    detachWindowFromDesktop(widgetWindow);
    widgetWindow.setBounds(bounds);
    widgetWindow.setAlwaysOnTop(false);
    widgetWindow.setMinimizable(true);
    widgetWindow.setSkipTaskbar(false);
    widgetWindow.show();
    widgetWindow.webContents.send("desktop-attach:result", true);
    return;
  }

  clearTimeout(dragAttachFallbackTimer);
  widgetDragDetached = false;
  widgetResizeDetached = false;
  const attached = await attachDesktopWidget();
  if (!attached) {
    scheduleDesktopAttachRetries();
    return;
  }

  clearTimeout(desktopAttachTimer);
};

/** 确保挂件创建后一定会显示（部分机器上 ready-to-show 可能不触发） */
const revealWidgetWindow = (): void => {
  if (!widgetWindow) return;

  const bounds = getWidgetBounds();
  widgetWindow.setBounds(bounds);
  void applyWidgetDisplayMode();
};

/** 桌面附着可能因 Explorer 未就绪失败，延迟重试数次。 */
const scheduleDesktopAttachRetries = (): void => {
  clearTimeout(desktopAttachTimer);
  if (!widgetWindow || isFloating() || !isDesktopDisplayMode()) {
    return;
  }

  const delays = [150, 600, 1500, 3000, 5000];
  const retry = async (index: number): Promise<void> => {
    if (!widgetWindow || isFloating() || !isDesktopDisplayMode()) {
      return;
    }

    const attached = await attachDesktopWidget();

    if (attached) {
      return;
    }

    if (index + 1 < delays.length) {
      desktopAttachTimer = setTimeout(() => {
        void retry(index + 1);
      }, delays[index + 1]);
      return;
    }

    applyNormalWidgetFallback();
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

/** 将保存的窗口位置限制在当前可见屏幕内，避免换电脑后跑到屏幕外 */
const clampWidgetBounds = (bounds: WindowBounds): WindowBounds => {
  const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
  const area = display.workArea;
  const width = Math.min(Math.max(bounds.width, 280), area.width);
  const height = Math.min(Math.max(bounds.height, 360), area.height);
  const x = Math.min(Math.max(bounds.x, area.x), area.x + area.width - width);
  const y = Math.min(Math.max(bounds.y, area.y), area.y + area.height - height);

  return { x, y, width, height };
};

const getWidgetBounds = (): WindowBounds => {
  const saved = store.getSettings().widgetBounds;
  return clampWidgetBounds(saved ?? defaultWidgetBounds());
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
  const bounds = getWidgetBounds();

  widgetWindow = new BrowserWindow({
    ...bounds,
    minWidth: 280,
    minHeight: 360,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    thickFrame: false,
    resizable: true,
    minimizable: !isDesktopDisplayMode() && !isFloating(),
    skipTaskbar: isDesktopDisplayMode() || isFloating(),
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
  widgetWindow.on("will-resize", () => {
    if (!widgetWindow || isFloating() || !isDesktopDisplayMode() || widgetResizeDetached) {
      return;
    }

    if (!isWindowDesktopAttached(widgetWindow)) {
      return;
    }

    detachWindowFromDesktop(widgetWindow);
    widgetResizeDetached = true;
  });
  widgetWindow.on("moved", () => {
    if (!widgetWindow || isFloating() || !widgetDragDetached) {
      return;
    }

    widgetDragDetached = false;
    clearTimeout(dragAttachFallbackTimer);
    void (async () => {
      await attachDesktopWidget();
    })();
  });
  widgetWindow.on("resize", persistWidgetBounds);
  widgetWindow.on("resized", () => {
    if (!widgetWindow || isFloating() || !isDesktopDisplayMode()) {
      return;
    }

    clearTimeout(resizeReattachTimer);
    resizeReattachTimer = setTimeout(() => {
      if (!widgetWindow || isFloating() || !isDesktopDisplayMode()) {
        return;
      }

      if (widgetResizeDetached) {
        widgetResizeDetached = false;
        void attachDesktopWidget();
        return;
      }

      if (isWindowDesktopAttached(widgetWindow)) {
        syncDesktopWindowBounds(widgetWindow);
      }
    }, 150);
  });
  widgetWindow.on("minimize", () => {
    if (!isFloating()) {
      return;
    }

    setTimeout(() => {
      if (!widgetWindow || !isFloating()) return;
      widgetWindow.restore();
      widgetWindow.showInactive();
      widgetWindow.moveTop();
    }, 80);
  });
  widgetWindow.on("blur", () => {
    if (pinnedFloat || !temporaryFloat) {
      return;
    }

    setTimeout(() => {
      void returnWidgetToDesktop();
    }, 120);
  });
  widgetWindow.on("closed", () => {
    clearTimeout(dragAttachFallbackTimer);
    clearTimeout(resizeReattachTimer);
    widgetDragDetached = false;
    widgetResizeDetached = false;
    widgetWindow = null;
  });

  let revealed = false;
  const revealOnce = (): void => {
    if (revealed || !widgetWindow) return;
    revealed = true;
    revealWidgetWindow();
  };

  widgetWindow.once("ready-to-show", revealOnce);
  widgetWindow.webContents.once("did-finish-load", revealOnce);

  await loadRenderer(widgetWindow, "widget");

  setTimeout(revealOnce, 1500);
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

  let hideOnBlurTimer: NodeJS.Timeout | undefined;

  addTodoWindow.on("blur", () => {
    clearTimeout(hideOnBlurTimer);
    // 短暂延迟：避免 show/focus 竞态或挂件 wake 抢焦点导致刚打开就被关掉
    hideOnBlurTimer = setTimeout(() => {
      if (!addTodoWindow || addTodoWindow.isDestroyed() || addTodoWindow.isFocused()) {
        return;
      }
      addTodoWindow.hide();
    }, 250);
  });

  addTodoWindow.on("focus", () => {
    clearTimeout(hideOnBlurTimer);
  });

  addTodoWindow.on("closed", () => {
    clearTimeout(hideOnBlurTimer);
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
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    thickFrame: false,
    title: "完成日历",
    show: false,
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

  let revealed = false;
  const revealOnce = (): void => {
    if (revealed || !calendarWindow) return;
    revealed = true;
    calendarWindow.show();
    calendarWindow.focus();
  };

  calendarWindow.once("ready-to-show", revealOnce);
  calendarWindow.webContents.once("did-finish-load", revealOnce);

  await loadRenderer(calendarWindow, "calendar");

  setTimeout(revealOnce, 1000);
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
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    thickFrame: false,
    title: "设置",
    show: false,
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

  let revealed = false;
  const revealOnce = (): void => {
    if (revealed || !settingsWindow) return;
    revealed = true;
    settingsWindow.show();
    settingsWindow.focus();
  };

  settingsWindow.once("ready-to-show", revealOnce);
  settingsWindow.webContents.once("did-finish-load", revealOnce);

  await loadRenderer(settingsWindow, "settings");

  setTimeout(revealOnce, 1000);
};

/** 设置写入 store 后广播，并返回最新 settings 供 IPC 响应 */
const applySettings = (settings: ReturnType<TodoStore["getSettings"]>): ReturnType<TodoStore["getSettings"]> => {
  broadcastSettings();
  return settings;
};

const setWidgetDisplayMode = async (displayMode: WidgetDisplayMode): Promise<ReturnType<TodoStore["getSettings"]>> => {
  const nextDisplayMode: WidgetDisplayMode = displayMode === "desktop" ? "desktop" : "normal";
  pinnedFloat = false;
  temporaryFloat = false;
  const settings = store.setDisplayMode(nextDisplayMode);
  broadcastFloatState();
  broadcastSettings();

  if (widgetWindow) {
    await applyWidgetDisplayMode();
  }

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
  ipcMain.handle("settings:get", () => {
    syncLoginSetting();
    return store.getSettings();
  });
  ipcMain.handle("settings:setLaunchAtLogin", (_event, enabled: boolean) => {
    applyLoginSetting(enabled);
    return applySettings(store.setLaunchAtLogin(enabled));
  });
  ipcMain.handle("settings:setDisplayMode", (_event, displayMode: WidgetDisplayMode) => setWidgetDisplayMode(displayMode));
  ipcMain.handle("settings:setShortcut", (_event, shortcut: string) => updateShortcut("quickAdd", shortcut));
  ipcMain.handle("settings:setShowWidgetShortcut", (_event, shortcut: string) => updateShortcut("showWidget", shortcut));
  ipcMain.handle("windows:openAddTodo", () => createAddTodoWindow());
  ipcMain.handle("windows:openCalendar", () => createCalendarWindow());
  ipcMain.handle("windows:openSettings", () => createSettingsWindow());
  ipcMain.handle("windows:closeCurrent", (event) => BrowserWindow.fromWebContents(event.sender)?.hide());
  ipcMain.handle("widget:wake", () => wakeWidgetForInteraction());
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
  ipcMain.handle("widget:prepareDrag", () => {
    if (!widgetWindow || isFloating() || !isDesktopDisplayMode()) {
      return;
    }

    clearTimeout(dragAttachFallbackTimer);
    detachWindowFromDesktop(widgetWindow);
    widgetDragDetached = true;
    dragAttachFallbackTimer = setTimeout(() => {
      if (!widgetWindow || !widgetDragDetached || isFloating() || !isDesktopDisplayMode()) {
        return;
      }

      widgetDragDetached = false;
      void attachDesktopWidget();
    }, 450);
  });
  ipcMain.handle("widget:minimize", () => {
    widgetWindow?.hide();
  });
  ipcMain.handle("app:quit", () => app.quit());
  ipcMain.handle("app:getVersion", () => getAppVersionInfo());
  ipcMain.handle("app:getUpdateStatus", () => getUpdateStatus());
  ipcMain.handle("app:checkForUpdates", () => checkForUpdates());
  ipcMain.handle("app:downloadUpdate", () => downloadUpdate());
  ipcMain.handle("app:dismissUpdate", () => dismissUpdate());
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
  pinnedFloat = false;
  syncLoginSetting();
  store.refreshDaily();
  registerIpc();
  await createWidgetWindow();
  registerGlobalShortcuts();
  createTray();
  setupAutoUpdater({
    onUpdateAvailable: () => {
      void createSettingsWindow();
    }
  });
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
  clearTimeout(desktopAttachTimer);
  clearTimeout(dragAttachFallbackTimer);
  clearTimeout(resizeReattachTimer);
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  // Keep the app alive so the global shortcut can reopen the quick-add window.
});
