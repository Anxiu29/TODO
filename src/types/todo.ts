/** 待办紧急评分范围：1（最低）到 5（最高） */
export const TODO_RATING_MIN = 1;
export const TODO_RATING_MAX = 5;
/** 新建待办默认五星；缺失/非法评分规范化时也回落到此值 */
export const TODO_RATING_DEFAULT = 5;

/** 挂件卡片不透明度范围；0=全透明（仍占位，但几乎看不见也难点） */
export const WIDGET_OPACITY_MIN = 0;
export const WIDGET_OPACITY_MAX = 1;
/** 挂件默认不透明度 75% */
export const WIDGET_OPACITY_DEFAULT = 0.75;

/** 内置标签：分类互斥，紧急可与任一分类/自定义叠加 */
export const PRESET_TAGS = ["工作", "生活", "学习", "紧急"] as const;
/** 分类标签（每条待办至多一个） */
export const CATEGORY_TAGS = ["工作", "生活", "学习"] as const;
/** 可与分类并存的特殊标签 */
export const URGENT_TAG = "紧急";
/** 自定义标签最大字符数（trim 后截断） */
export const CUSTOM_TAG_MAX_LEN = 12;
/** 单条待办最多标签数（含分类、紧急、自定义） */
export const TODO_TAGS_MAX = 6;

export type TodoStatus = "active" | "waiting" | "completed";

/** 等待原因最大字符数（trim 后截断） */
export const WAITING_REASON_MAX_LEN = 40;
/** 单条待办最多保留的已结束等待段数（超出丢弃最早的） */
export const WAIT_HISTORY_MAX = 50;

/**
 * 一段已结束的等待记录。
 * 当前进行中的等待仍用 Todo.waitingSince / waitingReason，结束后才写入本数组。
 */
export type TodoWaitRecord = {
  /** 开始等待日 YYYY-MM-DD */
  startedAt: string;
  /** 结束等待日 YYYY-MM-DD（恢复进行或完成时写入） */
  endedAt: string;
  /** 该段等待原因（可选） */
  reason?: string;
};

/** 待办下的步骤勾选项（持久化字段名仍为 subtasks） */
export type TodoSubtask = {
  id: string;
  title: string;
  done: boolean;
  /** 添加日 YYYY-MM-DD */
  createdAt: string;
  /** 勾选完成日 YYYY-MM-DD；未完成时无此字段 */
  completedAt?: string;
};

/** 界面主题 */
export type WidgetTheme = "light" | "dark";
/** 默认主题：深色 */
export const WIDGET_THEME_DEFAULT: WidgetTheme = "dark";

/** 将评分规范化为 1–5 整数；undefined/NaN 时使用默认值 */
export const normalizeTodoRating = (rating?: number): number => {
  if (rating === undefined || !Number.isFinite(rating)) return TODO_RATING_DEFAULT;
  return Math.min(TODO_RATING_MAX, Math.max(TODO_RATING_MIN, Math.round(rating)));
};

/** 是否为内置分类标签 */
export const isCategoryTag = (tag: string): boolean =>
  (CATEGORY_TAGS as readonly string[]).includes(tag);

/** 是否为内置预设标签（分类或紧急） */
export const isPresetTag = (tag: string): boolean =>
  (PRESET_TAGS as readonly string[]).includes(tag);

/**
 * 规范化标签：分类至多一个（取首次出现）；紧急可并存；
 * 其余视为自定义（去重、截断长度、总数上限）。
 */
export const normalizeTodoTags = (tags?: unknown): string[] => {
  if (!Array.isArray(tags)) return [];
  let category: string | null = null;
  let urgent = false;
  const customs: string[] = [];
  const seenCustom = new Set<string>();

  for (const raw of tags) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim().slice(0, CUSTOM_TAG_MAX_LEN);
    if (!tag) continue;
    if (tag === URGENT_TAG) {
      urgent = true;
      continue;
    }
    // 脏数据里多个分类时保留第一个，避免加载后语义漂移
    if (isCategoryTag(tag)) {
      if (!category) category = tag;
      continue;
    }
    if (!seenCustom.has(tag)) {
      seenCustom.add(tag);
      customs.push(tag);
    }
  }

  const result: string[] = [];
  if (category) result.push(category);
  for (const custom of customs) {
    // 预留「紧急」一位，避免自定义把上限占满后紧急被挤掉
    if (result.length >= TODO_TAGS_MAX - (urgent ? 1 : 0)) break;
    result.push(custom);
  }
  if (urgent) result.push(URGENT_TAG);
  return result.slice(0, TODO_TAGS_MAX);
};

