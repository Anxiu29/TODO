import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { app } from "electron";
import { dirname, join } from "node:path";
import type { TodoDatabase } from "../src/types/todo";

/**
 * 配置 userData / todos.json 所在目录。
 *
 * - 便携版：exe 同目录 data/（绿色、可携带）
 * - 安装版：Electron 默认 AppData（%APPDATA%/Desktop Todo Widget/）
 *   安装版不能把数据放在安装目录：NSIS 升级会先卸载旧版并清空安装目录，
 *   导致 {安装目录}/data/todos.json 被删掉（0.1.5 的已知问题）。
 *
 * 开发模式（npm run dev）保持默认 AppData，避免污染正式数据。
 *
 * 须在 app.ready 之前、TodoStore 等任何 getPath("userData") 调用之前执行。
 */
export const configureUserDataPath = (): void => {
  if (!app.isPackaged) {
    return;
  }

  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portableDir) {
    const appData = app.getPath("userData");
    const portableUserData = join(portableDir, "data");
    migrateLegacyTodos(appData, portableUserData);
    app.setPath("userData", portableUserData);
    return;
  }

  // 安装版：保留 AppData；若 0.1.5 曾在安装目录写过 data/，迁移过来
  const appData = app.getPath("userData");
  const installDirData = join(dirname(app.getPath("exe")), "data");
  migrateLegacyTodos(installDirData, appData);
};

const readTodosCount = (filePath: string): number => {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as TodoDatabase;
    return Array.isArray(parsed.todos) ? parsed.todos.length : 0;
  } catch {
    return 0;
  }
};

/** 从旧路径迁移 todos.json（仅在新路径缺失或为空时复制，不覆盖已有数据）。 */
export const migrateLegacyTodos = (legacyUserData: string, newUserData: string): void => {
  const legacyTodosPath = join(legacyUserData, "todos.json");
  const newTodosPath = join(newUserData, "todos.json");

  if (!existsSync(legacyTodosPath)) {
    return;
  }

  const legacyCount = readTodosCount(legacyTodosPath);
  if (legacyCount === 0) {
    return;
  }

  const newCount = existsSync(newTodosPath) ? readTodosCount(newTodosPath) : 0;
  if (newCount > 0) {
    return;
  }

  mkdirSync(newUserData, { recursive: true });
  copyFileSync(legacyTodosPath, newTodosPath);
};

/** 应用图标路径：开发读 build/icon.png，打包后读 extraResources 中的 icon.png */
export const getAppIconPath = (): string =>
  app.isPackaged ? join(process.resourcesPath, "icon.png") : join(app.getAppPath(), "build/icon.png");
