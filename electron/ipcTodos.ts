/**
 * 待办相关 IPC 注册。
 *
 * 与窗口/桌面附着拆开，避免 main.ts 再堆 CRUD 样板。
 * 入参非法时不调用 store（避免 title.trim 等对非字符串抛错），也不广播。
 */
import { ipcMain } from "electron";
import type { TodoDraft, TodoSnapshot, TodoUpdate } from "../src/types/todo";
import type { TodoStore } from "./todoStore";

/** 非空字符串才当作待办/步骤 id */
const asId = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

/** 日历年月：必须是整数，月份 1–12 */
const asYearMonth = (year: unknown, month: unknown): { year: number; month: number } | null => {
  const y = typeof year === "number" ? year : Number(year);
  const m = typeof month === "number" ? month : Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
    return null;
  }
  return { year: y, month: m };
};

/**
 * 注册 todos:* 通道。
 * @param store 主进程唯一写盘实例
 * @param broadcast 变更后先日切再推所有窗口；由 main 注入以复用同一套广播
 */
export const registerTodoIpc = (store: TodoStore, broadcast: () => TodoSnapshot): void => {
  const unchanged = (): TodoSnapshot => store.getSnapshot();

  ipcMain.handle("todos:getSnapshot", () => store.refreshDaily());

  ipcMain.handle("todos:add", (_event, draft: unknown) => {
    if (!draft || typeof draft !== "object") return unchanged();
    store.addTodo(draft as TodoDraft);
    return broadcast();
  });

  const mutateById = (id: unknown, run: (todoId: string) => void): TodoSnapshot => {
    const todoId = asId(id);
    if (!todoId) return unchanged();
    run(todoId);
    return broadcast();
  };

  ipcMain.handle("todos:complete", (_event, id: unknown) => mutateById(id, (todoId) => store.completeTodo(todoId)));
  ipcMain.handle("todos:reopen", (_event, id: unknown) => mutateById(id, (todoId) => store.reopenTodo(todoId)));
  ipcMain.handle("todos:delete", (_event, id: unknown) => mutateById(id, (todoId) => store.deleteTodo(todoId)));
  ipcMain.handle("todos:undoLastDelete", () => {
    store.undoLastDelete();
    return broadcast();
  });
  ipcMain.handle("todos:update", (_event, id: unknown, update: unknown) => {
    const todoId = asId(id);
    if (!todoId || !update || typeof update !== "object") return unchanged();
    store.updateTodo(todoId, update as TodoUpdate);
    return broadcast();
  });
  ipcMain.handle("todos:setRating", (_event, id: unknown, rating: unknown) => {
    if (typeof rating !== "number" || !Number.isFinite(rating)) return unchanged();
    return mutateById(id, (todoId) => store.setTodoRating(todoId, rating));
  });
  ipcMain.handle("todos:setTags", (_event, id: unknown, tags: unknown) => {
    if (!Array.isArray(tags)) return unchanged();
    return mutateById(id, (todoId) => store.setTodoTags(todoId, tags));
  });
  ipcMain.handle("todos:setDueDays", (_event, id: unknown, dueDays: unknown) => {
    if (dueDays !== null && typeof dueDays !== "number") return unchanged();
    return mutateById(id, (todoId) => store.setTodoDueDays(todoId, dueDays));
  });
  ipcMain.handle("todos:setWaiting", (_event, id: unknown, options?: unknown) => {
    if (options !== undefined && (typeof options !== "object" || options === null)) return unchanged();
    return mutateById(id, (todoId) => store.setTodoWaiting(todoId, options as { reason?: string | null } | undefined));
  });
  ipcMain.handle("todos:resume", (_event, id: unknown) => mutateById(id, (todoId) => store.resumeTodo(todoId)));
  ipcMain.handle("todos:addSubtask", (_event, id: unknown, title: unknown) => {
    if (typeof title !== "string") return unchanged();
    return mutateById(id, (todoId) => store.addTodoSubtask(todoId, title));
  });
  ipcMain.handle("todos:toggleSubtask", (_event, id: unknown, subtaskId: unknown) => {
    const childId = asId(subtaskId);
    if (!childId) return unchanged();
    return mutateById(id, (todoId) => store.toggleTodoSubtask(todoId, childId));
  });
  ipcMain.handle("todos:updateSubtask", (_event, id: unknown, subtaskId: unknown, title: unknown) => {
    const childId = asId(subtaskId);
    if (!childId || typeof title !== "string") return unchanged();
    return mutateById(id, (todoId) => store.updateTodoSubtask(todoId, childId, title));
  });
  ipcMain.handle("todos:deleteSubtask", (_event, id: unknown, subtaskId: unknown) => {
    const childId = asId(subtaskId);
    if (!childId) return unchanged();
    return mutateById(id, (todoId) => store.deleteTodoSubtask(todoId, childId));
  });
  ipcMain.handle("todos:getCalendar", (_event, year: unknown, month: unknown) => {
    store.refreshDaily();
    const parsed = asYearMonth(year, month);
    if (!parsed) return [];
    return store.getCalendar(parsed.year, parsed.month);
  });
};
