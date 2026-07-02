import { describe, expect, it } from "vitest";
import { buildTodoSnapshot, getCalendarForMonth, refreshDatabaseForDate } from "../src/data/todoStore";
import type { TodoDatabase } from "../src/types/todo";

const database: TodoDatabase = {
  version: 1,
  lastRefreshDate: "2026-07-01",
  settings: {
    desktopAttachEnabled: true,
    shortcut: "CommandOrControl+Alt+T"
  },
  todos: [
    {
      id: "active-1",
      title: "未完成事项",
      createdAt: "2026-07-01T08:00:00.000Z",
      scheduledDate: "2026-07-01",
      status: "active"
    },
    {
      id: "completed-1",
      title: "已完成事项",
      createdAt: "2026-07-01T09:00:00.000Z",
      scheduledDate: "2026-07-01",
      completedAt: "2026-07-01T10:00:00.000Z",
      status: "completed"
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
});
