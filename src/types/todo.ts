export const TODO_RATING_MIN = 1;export const TODO_RATING_MAX = 5;
export const TODO_RATING_DEFAULT = 1;

export const normalizeTodoRating = (rating?: number): number => {
  if (rating === undefined || !Number.isFinite(rating)) return TODO_RATING_DEFAULT;
  return Math.min(TODO_RATING_MAX, Math.max(TODO_RATING_MIN, Math.round(rating)));
};

export type TodoStatus = "active" | "completed";

export type Todo = {
  id: string;
  title: string;
  createdAt: string;
  scheduledDate: string;
  completedAt?: string;
  status: TodoStatus;
  rating: number;
};

export type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TodoCalendarDay = {
  date: string;
  completedCount: number;
  completedTodos: Todo[];
};

export type TodoSnapshot = {
  today: string;
  activeTodos: Todo[];
  completedToday: Todo[];
};

export type TodoDraft = {
  title: string;
};

export type TodoUpdate = {
  title: string;
};

export type WidgetDisplayMode = "desktop" | "float";

export type AppSettings = {
  widgetBounds?: WindowBounds;
  displayMode: WidgetDisplayMode;
  launchAtLogin: boolean;
  shortcut: string;
  showWidgetShortcut: string;
};

export type ShortcutRegistrationResult = {
  settings: AppSettings;
  registered: boolean;
  requestedShortcut: string;
  activeShortcut: string;
};

/** 持久化到 todos.json 的完整数据结构。 */
export type TodoDatabase = {
  version: 1;
  lastRefreshDate: string;
  todos: Todo[];
  settings: AppSettings;
};
