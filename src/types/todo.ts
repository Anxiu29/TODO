/** 待办紧急评分范围：1（最低）到 5（最高） */
export const TODO_RATING_MIN = 1;
export const TODO_RATING_MAX = 5;
export const TODO_RATING_DEFAULT = 1;

/** 挂件卡片透明度范围 */
export const WIDGET_OPACITY_MIN = 0.5;
export const WIDGET_OPACITY_MAX = 1;
export const WIDGET_OPACITY_DEFAULT = 0.92;

/** 内置标签：分类互斥，紧急可与任一分类叠加 */
export const PRESET_TAGS = ["工作", "生活", "学习", "紧急"] as const;
/** 分类标签（每条待办至多一个） */
export const CATEGORY_TAGS = ["工作", "生活", "学习"] as const;
/** 可与分类并存的特殊标签 */
export const URGENT_TAG = "紧急";

export type TodoStatus = "active" | "completed";

/** 待办下的子任务勾选项 */
export type TodoSubtask = {
  id: string;
  title: string;
  done: boolean;
};

/** 界面主题 */
export type WidgetTheme = "light" | "dark";

/** 将评分规范化为 1–5 整数；undefined/NaN 时使用默认值 */
export const normalizeTodoRating = (rating?: number): number => {
  if (rating === undefined || !Number.isFinite(rating)) return TODO_RATING_DEFAULT;
  return Math.min(TODO_RATING_MAX, Math.max(TODO_RATING_MIN, Math.round(rating)));
};

/** 规范化标签：仅预设；分类至多一个（取首次出现）；紧急可并存 */
export const normalizeTodoTags = (tags?: unknown): string[] => {
  if (!Array.isArray(tags)) return [];
  const allowed = new Set<string>(PRESET_TAGS);
  const categories = new Set<string>(CATEGORY_TAGS);
  let category: string | null = null;
  let urgent = false;
  for (const raw of tags) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim();
    if (!tag || !allowed.has(tag)) continue;
    if (tag === URGENT_TAG) {
      urgent = true;
      continue;
    }
    // 脏数据里多个分类时保留第一个，避免加载后语义漂移
    if (categories.has(tag) && !category) category = tag;
  }
  const result: string[] = [];
  if (category) result.push(category);
  if (urgent) result.push(URGENT_TAG);
  return result;
};

/** 规范化子任务列表 */
export const normalizeTodoSubtasks = (subtasks?: unknown): TodoSubtask[] => {
  if (!Array.isArray(subtasks)) return [];
  return subtasks
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Partial<TodoSubtask>;
      const id = typeof record.id === "string" && record.id ? record.id : "";
      const title = typeof record.title === "string" ? record.title.trim() : "";
      if (!id || !title) return null;
      return {
        id,
        title: title.slice(0, 80),
        done: Boolean(record.done)
      } satisfies TodoSubtask;
    })
    .filter((item): item is TodoSubtask => item !== null)
    .slice(0, 20);
};

export const normalizeWidgetOpacity = (opacity?: unknown): number => {
  if (typeof opacity !== "number" || !Number.isFinite(opacity)) return WIDGET_OPACITY_DEFAULT;
  const clamped = Math.min(WIDGET_OPACITY_MAX, Math.max(WIDGET_OPACITY_MIN, opacity));
  return Math.round(clamped * 100) / 100;
};

export const normalizeWidgetTheme = (theme?: unknown): WidgetTheme => (theme === "dark" ? "dark" : "light");

/** 预计完成天数范围 */
export const DUE_DAYS_MIN = 1;
export const DUE_DAYS_MAX = 365;

/** 规范化预计完成天数；空/非法视为未设置 */
export const normalizeDueDays = (dueDays?: unknown): number | undefined => {
  if (dueDays === null || dueDays === undefined || dueDays === "") return undefined;
  const value = typeof dueDays === "number" ? dueDays : Number(dueDays);
  if (!Number.isFinite(value)) return undefined;
  const days = Math.round(value);
  if (days < DUE_DAYS_MIN) return undefined;
  return Math.min(DUE_DAYS_MAX, days);
};

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
  /** 预计几天完成（正整数天数），可选 */
  dueDays?: number;
  status: TodoStatus;
  /** 紧急程度 1–5，影响列表排序 */
  rating: number;
  /** 标签：至多一个分类（工作/生活/学习），可另加「紧急」 */
  tags: string[];
  /** 子任务列表 */
  subtasks: TodoSubtask[];
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
  /** 界面主题 */
  theme: WidgetTheme;
  /** 挂件卡片不透明度 0.5–1 */
  widgetOpacity: number;
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