/** 是否为合法 YYYY-MM-DD 日期键 */
export const isDateKey = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * 规范化步骤列表。
 * - 缺 createdAt 时用 fallbackDate（加载时一般为今天或父任务 scheduledDate）
 * - done 且缺 completedAt 时回退 createdAt（旧数据不夸大用时）
 * - 未完成则不写 completedAt
 */
export const normalizeTodoSubtasks = (subtasks?: unknown, fallbackDate?: string): TodoSubtask[] => {
  if (!Array.isArray(subtasks)) return [];
  const fallback = isDateKey(fallbackDate) ? fallbackDate : "";
  const normalized: TodoSubtask[] = [];

  for (const item of subtasks) {
    if (!item || typeof item !== "object") continue;
    const record = item as Partial<TodoSubtask>;
    const id = typeof record.id === "string" && record.id ? record.id : "";
    const title = typeof record.title === "string" ? record.title.trim() : "";
    if (!id || !title) continue;
    const createdAt = isDateKey(record.createdAt) ? record.createdAt : fallback;
    if (!createdAt) continue;

    const done = Boolean(record.done);
    if (done) {
      normalized.push({
        id,
        title: title.slice(0, 80),
        done: true,
        createdAt,
        completedAt: isDateKey(record.completedAt) ? record.completedAt : createdAt
      });
    } else {
      normalized.push({
        id,
        title: title.slice(0, 80),
        done: false,
        createdAt
      });
    }
    if (normalized.length >= 20) break;
  }

  return normalized;
};

export const normalizeWidgetOpacity = (opacity?: unknown): number => {
  if (typeof opacity !== "number" || !Number.isFinite(opacity)) return WIDGET_OPACITY_DEFAULT;
  const clamped = Math.min(WIDGET_OPACITY_MAX, Math.max(WIDGET_OPACITY_MIN, opacity));
  return Math.round(clamped * 100) / 100;
};

/** 非法/缺失时回退深色；仅显式 light 保留浅色 */
export const normalizeWidgetTheme = (theme?: unknown): WidgetTheme =>
  theme === "light" ? "light" : WIDGET_THEME_DEFAULT;

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

/** 规范化等待原因；空串视为未设置 */
export const normalizeWaitingReason = (reason?: unknown): string | undefined => {
  if (typeof reason !== "string") return undefined;
  const trimmed = reason.trim().slice(0, WAITING_REASON_MAX_LEN);
  return trimmed || undefined;
};

/**
 * 规范化等待历史。
 * - 非法日期的条目丢弃；reason 经 normalizeWaitingReason
 * - 超出 WAIT_HISTORY_MAX 时保留最近的记录
 */
export const normalizeWaitHistory = (history?: unknown): TodoWaitRecord[] => {
  if (!Array.isArray(history)) return [];
  const normalized: TodoWaitRecord[] = [];

  for (const item of history) {
    if (!item || typeof item !== "object") continue;
    const record = item as Partial<TodoWaitRecord>;
    if (!isDateKey(record.startedAt) || !isDateKey(record.endedAt)) continue;
    const reason = normalizeWaitingReason(record.reason);
    normalized.push({
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      ...(reason ? { reason } : {})
    });
  }

  return normalized.length > WAIT_HISTORY_MAX
    ? normalized.slice(-WAIT_HISTORY_MAX)
    : normalized;
};

/**
 * 将当前等待段追加到 waitHistory（不清除 waitingSince/waitingReason）。
 * 无 waitingSince 时 no-op；调用方负责随后 clear 当前段字段。
 */
export const appendWaitHistory = (
  history: TodoWaitRecord[] | undefined,
  waitingSince: string | undefined,
  waitingReason: string | undefined,
  endedAt: string
): TodoWaitRecord[] => {
  if (!isDateKey(waitingSince) || !isDateKey(endedAt)) {
    return normalizeWaitHistory(history);
  }
  const reason = normalizeWaitingReason(waitingReason);
  return normalizeWaitHistory([
    ...(history ?? []),
    {
      startedAt: waitingSince,
      endedAt,
      ...(reason ? { reason } : {})
    }
  ]);
};

