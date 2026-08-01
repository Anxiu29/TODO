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
import {
  normalizeDueDays,
  normalizeTodoRating,
  normalizeTodoSubtasks,
  normalizeTodoTags,
  normalizeTodoWaitingFields,
  normalizeWaitingReason,
  normalizeWidgetOpacity,
  normalizeWidgetTheme,
  WIDGET_OPACITY_DEFAULT,
  WIDGET_THEME_DEFAULT
} from "../src/types/todo";
import type {
  AppSettings,
  Todo,
  TodoCalendarDay,
  TodoDatabase,
  TodoDraft,
  TodoSnapshot,
  TodoSubtask,
  TodoUpdate,
  WidgetDisplayMode,
  WidgetTheme
} from "../src/types/todo";

const nowIso = (): string => new Date().toISOString();

/** 创建空数据库，用于首次启动或 JSON 损坏/缺失时的回退 */
export const createEmptyDatabase = (date = todayKey()): TodoDatabase => ({
  version: 1,
  lastRefreshDate: date,
  todos: [],
  settings: {
    displayMode: "normal",
    launchAtLogin: false,
    shortcut: "CommandOrControl+2",
    showWidgetShortcut: "CommandOrControl+1",
    theme: WIDGET_THEME_DEFAULT,
    widgetOpacity: WIDGET_OPACITY_DEFAULT
  }
});

const normalizeDisplayMode = (displayMode: unknown): WidgetDisplayMode =>
  displayMode === "desktop" ? "desktop" : "normal";

const normalizeTodoRecord = (todo: TodoDatabase["todos"][number]): TodoDatabase["todos"][number] => {
  // 丢弃旧版 dueAt（具体时刻），只保留/规范化 dueDays；等待字段与 status 一并规范化
  const rest = { ...todo } as TodoDatabase["todos"][number] & { dueAt?: unknown };
  delete rest.dueAt;
  const waiting = normalizeTodoWaitingFields(
    rest.status,
    rest.waitingSince,
    rest.waitingReason,
    todayKey()
  );
  const dueDays = normalizeDueDays(rest.dueDays);
  // 非 waiting 时显式去掉字段，避免脏数据残留
  const { waitingSince: _ws, waitingReason: _wr, ...base } = rest;
  return {
    ...base,
    ...waiting,
    rating: normalizeTodoRating(rest.rating),
    tags: normalizeTodoTags(rest.tags),
    subtasks: normalizeTodoSubtasks(rest.subtasks),
    ...(dueDays !== undefined ? { dueDays } : {})
  };
};

/** 清除等待相关字段（恢复进行中或完成时调用） */
const clearWaitingFields = (todo: Todo): void => {
  delete todo.waitingSince;
  delete todo.waitingReason;
};

/**
 * 主进程待办存储：唯一读写磁盘的位置，所有 UI 变更经 IPC 调用此类方法。
 *
 * 数据文件：{userData}/todos.json
 * - 开发模式 / 安装版：%APPDATA%/Desktop Todo Widget/
 * - 便携版：用户放置 .exe 的目录下 data/
 */
export class TodoStore {
  private database: TodoDatabase;
  /** 最近一次硬删除的完整待办，仅内存，供撤回；不落盘 */
  private lastDeletedTodo: Todo | null = null;

  constructor(private readonly filePath = join(app.getPath("userData"), "todos.json")) {
    this.database = this.load();
    // 构造时立即日切，确保跨天后首次打开数据已更新
    this.refreshDaily();
  }

  /** 返回当前日期的 UI 快照（进行中 + 今日完成），不触发日切 */
  getSnapshot(): TodoSnapshot {
    return buildTodoSnapshot(this.database);
  }

