import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { dirname, join } from "node:path";

import { randomUUID } from "node:crypto";

import { app } from "electron";

import { buildTodoSnapshot, getCalendarForMonth, refreshDatabaseForDate, todayKey, updateTodoTitle } from "../src/data/todoStore";

import type { TodoCalendarDay, TodoDatabase, TodoDraft, TodoSnapshot, TodoUpdate } from "../src/types/todo";



const nowIso = (): string => new Date().toISOString();



/** 创建空数据库，用于首次启动或文件损坏时的回退。 */

export const createEmptyDatabase = (date = todayKey()): TodoDatabase => ({

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



/**

 * 主进程待办存储：唯一读写磁盘的位置。

 * 数据保存在 userData/todos.json，所有 UI 变更经 IPC 调用此类方法。
 * 安装版：%APPDATA%/Desktop Todo Widget/；便携版：exe 同目录 data/。

 */

export class TodoStore {

  private database: TodoDatabase;



  constructor(private readonly filePath = join(app.getPath("userData"), "todos.json")) {

    this.database = this.load();

    this.refreshDaily();

  }



  getSnapshot(): TodoSnapshot {

    return buildTodoSnapshot(this.database);

  }



  addTodo(draft: TodoDraft): TodoSnapshot {

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



  completeTodo(id: string): TodoSnapshot {

    const todo = this.database.todos.find((item) => item.id === id);

    if (todo && todo.status === "active") {

      todo.status = "completed";

      todo.completedAt = nowIso();

      this.save();

    }



    return this.getSnapshot();

  }



  reopenTodo(id: string): TodoSnapshot {

    const todo = this.database.todos.find((item) => item.id === id);

    if (todo && todo.status === "completed") {

      todo.status = "active";

      todo.completedAt = undefined;

      todo.scheduledDate = todayKey();

      this.save();

    }



    return this.getSnapshot();

  }



  deleteTodo(id: string): TodoSnapshot {

    this.database.todos = this.database.todos.filter((todo) => todo.id !== id);

    this.save();

    return this.getSnapshot();

  }



  updateTodo(id: string, update: TodoUpdate): TodoSnapshot {

    const next = updateTodoTitle(this.database, id, update.title);

    if (next !== this.database) {

      this.database = next;

      this.save();

    }



    return this.getSnapshot();

  }



  setTodoRating(id: string, rating: number): TodoSnapshot {

    const todo = this.database.todos.find((item) => item.id === id);

    if (todo) {

      todo.rating = Math.min(5, Math.max(1, Math.round(rating)));

      this.save();

    }



    return this.getSnapshot();

  }



  getCalendar(year: number, month: number): TodoCalendarDay[] {

    return getCalendarForMonth(this.database, year, month);

  }



  /** 跨天时把未完成待办滚到当天，并更新 lastRefreshDate。 */

  refreshDaily(date = todayKey()): TodoSnapshot {

    const refreshed = refreshDatabaseForDate(this.database, date);

    if (refreshed !== this.database) {

      this.database = refreshed;

      this.save();

    }



    return this.getSnapshot();

  }



  updateWidgetBounds(bounds: TodoDatabase["settings"]["widgetBounds"]): void {

    this.database.settings.widgetBounds = bounds;

    this.save();

  }



  getSettings(): TodoDatabase["settings"] {

    return this.database.settings;

  }



  setShortcut(shortcut: string): TodoDatabase["settings"] {

    this.database.settings.shortcut = shortcut;

    this.save();

    return this.database.settings;

  }



  setShowWidgetShortcut(shortcut: string): TodoDatabase["settings"] {

    this.database.settings.showWidgetShortcut = shortcut;

    this.save();

    return this.database.settings;

  }



  setDisplayMode(displayMode: TodoDatabase["settings"]["displayMode"]): TodoDatabase["settings"] {

    this.database.settings.displayMode = displayMode;

    this.save();

    return this.database.settings;

  }



  setLaunchAtLogin(launchAtLogin: boolean): TodoDatabase["settings"] {

    this.database.settings.launchAtLogin = launchAtLogin;

    this.save();

    return this.database.settings;

  }



  /** 从磁盘加载 JSON；文件不存在或解析失败时返回空库。 */

  private load(): TodoDatabase {

    try {

      const raw = readFileSync(this.filePath, "utf8");

      const parsed = JSON.parse(raw) as TodoDatabase;

      return {

        ...createEmptyDatabase(),

        ...parsed,

        settings: {

          ...createEmptyDatabase().settings,

          ...parsed.settings

        },

        todos: Array.isArray(parsed.todos)

          ? parsed.todos.map((todo) => ({

              ...todo,

              rating: typeof todo.rating === "number" ? Math.min(5, Math.max(1, Math.round(todo.rating))) : 1

            }))

          : []

      };

    } catch {

      return createEmptyDatabase();

    }

  }



  private save(): void {

    mkdirSync(dirname(this.filePath), { recursive: true });

    writeFileSync(this.filePath, JSON.stringify(this.database, null, 2), "utf8");

  }

}

