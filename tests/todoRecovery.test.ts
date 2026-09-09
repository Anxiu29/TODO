/** 注入读写故障，验证回滚、重试以及坏库/读取失败时的保护。 */
import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TodoStore, createEmptyDatabase } from "../electron/todoStore";

const failure = vi.hoisted(() => ({ write: false, read: false, backup: false }));
vi.mock("../electron/atomicWrite", async (original) => {
  const actual = await original<typeof import("../electron/atomicWrite")>();
  return { writeFileAtomicSync: (...args: Parameters<typeof actual.writeFileAtomicSync>) => {
    if (failure.write) throw new Error("disk full");
    return actual.writeFileAtomicSync(...args);
  } };
});
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return { ...actual,
    readFileSync: (...args: any[]) => {
      if (failure.read) throw Object.assign(new Error("locked"), { code: "EACCES" });
      return (actual.readFileSync as any)(...args);
    },
    copyFileSync: (...args: Parameters<typeof actual.copyFileSync>) => {
      if (failure.backup) throw new Error("backup failed");
      return actual.copyFileSync(...args);
    }
  };
});
const dirs: string[] = [];
const file = () => {
  const dir = mkdtempSync(join(tmpdir(), "todo-recovery-")); dirs.push(dir);
  return join(dir, "todos.json");
};
afterEach(() => {
  failure.write = failure.read = failure.backup = false;
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

it("rolls back failed addition and retries without duplicating", () => {
  const path = file(); const notify = vi.fn(); const store = new TodoStore(path, notify);
  store.addTodo({ title: "original" });
  const before = readFileSync(path, "utf8");
  failure.write = true;
  expect(() => store.addTodo({ title: "new" })).toThrow("本次修改已撤回");
  expect(store.getSnapshot().activeTodos.map((todo) => todo.title)).toEqual(["original"]);
  expect(readFileSync(path, "utf8")).toBe(before);
  expect(notify).toHaveBeenCalledTimes(1);
  failure.write = false;
  store.addTodo({ title: "new" });
  expect(new TodoStore(path).getSnapshot().activeTodos).toHaveLength(2);
});

it("rolls back deletes, settings and daily rollover", () => {
  const path = file(); const store = new TodoStore(path);
  const snapshot = store.addTodo({ title: "keep" });
  failure.write = true;
  expect(() => store.deleteTodo(snapshot.activeTodos[0]!.id)).toThrow();
  expect(store.getSnapshot()).toEqual(snapshot);
  expect(() => store.setTheme("light")).toThrow();
  expect(store.getSettings().theme).toBe("dark");
  expect(() => store.refreshDaily("2099-01-01")).toThrow();
  expect(store.getSnapshot()).toEqual(snapshot);
});

it("does not replace valid data when reading is temporarily denied", () => {
  const path = file(); const raw = JSON.stringify(createEmptyDatabase()); writeFileSync(path, raw);
  failure.read = true;
  expect(() => new TodoStore(path)).toThrow("无法读取");
  failure.read = false;
  expect(readFileSync(path, "utf8")).toBe(raw);
});

it.each([false, true])("blocks corrupt data even if backup fails=%s", (backupFails) => {
  const path = file(); writeFileSync(path, "{ broken"); failure.backup = backupFails;
  expect(() => new TodoStore(path)).toThrow("原文件未覆盖");
  expect(readFileSync(path, "utf8")).toBe("{ broken");
  expect(readdirSync(dirs.at(-1)!).filter((name) => name.includes("corrupt"))).toHaveLength(backupFails ? 0 : 1);
});

it("rejects malformed records rather than silently dropping them", () => {
  const path = file(); writeFileSync(path, JSON.stringify({ ...createEmptyDatabase(), todos: [null] }));
  expect(() => new TodoStore(path)).toThrow("原文件未覆盖");
});
