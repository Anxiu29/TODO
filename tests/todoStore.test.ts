import { describe, expect, it } from "vitest";
import { buildTodoSnapshot, getCalendarForMonth, refreshDatabaseForDate, updateTodoTitle } from "../src/data/todoStore";
import {
  normalizeDueDays,
  normalizeTodoSubtasks,
  normalizeTodoTags,
  normalizeWidgetOpacity,
  normalizeWidgetTheme,
  type TodoDatabase
} from "../src/types/todo";

const database: TodoDatabase = {
  version: 1,
  lastRefreshDate: "2026-07-01",
  settings: {
    displayMode: "desktop",
    launchAtLogin: false,
    shortcut: "CommandOrControl+2",
    showWidgetShortcut: "CommandOrControl+1",
    theme: "light",
    widgetOpacity: 0.92
  },
  todos: [
    {
      id: "active-1",
      title: "未完成事项",
      createdAt: "2026-07-01T08:00:00.000Z",
      scheduledDate: "2026-07-01",
      status: "active",
      rating: 2,
      tags: ["工作"],
      subtasks: [{ id: "s1", title: "子项", done: false }]
    },
    {
      id: "completed-1",
      title: "已完成事项",
      createdAt: "2026-07-01T09:00:00.000Z",
      scheduledDate: "2026-07-01",
      completedAt: "2026-07-01T10:00:00.000Z",
      status: "completed",
      rating: 1,
      tags: [],
      subtasks: []
    }
  ]
};

describe("todo daily refresh", () => {
  it("rolls active todos to the new day while keeping completed todos on their completion day", () => {
    const refreshed = refreshDatabaseForDate(database, "2026-07-02");

    expect(refreshed.lastRefreshDate).toBe("2026-07-02");
    expect(refreshed.todos.find((todo) => todo.id === "active-1")?.scheduledDate).toBe("2026-07-02");
    expect(refreshed.todos.find((todo) => todo.id === "completed-1")?.completedAt).toBe("2026-07-01T10:00:00.000Z");
  });

  it("builds today's active snapshot without moving completed history", () => {
    const refreshed = refreshDatabaseForDate(database, "2026-07-02");
    const snapshot = buildTodoSnapshot(refreshed, "2026-07-02");

    expect(snapshot.activeTodos).toHaveLength(1);
    expect(snapshot.completedToday).toHaveLength(0);
  });

  it("groups completed todos by calendar day", () => {
    const calendar = getCalendarForMonth(database, 2026, 7);

    expect(calendar).toHaveLength(1);
    expect(calendar[0]).toMatchObject({
      date: "2026-07-01",
      completedCount: 1
    });
  });

  it("sorts active todos by rating descending", () => {
    const ratedDatabase: TodoDatabase = {
      ...database,
      todos: [
        {
          id: "low",
          title: "低优先级",
          createdAt: "2026-07-01T08:00:00.000Z",
          scheduledDate: "2026-07-01",
          status: "active",
          rating: 1,
          tags: [],
          subtasks: []
        },
        {
          id: "high",
          title: "高优先级",
          createdAt: "2026-07-01T09:00:00.000Z",
          scheduledDate: "2026-07-01",
          status: "active",
          rating: 5,
          tags: [],
          subtasks: []
        }
      ]
    };

    const snapshot = buildTodoSnapshot(ratedDatabase, "2026-07-01");

    expect(snapshot.activeTodos.map((todo) => todo.id)).toEqual(["high", "low"]);
  });

  it("updates a todo title and ignores empty titles", () => {
    const updated = updateTodoTitle(database, "active-1", "  更新后的标题  ");

    expect(updated.todos.find((todo) => todo.id === "active-1")?.title).toBe("更新后的标题");
    expect(updateTodoTitle(database, "active-1", "   ")).toBe(database);
    expect(updateTodoTitle(database, "missing", "新标题")).toBe(database);
  });
});

describe("todo tags and appearance normalize", () => {
  it("normalizes tags: presets only, one category, urgent can stack", () => {
    expect(normalizeTodoTags([" 工作 ", "工作", "", "自定义", "学习", 1])).toEqual(["工作"]);
    expect(normalizeTodoTags(["生活", "紧急", "工作"])).toEqual(["生活", "紧急"]);
    expect(normalizeTodoTags(["紧急"])).toEqual(["紧急"]);
  });

  it("normalizes subtasks and drops invalid entries", () => {
    expect(
      normalizeTodoSubtasks([
        { id: "a", title: " 完成文档 ", done: true },
        { id: "", title: "无效" },
        { id: "b", title: "" },
        null
      ])
    ).toEqual([{ id: "a", title: "完成文档", done: true }]);
  });

  it("normalizes theme and opacity", () => {
    expect(normalizeWidgetTheme("dark")).toBe("dark");
    expect(normalizeWidgetTheme("neon")).toBe("light");
    expect(normalizeWidgetOpacity(0.3)).toBe(0.5);
    expect(normalizeWidgetOpacity(1.2)).toBe(1);
    expect(normalizeWidgetOpacity(0.876)).toBe(0.88);
  });

  it("normalizes dueDays and drops invalid values", () => {
    expect(normalizeDueDays(3)).toBe(3);
    expect(normalizeDueDays(0)).toBeUndefined();
    expect(normalizeDueDays("")).toBeUndefined();
    expect(normalizeDueDays(999)).toBe(365);
  });
});
