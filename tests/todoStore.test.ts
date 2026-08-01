import { describe, expect, it } from "vitest";
import {
  buildTodoSnapshot,
  daysBetweenDateKeys,
  formatStepDaysLabel,
  getCalendarForMonth,
  refreshDatabaseForDate,
  updateTodoTitle
} from "../src/data/todoStore";
import {
  normalizeDueDays,
  normalizeTagFilter,
  normalizeTodoSubtasks,
  normalizeTodoTags,
  normalizeTodoWaitingFields,
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
    widgetOpacity: 0.92,
    tagFilter: null
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
      subtasks: [{ id: "s1", title: "子项", done: false, createdAt: "2026-07-01" }]
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
  it("normalizes tags: one category, urgent can stack, custom kept", () => {
    expect(normalizeTodoTags([" 工作 ", "工作", "", "自定义", "学习", 1])).toEqual(["工作", "自定义"]);
    expect(normalizeTodoTags(["生活", "紧急", "工作"])).toEqual(["生活", "紧急"]);
    expect(normalizeTodoTags(["紧急"])).toEqual(["紧急"]);
    expect(normalizeTodoTags(["项目A", " 项目A ", "紧急"])).toEqual(["项目A", "紧急"]);
  });

  it("normalizes subtasks and drops invalid entries", () => {
    expect(
      normalizeTodoSubtasks(
        [
          { id: "a", title: " 完成文档 ", done: true },
          { id: "", title: "无效" },
          { id: "b", title: "" },
          null
        ],
        "2026-07-01"
      )
    ).toEqual([
      { id: "a", title: "完成文档", done: true, createdAt: "2026-07-01", completedAt: "2026-07-01" }
    ]);
  });

  it("fills missing step dates from fallback and strips completedAt when open", () => {
    expect(
      normalizeTodoSubtasks(
        [
          { id: "open", title: "进行中", done: false, completedAt: "2026-07-02" },
          { id: "done", title: "已完成", done: true, createdAt: "2026-06-28" }
        ],
        "2026-07-01"
      )
    ).toEqual([
      { id: "open", title: "进行中", done: false, createdAt: "2026-07-01" },
      {
        id: "done",
        title: "已完成",
        done: true,
        createdAt: "2026-06-28",
        completedAt: "2026-06-28"
      }
    ]);
  });

  it("normalizes theme and opacity", () => {
    expect(normalizeWidgetTheme("dark")).toBe("dark");
    expect(normalizeWidgetTheme("light")).toBe("light");
    expect(normalizeWidgetTheme("neon")).toBe("dark");
    expect(normalizeWidgetTheme(undefined)).toBe("dark");
    expect(normalizeWidgetOpacity(0.3)).toBe(0.5);
    expect(normalizeWidgetOpacity(1.2)).toBe(1);
    expect(normalizeWidgetOpacity(0.876)).toBe(0.88);
    expect(normalizeWidgetOpacity(undefined)).toBe(0.75);
  });

  it("normalizes dueDays and drops invalid values", () => {
    expect(normalizeDueDays(3)).toBe(3);
    expect(normalizeDueDays(0)).toBeUndefined();
    expect(normalizeDueDays("")).toBeUndefined();
    expect(normalizeDueDays(999)).toBe(365);
  });

  it("normalizes tagFilter: empty/invalid become null", () => {
    expect(normalizeTagFilter(null)).toBeNull();
    expect(normalizeTagFilter("")).toBeNull();
    expect(normalizeTagFilter(" 工作 ")).toBe("工作");
    expect(normalizeTagFilter(1)).toBeNull();
  });

  it("normalizes waiting fields and clears them for non-waiting status", () => {
    expect(normalizeTodoWaitingFields("waiting", "2026-07-01", " 等设计 ", "2026-08-01")).toEqual({
      status: "waiting",
      waitingSince: "2026-07-01",
      waitingReason: "等设计"
    });
    expect(normalizeTodoWaitingFields("waiting", "bad", "", "2026-08-01")).toEqual({
      status: "waiting",
      waitingSince: "2026-08-01"
    });
    expect(normalizeTodoWaitingFields("active", "2026-07-01", "残留", "2026-08-01")).toEqual({
      status: "active"
    });
    expect(normalizeTodoWaitingFields("bogus", "2026-07-01", "x", "2026-08-01")).toEqual({
      status: "active"
    });
  });
});

describe("todo waiting status", () => {
  const waitingDatabase: TodoDatabase = {
    ...database,
    todos: [
      {
        id: "waiting-1",
        title: "等待中的事项",
        createdAt: "2026-07-01T08:00:00.000Z",
        scheduledDate: "2026-07-01",
        status: "waiting",
        waitingSince: "2026-06-28",
        waitingReason: "等接口",
        rating: 3,
        tags: [],
        subtasks: []
      },
      {
        id: "active-2",
        title: "进行中的事项",
        createdAt: "2026-07-01T09:00:00.000Z",
        scheduledDate: "2026-07-01",
        status: "active",
        rating: 2,
        tags: [],
        subtasks: []
      }
    ]
  };

  it("rolls waiting todos to the new day without resetting waitingSince", () => {
    const refreshed = refreshDatabaseForDate(waitingDatabase, "2026-07-03");
    const waiting = refreshed.todos.find((todo) => todo.id === "waiting-1");

    expect(waiting?.scheduledDate).toBe("2026-07-03");
    expect(waiting?.waitingSince).toBe("2026-06-28");
    expect(waiting?.status).toBe("waiting");
  });

  it("includes waiting todos in today's activeTodos after active items", () => {
    const snapshot = buildTodoSnapshot(waitingDatabase, "2026-07-01");

    expect(snapshot.activeTodos.map((todo) => todo.id)).toEqual(["active-2", "waiting-1"]);
  });

  it("computes waiting days between date keys", () => {
    expect(daysBetweenDateKeys("2026-07-01", "2026-07-01")).toBe(0);
    expect(daysBetweenDateKeys("2026-07-01", "2026-07-02")).toBe(1);
    expect(daysBetweenDateKeys("2026-06-28", "2026-07-01")).toBe(3);
    expect(daysBetweenDateKeys("bad", "2026-07-01")).toBe(0);
  });
});

describe("todo step duration labels", () => {
  it("formats open and completed step day labels", () => {
    expect(
      formatStepDaysLabel({ id: "1", title: "a", done: false, createdAt: "2026-07-01" }, "2026-07-01")
    ).toBe("今天添加");
    expect(
      formatStepDaysLabel({ id: "1", title: "a", done: false, createdAt: "2026-06-28" }, "2026-07-01")
    ).toBe("已进行 3 天");
    expect(
      formatStepDaysLabel(
        { id: "1", title: "a", done: true, createdAt: "2026-07-01", completedAt: "2026-07-01" },
        "2026-07-05"
      )
    ).toBe("当天完成");
    expect(
      formatStepDaysLabel(
        { id: "1", title: "a", done: true, createdAt: "2026-06-28", completedAt: "2026-07-01" },
        "2026-07-05"
      )
    ).toBe("用时 3 天");
  });
});
