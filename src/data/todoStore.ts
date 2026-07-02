import type { Todo, TodoCalendarDay, TodoDatabase, TodoSnapshot } from "../types/todo";

export const todayKey = (date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const sortTodos = (todos: Todo[]): Todo[] =>
  [...todos].sort((a, b) => {
    if (a.status !== b.status) return a.status === "active" ? -1 : 1;
    return a.createdAt.localeCompare(b.createdAt);
  });

export const buildTodoSnapshot = (database: TodoDatabase, date = todayKey()): TodoSnapshot => {
  const allTodos = sortTodos(database.todos);

  return {
    today: date,
    activeTodos: allTodos.filter((todo) => todo.status === "active" && todo.scheduledDate === date),
    completedToday: allTodos.filter((todo) => todo.status === "completed" && todo.completedAt?.startsWith(date)),
    allTodos
  };
};

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
