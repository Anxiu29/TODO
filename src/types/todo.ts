/** 待办紧急评分范围：1（最低）到 5（最高） */
export const TODO_RATING_MIN = 1;
export const TODO_RATING_MAX = 5;
export const TODO_RATING_DEFAULT = 1;

/** 将评分规范化为 1–5 整数；undefined/NaN 时使用默认值 */
export const normalizeTodoRating = (rating?: number): number => {
  if (rating === undefined || !Number.isFinite(rating)) return TODO_RATING_DEFAULT;
  return Math.min(TODO_RATING_MAX, Math.max(TODO_RATING_MIN, Math.round(rating)));
};

export type TodoStatus = "active" | "completed";

/** 单条待办记录，持久化在 todos.json 的 todos 数组中 */
export type Todo = {
  id: string;
  title: string;
  /** ISO 8601 创建时间 */
  createdAt: string;
  /** 归属日期 YYYY-MM-DD，日切时进行中待办会更新此字段 */
  scheduledDate: string;
  /** 完成时刻，仅 status=completed 时有值 */
  completedAt?: string;
  status: TodoStatus;
  /** 紧急程度 1–5，影响列表排序 */
  rating: number;
};

/** 挂件窗口的位置与尺寸，持久化在 settings.widgetBounds */
export type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** 日历视图中某一天的完成汇总 */
export type TodoCalendarDay = {
  date: string;
  completedCount: number;
  completedTodos: Todo[];
};

/** 渲染进程 UI 使用的当日数据视图（由 buildTodoSnapshot 生成） */
export type TodoSnapshot = {
  today: string;
  activeTodos: Todo[];
  completedToday: Todo[];
};

/** 新建待办时的输入 */
export type TodoDraft = {
  title: string;
};

/** 编辑待办时的可更新字段 */
export type TodoUpdate = {
  title: string;
};

/** 挂件基础显示模式：normal=普通窗口，desktop=贴到 Windows 桌面层（Win+D 后仍显示） */
export type WidgetDisplayMode = "normal" | "desktop";

/** 用户偏好设置，持久化在 todos.json 的 settings 对象中 */
export type AppSettings = {
  widgetBounds?: WindowBounds;
  displayMode: WidgetDisplayMode;
  launchAtLogin: boolean;
  /** 全局快捷键：唤起快捷添加窗口 */
  shortcut: string;
  /** 全局快捷键：临时显示桌面挂件 */
  showWidgetShortcut: string;
};

/** 修改快捷键后 IPC 返回的结果，含是否注册成功及实际生效的组合 */
export type ShortcutRegistrationResult = {
  settings: AppSettings;
  registered: boolean;
  requestedShortcut: string;
  activeShortcut: string;
};

/** 持久化到 todos.json 的完整数据结构 */
export type TodoDatabase = {
  version: 1;
  /** 上次执行日切的日期，用于判断是否需要滚动未完成待办 */
  lastRefreshDate: string;
  todos: Todo[];
  settings: AppSettings;
};