/** 单条待办记录，持久化在 todos.json 的 todos 数组中 */
export type Todo = {
  id: string;
  title: string;
  /** ISO 8601 创建时间 */
  createdAt: string;
  /** 归属日期 YYYY-MM-DD，日切时进行中/等待中待办会更新此字段 */
  scheduledDate: string;
  /** 完成时刻，仅 status=completed 时有值 */
  completedAt?: string;
  /** 预计几天完成（正整数天数），可选 */
  dueDays?: number;
  status: TodoStatus;
  /** 开始等待的日期 YYYY-MM-DD，仅 status=waiting 时有值 */
  waitingSince?: string;
  /** 等待原因（可选短文本） */
  waitingReason?: string;
  /**
   * 已结束的等待段历史（谁写：主进程结束等待/完成时 append；谁读：挂件等待面板）。
   * 当前进行中的一段不在此数组，见 waitingSince/waitingReason。
   */
  waitHistory: TodoWaitRecord[];
  /** 紧急程度 1–5，影响列表排序 */
  rating: number;
  /** 标签：至多一个分类（工作/生活/学习），可另加「紧急」与自定义标签 */
  tags: string[];
  /** 子任务列表 */
  subtasks: TodoSubtask[];
};

/**
 * 规范化状态与等待字段。
 * - 非法 status 回退 active
 * - waiting 缺 waitingSince 时用 fallbackDate（通常为今天）
 * - 非 waiting 时清除等待字段
 */
export const normalizeTodoWaitingFields = (
  status: unknown,
  waitingSince: unknown,
  waitingReason: unknown,
  fallbackDate: string
): Pick<Todo, "status" | "waitingSince" | "waitingReason"> => {
  if (status === "completed") {
    return { status: "completed" };
  }
  if (status === "waiting") {
    const reason = normalizeWaitingReason(waitingReason);
    return {
      status: "waiting",
      waitingSince: isDateKey(waitingSince) ? waitingSince : fallbackDate,
      ...(reason ? { waitingReason: reason } : {})
    };
  }
  return { status: "active" };
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
  /** 今日未完成：含 active 与 waiting */
  activeTodos: Todo[];
  completedToday: Todo[];
};

/** 新建待办时的输入；rating 省略则用 TODO_RATING_DEFAULT */
export type TodoDraft = {
  title: string;
  /** 紧急评分 1–5，可选 */
  rating?: number;
  /** 初始标签；省略则为空。挂件在某标签筛选下添加时会带上该标签 */
  tags?: string[];
  /** 预计几天完成；省略或非法则不写入 */
  dueDays?: number;
};

/** 快捷添加窗口唤起时携带的上下文（主进程 → 渲染进程） */
export type QuickAddFocusPayload = {
  /** 打开时预填的标签；无筛选时为空数组 */
  tags: string[];
};

/** 独立编辑窗打开/切换待办时携带的 id（主进程 → 渲染进程） */
export type EditTodoPayload = {
  id: string;
};

/** 编辑待办时的可更新字段 */
export type TodoUpdate = {
  title: string;
};

/**
 * 挂件基础显示模式：
 * - normal：普通窗口
 * - desktop：桌面固定·壁纸软件（优先附着已有 WorkerW，适配 Wallpaper Engine 等）
 * - system：桌面固定·系统壁纸（主动生成 WorkerW，适配 Windows 设置里的图片/纯色壁纸）
 * 后两者均为 SetParent 桌面层，Win+D 后仍可见。
 */
export type WidgetDisplayMode = "normal" | "desktop" | "system";

/** 规范化挂件标签筛选；null/空=全部，非法值回退全部 */
export const normalizeTagFilter = (value?: unknown): string | null => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return null;
  const tag = value.trim().slice(0, CUSTOM_TAG_MAX_LEN);
  return tag || null;
};

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
  /** 挂件卡片不透明度 0–1 */
  widgetOpacity: number;
  /** 挂件标签筛选；null=全部，重启/自启后恢复 */
  tagFilter: string | null;
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
