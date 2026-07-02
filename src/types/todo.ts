export type TodoStatus = "active" | "completed";

export type Todo = {
  id: string;
  title: string;
  createdAt: string;
  scheduledDate: string;
  completedAt?: string;
  status: TodoStatus;
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
  allTodos: Todo[];
};

export type TodoDraft = {
  title: string;
};

export type AppSettings = {
  widgetBounds?: WindowBounds;
  desktopAttachEnabled: boolean;
  shortcut: string;
};

export type TodoDatabase = {
  version: 1;
  lastRefreshDate: string;
  todos: Todo[];
  settings: AppSettings;
};
