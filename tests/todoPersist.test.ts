/**
 * 原子写盘与 TodoStore 回读测试。
 * 不启动 Electron 窗口，只验证临时目录中的 todos.json。
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeFileAtomicSync } from "../electron/atomicWrite";
import { createEmptyDatabase, TodoStore } from "../electron/todoStore";
import { todayKey } from "../src/data/todoStore";
import type { TodoDatabase, TodoDraft } from "../src/types/todo";

const tempDirs: string[] = [];

const createTempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "todo-atomic-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("writeFileAtomicSync", () => {
  it("creates a new file with the given contents", () => {
    const filePath = join(createTempDir(), "todos.json");
    writeFileAtomicSync(filePath, "{\"ok\":true}");
    expect(readFileSync(filePath, "utf8")).toBe("{\"ok\":true}");
  });

  it("replaces an existing file instead of appending", () => {
    const filePath = join(createTempDir(), "todos.json");
    writeFileSync(filePath, "old-truncated", "utf8");
    writeFileAtomicSync(filePath, "{\n  \"version\": 1\n}");
    expect(readFileSync(filePath, "utf8")).toBe("{\n  \"version\": 1\n}");
  });

  it("does not leave a pid temp file after a successful replace", () => {
    const dir = createTempDir();
    const filePath = join(dir, "todos.json");
    writeFileSync(filePath, "old", "utf8");
    writeFileAtomicSync(filePath, "new");
    const leftovers = readdirSync(dir).filter((name) => name.includes(".tmp"));
    expect(leftovers).toEqual([]);
    expect(existsSync(filePath)).toBe(true);
  });
});

describe("TodoStore persistence", () => {
  const writeDatabase = (filePath: string, database: TodoDatabase): void => {
    writeFileSync(filePath, JSON.stringify(database, null, 2), "utf8");
  };

  it("round-trips an added todo through a new store instance", () => {
    const filePath = join(createTempDir(), "todos.json");
    const store = new TodoStore(filePath);
    store.addTodo({ title: "写测试" });

    const reloaded = new TodoStore(filePath);
    expect(reloaded.getSnapshot().activeTodos.map((todo) => todo.title)).toEqual(["写测试"]);
  });

  it("rolls yesterday's open todos when saving after a day change", () => {
    const filePath = join(createTempDir(), "todos.json");
    const yesterday = "2020-01-01";
    const database = createEmptyDatabase(yesterday);
    database.todos.push({
      id: "legacy",
      title: "跨夜事项",
      createdAt: `${yesterday}T08:00:00.000Z`,
      scheduledDate: yesterday,
      status: "active",
      waitHistory: [],
      rating: 5,
      tags: [],
      subtasks: []
    });
    writeDatabase(filePath, database);

    const store = new TodoStore(filePath);
    const today = todayKey();
    expect(store.getSnapshot().activeTodos[0]?.scheduledDate).toBe(today);

    const persisted = JSON.parse(readFileSync(filePath, "utf8")) as TodoDatabase;
    expect(persisted.lastRefreshDate).toBe(today);
    expect(persisted.todos[0]?.scheduledDate).toBe(today);
  });

  it("persists last deleted todo so a new store instance can undo", () => {
    const filePath = join(createTempDir(), "todos.json");
    const store = new TodoStore(filePath);
    store.addTodo({ title: "可撤回" });
    const id = store.getSnapshot().activeTodos[0]?.id;
    expect(id).toBeTruthy();

    store.deleteTodo(id as string);
    expect(store.getSnapshot().activeTodos).toHaveLength(0);
    expect(store.getSnapshot().pendingUndoTitle).toBe("可撤回");

    const reloaded = new TodoStore(filePath);
    expect(reloaded.getSnapshot().pendingUndoTitle).toBe("可撤回");
    reloaded.undoLastDelete();
    expect(reloaded.getSnapshot().activeTodos.map((todo) => todo.title)).toEqual(["可撤回"]);
    expect(reloaded.getSnapshot().pendingUndoTitle).toBeUndefined();
  });

  it("copies unreadable todos.json aside instead of silently losing it", () => {
    const dir = createTempDir();
    const filePath = join(dir, "todos.json");
    writeFileSync(filePath, "{ not json", "utf8");

    const store = new TodoStore(filePath);
    expect(store.getSnapshot().activeTodos).toEqual([]);

    const backups = readdirSync(dir).filter((name) => name.startsWith("todos.json.corrupt-"));
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(dir, backups[0] as string), "utf8")).toBe("{ not json");
    expect(readFileSync(filePath, "utf8")).toBe("{ not json");
  });

  it("does not throw when addTodo receives a malformed draft", () => {
    const filePath = join(createTempDir(), "todos.json");
    const store = new TodoStore(filePath);
    expect(() => store.addTodo({} as TodoDraft)).not.toThrow();
    expect(store.getSnapshot().activeTodos).toHaveLength(0);
  });
});
