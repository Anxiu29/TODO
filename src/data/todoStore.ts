/**
 * 待办业务纯函数层（无 I/O）。
 *
 * 主进程 TodoStore 与 Vitest 单元测试共用此模块，保证排序、日切、
 * 日历聚合等逻辑在两端行为一致。
 */
import type {
  Todo,
  TodoCalendarDay,
  TodoDatabase,
  TodoSnapshot,
  TodoStatus,
  TodoSubtask
} from "../types/todo";
import { normalizeTodoRating } from "../types/todo";

/** 将日期格式化为 YYYY-MM-DD，作为待办的「归属日」键 */
export const todayKey = (date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/** 未完成状态：进行中与等待中都会出现在今日列表，并参与日切滚动 */
export const isOpenTodoStatus = (status: TodoStatus): boolean =>
  status === "active" || status === "waiting";

/** 列表排序权重：active → waiting → completed */
const STATUS_ORDER: Record<TodoStatus, number> = {
  active: 0,
  waiting: 1,
  completed: 2
};

/**
 * 两个 YYYY-MM-DD 之间的整日差（to - from）；非法键视为 0。
 * 同日为 0，跨一天为 1。
 */
export const daysBetweenDateKeys = (from: string, to: string): number => {
  const fromMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from);
  const toMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to);
  if (!fromMatch || !toMatch) return 0;

  const startFrom = new Date(Number(fromMatch[1]), Number(fromMatch[2]) - 1, Number(fromMatch[3]));
  const startTo = new Date(Number(toMatch[1]), Number(toMatch[2]) - 1, Number(toMatch[3]));
  return Math.max(0, Math.floor((startTo.getTime() - startFrom.getTime()) / 86_400_000));
};

/** 步骤用时/已进行文案；today 为当前本地日 YYYY-MM-DD */
export const formatStepDaysLabel = (subtask: TodoSubtask, today: string): string => {
  if (subtask.done) {
    const end = subtask.completedAt ?? subtask.createdAt;
    const days = daysBetweenDateKeys(subtask.createdAt, end);
    if (days === 0) return "当天完成";
    return `用时 ${days} 天`;
  }
  const days = daysBetweenDateKeys(subtask.createdAt, today);
  if (days === 0) return "今天添加";
  return `已进行 ${days} 天`;
};

/**
 * 待办排序规则（列表展示顺序）：
 * 1. active → waiting → completed
 * 2. 同状态按 rating 降序（紧急的在前）
 * 3. 评分相同按 createdAt 升序（先创建的在前）
 */
export const sortTodos = (todos: Todo[]): Todo[] =>
  [...todos].sort((a, b) => {
    const statusDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (statusDiff !== 0) return statusDiff;
    const ratingDiff = normalizeTodoRating(b.rating) - normalizeTodoRating(a.rating);
    if (ratingDiff !== 0) return ratingDiff;
    return a.createdAt.localeCompare(b.createdAt);
  });

/**
 * 根据数据库构建 UI 用的当日快照。
 * - activeTodos：今日未完成（active + waiting）且 scheduledDate=今天
 * - completedToday：status=completed 且 completedAt 以今天日期开头
 */
export const buildTodoSnapshot = (database: TodoDatabase, date = todayKey()): TodoSnapshot => {
  const sorted = sortTodos(database.todos);

  return {
    today: date,
    activeTodos: sorted.filter((todo) => isOpenTodoStatus(todo.status) && todo.scheduledDate === date),
    completedToday: sorted.filter((todo) => todo.status === "completed" && todo.completedAt?.startsWith(date))
  };
};

/**
 * 日切逻辑：当 lastRefreshDate !== 今天时触发。
 *
 * 把所有进行中/等待中待办的 scheduledDate 更新为新日期（未完成事项「滚入」新一天）。
 * waitingSince 保持不变，等待天数随日期自然增长。
 * 已完成待办保留 completedAt，供日历回看历史完成记录。
 * 返回新对象以支持不可变比较（refreshDaily 通过引用相等判断是否写盘）。
 */
export const refreshDatabaseForDate = (database: TodoDatabase, date = todayKey()): TodoDatabase => {
  if (database.lastRefreshDate === date) {
    return database;
  }

  return {
    ...database,
    lastRefreshDate: date,
    todos: database.todos.map((todo) =>
      isOpenTodoStatus(todo.status) ? { ...todo, scheduledDate: date } : todo
    )
  };
};

/** 更新待办标题；标题 trim 后为空或未找到 id 时返回原数据库引用（不触发 save） */
export const updateTodoTitle = (database: TodoDatabase, id: string, title: string): TodoDatabase => {
  const trimmed = title.trim();
  if (!trimmed) return database;

  const index = database.todos.findIndex((todo) => todo.id === id);
  if (index === -1) return database;

  const todos = [...database.todos];
  todos[index] = { ...todos[index], title: trimmed };
  return { ...database, todos };
};

/**
 * 按月聚合已完成待办，供日历视图展示。
 * 仅统计 completedAt 落在指定年月的记录，按日期分组并排序。
 */
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
