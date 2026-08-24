/**
 * settings:* IPC。
 *
 * 与待办 IPC 拆开；非法入参返回当前设置且不写盘。
 * 显示模式必须是三个枚举之一，避免脏值被当成 normal 把桌面固定打掉。
 */
import { ipcMain } from "electron";
import type {
  AppSettings,
  ShortcutRegistrationResult,
  WidgetDisplayMode,
  WidgetTheme
} from "../src/types/todo";

const asDisplayMode = (value: unknown): WidgetDisplayMode | null =>
  value === "normal" || value === "desktop" || value === "system" ? value : null;

/** 由 main 注入：读设置、写登录项、改主题等仍关闭在主进程闭包里 */
export type SettingsIpcHandlers = {
  getSettings: () => AppSettings;
  syncLoginSetting: () => void;
  applyLoginSetting: (enabled: boolean) => void;
  applySettings: (settings: AppSettings) => AppSettings;
  setLaunchAtLogin: (enabled: boolean) => AppSettings;
  setDisplayMode: (mode: WidgetDisplayMode) => Promise<AppSettings> | AppSettings;
  setTheme: (theme: WidgetTheme) => AppSettings;
  setWidgetOpacity: (opacity: number) => AppSettings;
  setTagFilter: (tagFilter: string | null) => AppSettings;
  setShortcut: (shortcut: string) => ShortcutRegistrationResult;
  setShowWidgetShortcut: (shortcut: string) => ShortcutRegistrationResult;
};

/** 注册 settings:* 通道 */
export const registerSettingsIpc = (handlers: SettingsIpcHandlers): void => {
  const current = (): AppSettings => handlers.getSettings();

  ipcMain.handle("settings:get", () => {
    handlers.syncLoginSetting();
    return current();
  });

  ipcMain.handle("settings:setLaunchAtLogin", (_event, enabled: unknown) => {
    if (typeof enabled !== "boolean") return current();
    handlers.applyLoginSetting(enabled);
    return handlers.applySettings(handlers.setLaunchAtLogin(enabled));
  });

  ipcMain.handle("settings:setDisplayMode", (_event, displayMode: unknown) => {
    const mode = asDisplayMode(displayMode);
    if (!mode) return current();
    return handlers.setDisplayMode(mode);
  });

  ipcMain.handle("settings:setTheme", (_event, theme: unknown) => {
    // 非法主题由 store 回退深色，不必在此拒绝
    return handlers.applySettings(handlers.setTheme(theme as WidgetTheme));
  });

  ipcMain.handle("settings:setWidgetOpacity", (_event, opacity: unknown) => {
    if (typeof opacity !== "number" || !Number.isFinite(opacity)) return current();
    return handlers.applySettings(handlers.setWidgetOpacity(opacity));
  });

  ipcMain.handle("settings:setTagFilter", (_event, tagFilter: unknown) => {
    if (tagFilter !== null && typeof tagFilter !== "string") return current();
    return handlers.applySettings(handlers.setTagFilter(tagFilter));
  });

  ipcMain.handle("settings:setShortcut", (_event, shortcut: unknown) => {
    if (typeof shortcut !== "string" || !shortcut.trim()) {
      return {
        settings: current(),
        registered: false,
        requestedShortcut: "",
        activeShortcut: current().shortcut
      };
    }
    return handlers.setShortcut(shortcut);
  });

  ipcMain.handle("settings:setShowWidgetShortcut", (_event, shortcut: unknown) => {
    if (typeof shortcut !== "string" || !shortcut.trim()) {
      return {
        settings: current(),
        registered: false,
        requestedShortcut: "",
        activeShortcut: current().showWidgetShortcut
      };
    }
    return handlers.setShowWidgetShortcut(shortcut);
  });
};
