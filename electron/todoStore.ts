import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { app } from "electron";
import { buildTodoSnapshot, getCalendarForMonth, refreshDatabaseForDate, todayKey } from "../src/data/todoStore";
import type { TodoCalendarDay, TodoDatabase, TodoDraft, TodoSnapshot } from "../src/types/todo";

const nowIso = (): string => new Date().toISOString();

export const createEmptyDatabase = (date = todayKey()): TodoDatabase => ({
  version: 1,
  lastRefreshDate: date,
  todos: [],
  settings: {
    desktopAttachEnabled: true,
    shortcut: "CommandOrControl+Alt+T"
  }
});

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
      status: "active"
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

  getCalendar(year: number, month: number): TodoCalendarDay[] {
    return getCalendarForMonth(this.database, year, month);
  }

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

  setDesktopAttachEnabled(enabled: boolean): TodoDatabase["settings"] {
    this.database.settings.desktopAttachEnabled = enabled;
    this.save();
    return this.database.settings;
  }

  setShortcut(shortcut: string): TodoDatabase["settings"] {
    this.database.settings.shortcut = shortcut;
    this.save();
    return this.database.settings;
  }

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
        todos: Array.isArray(parsed.todos) ? parsed.todos : []
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

export const todoDate = {
  todayKey
};
