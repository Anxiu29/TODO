import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { app } from "electron";
import { dirname, join } from "node:path";
import type { TodoDatabase } from "../src/types/todo";

/**
 * 自定义 userData 目录，使待办数据与 exe 放在一起（绿色、可携带）。
 *
 * 改动历程：
 * 1. 初版：安装版/便携版均使用 Electron 默认路径（%APPDATA%/Desktop Todo Widget/）。
 * 2. 第一次改：仅便携版改到 exe 旁 data/，通过 electron-builder 注入的
 *    PORTABLE_EXECUTABLE_DIR 定位用户放置 .exe 的目录（不能用 app.getPath("exe")，
 *    便携版实际进程从临时目录解压运行）。
 * 3. 第二次改：安装版也改到 exe 旁 data/，打包后统一用「应用目录/data/」；
 *    安装版用 dirname(app.getPath("exe")) 即可（NSIS 安装到固定目录）。
 *
 * 开发模式（npm run dev，app.isPackaged === false）保持默认 AppData，避免污染正式数据。
 *
 * 须在 app.ready 之前、TodoStore 等任何 getPath("userData") 调用之前执行。
 */
export const configureUserDataPath = (): void => {
  if (!app.isPackaged) {
    return;
  }

  const legacyUserData = app.getPath("userData");

  // 便携版：用户放 .exe 的文件夹；安装版：NSIS 安装目录
  const appDir = process.env.PORTABLE_EXECUTABLE_DIR ?? dirname(app.getPath("exe"));
  const newUserData = join(appDir, "data");

  migrateLegacyTodos(legacyUserData, newUserData);
  app.setPath("userData", newUserData);
};

const readTodosCount = (filePath: string): number => {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as TodoDatabase;
    return Array.isArray(parsed.todos) ? parsed.todos.length : 0;
  } catch {
    return 0;
  }
};

/**
 * 从旧版默认 AppData 目录迁移 todos.json。
 * 安装版在 0.1.5 起改到 exe 旁 data/，不迁移会导致更新后看起来像「数据丢失」。
 */
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
