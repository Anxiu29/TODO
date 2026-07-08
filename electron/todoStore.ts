/**
 * 主进程待办存储层。
 *
 * 这是整个应用中唯一读写 todos.json 的位置；渲染进程的所有变更
 * 都必须经 IPC → TodoStore 方法 → save() 落盘。
 *
 * 业务逻辑（排序、日切、日历聚合）复用 src/data/todoStore.ts 中的纯函数，
 * 便于单元测试与主/渲染进程共享。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { app } from "electron";
import { buildTodoSnapshot, getCalendarForMonth, refreshDatabaseForDate, todayKey, updateTodoTitle } from "../src/data/todoStore";
import type { TodoCalendarDay, TodoDatabase, TodoDraft, TodoSnapshot, TodoUpdate } from "../src/types/todo";

const nowIso = (): string => new Date().toISOString();

/** 创建空数据库，用于首次启动或 JSON 损坏/缺失时的回退 */
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
 * 主进程待办存储：唯一读写磁盘的位置，所有 UI 变更经 IPC 调用此类方法。
 *
 * 数据文件：{userData}/todos.json
 * - 开发模式 / 安装版：%APPDATA%/Desktop Todo Widget/
 * - 便携版：用户放置 .exe 的目录下 data/
 */
export class TodoStore {
  private database: TodoDatabase;

  constructor(private readonly filePath = join(app.getPath("userData"), "todos.json")) {
    this.database = this.load();
    // 构造时立即日切，确保跨天后首次打开数据已更新
    this.refreshDaily();
  }

  /** 返回当前日期的 UI 快照（进行中 + 今日完成），不触发日切 */
  getSnapshot(): TodoSnapshot {
    return buildTodoSnapshot(this.database);
  }

  /** 添加待办；标题 trim 后为空则忽略，默认 rating=1、scheduledDate=今天 */
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

  /** 标记完成，写入 completedAt 时间戳 */
  completeTodo(id: string): TodoSnapshot {
    const todo = this.database.todos.find((item) => item.id === id);
    if (todo && todo.status === "active") {
      todo.status = "completed";
      todo.completedAt = nowIso();
      this.save();
    }

    return this.getSnapshot();
  }

  /** 将已完成待办恢复为进行中，并重置 scheduledDate 为今天 */
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

  /** 紧急评分 clamp 到 1–5 整数 */
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

  /**
   * 日切：跨天时把所有进行中待办的 scheduledDate 滚到今天。
   * 若日期未变则 no-op；有变更则写盘。
   */
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

  /**
   * 从磁盘加载 JSON。
   * 合并策略：以 createEmptyDatabase 为底，覆盖文件字段，settings/todos 做浅合并；
   * rating 缺失或非法时默认为 1。
   */
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

  /** 确保目录存在后以格式化 JSON 写入（2 空格缩进） */
  private save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.database, null, 2), "utf8");
  }
}
