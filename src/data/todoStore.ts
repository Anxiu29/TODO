import type { Todo, TodoCalendarDay, TodoDatabase, TodoSnapshot } from "../types/todo";
import { normalizeTodoRating } from "../types/todo";

/** 将日期格式化为 YYYY-MM-DD，作为待办的「归属日」键。 */
export const todayKey = (date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/**
 * 待办排序：进行中优先，同状态按评分降序，再按创建时间升序。
 */
export const sortTodos = (todos: Todo[]): Todo[] =>
  [...todos].sort((a, b) => {
    if (a.status !== b.status) return a.status === "active" ? -1 : 1;
    const ratingDiff = normalizeTodoRating(b.rating) - normalizeTodoRating(a.rating);
    if (ratingDiff !== 0) return ratingDiff;
    return a.createdAt.localeCompare(b.createdAt);
  });

/** 根据数据库构建 UI 用的当日快照（进行中 + 今日完成）。 */
export const buildTodoSnapshot = (database: TodoDatabase, date = todayKey()): TodoSnapshot => {
  const sorted = sortTodos(database.todos);

  return {
    today: date,
    activeTodos: sorted.filter((todo) => todo.status === "active" && todo.scheduledDate === date),
    completedToday: sorted.filter((todo) => todo.status === "completed" && todo.completedAt?.startsWith(date))
  };
};

/**
 * 日切逻辑：日期变化时，把所有进行中待办的 scheduledDate 更新为新日期。
 * 已完成待办保留 completedAt，供日历回看。
 */
export const refreshDatabaseForDate = (database: TodoDatabase, date = todayKey()): TodoDatabase => {
  if (database.lastRefreshDate === date) {
    return database;
  }

  return {
    ...database,
    lastRefreshDate: date,
    todos: database.todos.map((todo) => (todo.status === "active" ? { ...todo, scheduledDate: date } : todo))
  };
};

/** 更新待办标题；标题为空或未找到时返回原数据库。 */
export const updateTodoTitle = (database: TodoDatabase, id: string, title: string): TodoDatabase => {
  const trimmed = title.trim();
  if (!trimmed) return database;

  const index = database.todos.findIndex((todo) => todo.id === id);
  if (index === -1) return database;

  const todos = [...database.todos];
  todos[index] = { ...todos[index], title: trimmed };
  return { ...database, todos };
};

/** 按月聚合已完成待办，供日历视图展示每日完成数量与列表。 */
export const getCalendarForMonth = (database: TodoDatabase, year: number, month: number): TodoCalendarDay[] => {
  const monthPrefix = `${year}-${String(month).padStart(2, "0")}`;
  const completedByDate = new Map<string, Todo[]>();

  for (const todo of database.todos) {
    if (todo.status !== "completed" || !todo.completedAt?.startsWith(monthPrefix)) continue;

    const date = todo.completedAt.slice(0, 10);
    const current = completedByDate.get(date) ?? [];
    current.push(todo);
    completedByDate.set(date, current);
  }

  return [...completedByDate.entries()]
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .map(([date, completedTodos]) => ({
      date,
      completedCount: completedTodos.length,
      completedTodos: sortTodos(completedTodos)
    }));
};