  /** 添加待办；标题 trim 后为空则忽略；rating 默认五星，scheduledDate=今天；tags/dueDays 经 normalize */
  addTodo(draft: TodoDraft): TodoSnapshot {
    const title = draft.title.trim();
    if (!title) {
      return this.getSnapshot();
    }

    const timestamp = nowIso();
    const dueDays = normalizeDueDays(draft.dueDays);
    this.database.todos.push({
      id: randomUUID(),
      title,
      createdAt: timestamp,
      scheduledDate: todayKey(),
      status: "active",
      rating: normalizeTodoRating(draft.rating),
      tags: normalizeTodoTags(draft.tags),
      subtasks: [],
      // 未设置预计天数时不写字段，保持与右键清除后的存储形态一致
      ...(dueDays !== undefined ? { dueDays } : {})
    });
    this.save();
    return this.getSnapshot();
  }

  /** 标记完成，写入 completedAt；进行中或等待中均可完成，并清除等待字段 */
  completeTodo(id: string): TodoSnapshot {
    const todo = this.database.todos.find((item) => item.id === id);
    if (todo && (todo.status === "active" || todo.status === "waiting")) {
      todo.status = "completed";
      todo.completedAt = nowIso();
      clearWaitingFields(todo);
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
      clearWaitingFields(todo);
      this.save();
    }

    return this.getSnapshot();
  }

  /**
   * 标记为等待中；可选原因。
   * 首次进入写入 waitingSince=今天；已在等待则只更新原因，不重置天数。
   */
  setTodoWaiting(id: string, options?: { reason?: string | null }): TodoSnapshot {
    const todo = this.database.todos.find((item) => item.id === id);
    if (!todo || (todo.status !== "active" && todo.status !== "waiting")) {
      return this.getSnapshot();
    }

    const reason =
      options && "reason" in options
        ? normalizeWaitingReason(options.reason)
        : todo.waitingReason;

    if (todo.status !== "waiting") {
      todo.status = "waiting";
      todo.waitingSince = todayKey();
    }

    if (reason) {
      todo.waitingReason = reason;
    } else {
      delete todo.waitingReason;
    }

    this.save();
    return this.getSnapshot();
  }

  /** 等待中恢复为进行中，清除等待字段 */
  resumeTodo(id: string): TodoSnapshot {
    const todo = this.database.todos.find((item) => item.id === id);
    if (todo && todo.status === "waiting") {
      todo.status = "active";
      clearWaitingFields(todo);
      this.save();
    }
    return this.getSnapshot();
  }

  /** 硬删除待办，并缓存副本供 undoLastDelete */
  deleteTodo(id: string): TodoSnapshot {
    const removed = this.database.todos.find((todo) => todo.id === id);
    if (!removed) return this.getSnapshot();

    this.lastDeletedTodo = structuredClone(removed);
    this.database.todos = this.database.todos.filter((todo) => todo.id !== id);
    this.save();
    return this.getSnapshot();
  }

  /** 撤回最近一次删除；无缓存或 id 已存在时原样返回 */
  undoLastDelete(): TodoSnapshot {
    const restored = this.lastDeletedTodo;
    if (!restored) return this.getSnapshot();

    this.lastDeletedTodo = null;
    if (this.database.todos.some((todo) => todo.id === restored.id)) {
      return this.getSnapshot();
    }

    this.database.todos.push(restored);
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
      todo.rating = normalizeTodoRating(rating);
      this.save();
    }

    return this.getSnapshot();
  }

  /** 覆盖写入标签列表（会再走 normalize：去重、截断） */
  setTodoTags(id: string, tags: string[]): TodoSnapshot {
    const todo = this.database.todos.find((item) => item.id === id);
    if (todo) {
      todo.tags = normalizeTodoTags(tags);
      this.save();
    }
    return this.getSnapshot();
  }

  /** 设置或清空预计完成天数；传 null 表示清除 */
  setTodoDueDays(id: string, dueDays: number | null): TodoSnapshot {
    const todo = this.database.todos.find((item) => item.id === id);
    if (todo) {
      const normalized = normalizeDueDays(dueDays);
      if (normalized === undefined) {
        delete todo.dueDays;
      } else {
        todo.dueDays = normalized;
      }
      this.save();
    }
    return this.getSnapshot();
  }

  /** 追加一条子任务；空标题或已满 20 条则忽略 */
  addTodoSubtask(id: string, title: string): TodoSnapshot {
    const todo = this.database.todos.find((item) => item.id === id);
    const trimmed = title.trim();
    if (!todo || !trimmed || todo.subtasks.length >= 20) {
      return this.getSnapshot();
    }

    todo.subtasks = normalizeTodoSubtasks([
      ...todo.subtasks,
      { id: randomUUID(), title: trimmed, done: false } satisfies TodoSubtask
    ]);
    this.save();
    return this.getSnapshot();
  }

  /** 切换子任务完成状态 */
  toggleTodoSubtask(id: string, subtaskId: string): TodoSnapshot {
    const todo = this.database.todos.find((item) => item.id === id);
    const subtask = todo?.subtasks.find((item) => item.id === subtaskId);
    if (subtask) {
      subtask.done = !subtask.done;
      this.save();
    }
    return this.getSnapshot();
  }

  /** 重命名子任务；空标题忽略 */
  updateTodoSubtask(id: string, subtaskId: string, title: string): TodoSnapshot {
    const todo = this.database.todos.find((item) => item.id === id);
    const subtask = todo?.subtasks.find((item) => item.id === subtaskId);
    const trimmed = title.trim();
    if (subtask && trimmed) {
      subtask.title = trimmed.slice(0, 80);
      this.save();
    }
    return this.getSnapshot();
  }

  /** 删除指定子任务 */
  deleteTodoSubtask(id: string, subtaskId: string): TodoSnapshot {
    const todo = this.database.todos.find((item) => item.id === id);
    if (todo) {
      todo.subtasks = todo.subtasks.filter((item) => item.id !== subtaskId);
      this.save();
    }
    return this.getSnapshot();
  }

  getCalendar(year: number, month: number): TodoCalendarDay[] {
    return getCalendarForMonth(this.database, year, month);
  }

  /**
   * 日切：跨天时把所有进行中/等待中待办的 scheduledDate 滚到今天。
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

  getSettings(): AppSettings {
    return this.database.settings;
  }

  setShortcut(shortcut: string): AppSettings {
    this.database.settings.shortcut = shortcut;
    this.save();
    return this.database.settings;
  }

  setShowWidgetShortcut(shortcut: string): AppSettings {
    this.database.settings.showWidgetShortcut = shortcut;
    this.save();
    return this.database.settings;
  }

  setDisplayMode(displayMode: AppSettings["displayMode"]): AppSettings {
    this.database.settings.displayMode = displayMode;
    this.save();
    return this.database.settings;
  }

  setLaunchAtLogin(launchAtLogin: boolean): AppSettings {
    this.database.settings.launchAtLogin = launchAtLogin;
    this.save();
    return this.database.settings;
  }

  /** 界面主题：light | dark */
  setTheme(theme: WidgetTheme): AppSettings {
    this.database.settings.theme = normalizeWidgetTheme(theme);
    this.save();
    return this.database.settings;
  }

  /** 挂件卡片不透明度，clamp 到 0.5–1 */
  setWidgetOpacity(opacity: number): AppSettings {
    this.database.settings.widgetOpacity = normalizeWidgetOpacity(opacity);
    this.save();
    return this.database.settings;
  }

  /**
   * 从磁盘加载 JSON。
   * 合并策略：以 createEmptyDatabase 为底，覆盖文件字段，settings/todos 做浅合并；
   * 缺失的 tags/subtasks/theme/opacity 会补默认值。
   */
  private load(): TodoDatabase {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as TodoDatabase;
      const defaults = createEmptyDatabase();
      return {
        ...defaults,
        ...parsed,
        settings: {
          ...defaults.settings,
          ...parsed.settings,
          displayMode: normalizeDisplayMode(parsed.settings?.displayMode),
          theme: normalizeWidgetTheme(parsed.settings?.theme),
          widgetOpacity: normalizeWidgetOpacity(parsed.settings?.widgetOpacity)
        },
        todos: Array.isArray(parsed.todos) ? parsed.todos.map((todo) => normalizeTodoRecord(todo)) : []
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
