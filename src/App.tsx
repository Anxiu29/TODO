/**
 * 桌面挂件主界面（?view=widget）。
 *
 * 功能：今日待办列表、内联/弹窗编辑、完成/删除（确认 + 撤回）、紧急评分、
 * 标签与子任务、等待中（含等待天数）、右键查看添加时间与已过天数、置顶切换、完成区预览、
 * 打开日历/设置/添加窗口（全局快捷键仍可唤起同一添加窗）。
 * 数据通过 window.todoApi 与主进程同步，并订阅 IPC 推送保持多窗口一致。
 */
import { Calendar, CalendarClock, Hourglass, ListTodo, Minus, Pin, Settings, Tag, Trash2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { daysBetweenDateKeys } from "./data/todoStore";
import TodoRating from "./TodoRating";
import TodoSubtasks from "./TodoSubtasks";
import { TodoTagChips, TodoTagEditor } from "./TodoTags";
import type { AppSettings, Todo, TodoSnapshot } from "./types/todo";
import { DUE_DAYS_MAX, DUE_DAYS_MIN, WAITING_REASON_MAX_LEN } from "./types/todo";

/** 右键菜单当前展开的面板；同时只开一个，保持菜单紧凑 */
type ContextPanel = "due" | "tags" | "subtasks" | "waiting" | null;

/** IPC 加载前的占位快照，避免首屏 undefined */
const emptySnapshot: TodoSnapshot = {
  today: "",
  activeTodos: [],
  completedToday: []
};

/** 将 YYYY-MM-DD 格式化为中文日期，如「7月4日 星期六」 */
const formatDate = (date: string): string => {
  if (!date) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long"
  }).format(new Date(`${date}T00:00:00`));
};

/** 将 ISO 创建时间格式化为「2026/7/21 15:30」 */
const formatCreatedAt = (iso: string): string =>
  new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(iso));

/** 按本地日起算，距今天已过去几天（今天添加为 0） */
const daysSinceCreated = (iso: string): number => {
  const created = new Date(iso);
  const now = new Date();
  const startCreated = new Date(created.getFullYear(), created.getMonth(), created.getDate());
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.floor((startToday.getTime() - startCreated.getTime()) / 86_400_000));
};

const formatDaysAgo = (iso: string): string => {
  const days = daysSinceCreated(iso);
  if (days === 0) return "今天添加";
  return `已过去 ${days} 天`;
};

/** 根据 waitingSince 与今日日期键格式化等待文案 */
const formatWaitingDays = (waitingSince: string | undefined, today: string): string => {
  if (!waitingSince) return "等待中";
  const days = daysBetweenDateKeys(waitingSince, today);
  if (days === 0) return "今天开始等待";
  return `已等待 ${days} 天`;
};

/** 右键菜单定位信息；标签内容从 snapshot 按 id 实时取，避免编辑后菜单不同步 */
type TodoContextMenu = {
  id: string;
  x: number;
  y: number;
};

/** Electron 加速器格式 → 用户可读，如 CommandOrControl+Alt+T → Ctrl + Alt + T */
const formatShortcut = (shortcut?: string): string =>
  (shortcut ?? "CommandOrControl+2")
    .replace("CommandOrControl", "Ctrl")
    .replace(/\+/g, " + ");

type IconName = "calendar" | "minimize" | "pin" | "quit" | "settings";

const iconComponents: Record<IconName, typeof Calendar> = {
  calendar: Calendar,
  minimize: Minus,
  pin: Pin,
  quit: X,
  settings: Settings
};

/** 标题栏与 footer 使用的图标 */
const Icon = ({ name }: { name: IconName }): React.ReactElement => {
  const LucideIcon = iconComponents[name];
  return <LucideIcon aria-hidden className="button-icon" strokeWidth={2} />;
};

export default function App(): React.ReactElement {
  const [snapshot, setSnapshot] = useState<TodoSnapshot>(emptySnapshot);
  /** 当前正在内联编辑的待办 id */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  /** Escape 取消编辑时会触发 blur，此 ref 阻止 blur 误保存 */
  const skipBlurSaveRef = useRef(false);
  /**
   * 内联单行装不下完整标题时用弹窗编辑。
   * null=未打开；打开时与内联编辑互斥。
   */
  const [editModal, setEditModal] = useState<{ id: string; title: string } | null>(null);
  const editModalTextareaRef = useRef<HTMLTextAreaElement>(null);
  /** 删除确认弹窗；确认后才真正调用 deleteTodo */
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; title: string } | null>(null);
  /** 删除成功后的撤回条；超时自动消失 */
  const [deleteUndo, setDeleteUndo] = useState<{ title: string } | null>(null);
  const deleteUndoTimerRef = useRef<number | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  /** null=未知，true/false=最近一次桌面附着结果 */
  const [desktopAttached, setDesktopAttached] = useState<boolean | null>(null);
  /** 是否处于「始终置顶」模式，与主进程 pinnedFloat 同步 */
  const [isFloatingOnPage, setIsFloatingOnPage] = useState(false);
  /** 右键菜单：添加时间 + 编辑标签；坐标为视口 clientX/Y */
  const [contextMenu, setContextMenu] = useState<TodoContextMenu | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  /** null=全部；否则按标签筛选今日待办 */
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  /** 右键菜单内「添加子任务」输入草稿 */
  const [subtaskDraft, setSubtaskDraft] = useState("");
  /** 右键菜单展开面板：预计天数 / 标签 / 子任务 / 等待中 */
  const [contextPanel, setContextPanel] = useState<ContextPanel>(null);
  /** 预计完成天数输入草稿；点「确定」才落盘 */
  const [dueDaysDraft, setDueDaysDraft] = useState("");
  /** 与草稿同步，供提交时读取最新值 */
  const dueDaysDraftRef = useRef("");
  dueDaysDraftRef.current = dueDaysDraft;
  /** 等待原因输入草稿 */
  const [waitingReasonDraft, setWaitingReasonDraft] = useState("");
  const waitingReasonDraftRef = useRef("");
  waitingReasonDraftRef.current = waitingReasonDraft;

  /** 挂载时拉取初始数据，并订阅主进程推送；unmount 时取消全部监听 */
  useEffect(() => {
    void window.todoApi.getSnapshot().then(setSnapshot);
    void window.todoApi.getSettings().then(setSettings);
    void window.todoApi.getFloatOnPage().then(setIsFloatingOnPage);

    const offTodos = window.todoApi.onTodosChanged(setSnapshot);
    const offDesktop = window.todoApi.onDesktopAttachResult(setDesktopAttached);
    const offSettings = window.todoApi.onSettingsChanged(setSettings);
    const offFloat = window.todoApi.onFloatStateChanged(setIsFloatingOnPage);
    return () => {
      offTodos();
      offDesktop();
      offSettings();
      offFloat();
      if (deleteUndoTimerRef.current !== null) {
        window.clearTimeout(deleteUndoTimerRef.current);
      }
    };
  }, []);

  /** 展示撤回条，约 10 秒后自动收起 */
  const showDeleteUndo = (title: string): void => {
    if (deleteUndoTimerRef.current !== null) {
      window.clearTimeout(deleteUndoTimerRef.current);
    }
    setDeleteUndo({ title });
    deleteUndoTimerRef.current = window.setTimeout(() => {
      setDeleteUndo(null);
      deleteUndoTimerRef.current = null;
    }, 10_000);
  };

  const dismissDeleteUndo = (): void => {
    if (deleteUndoTimerRef.current !== null) {
      window.clearTimeout(deleteUndoTimerRef.current);
      deleteUndoTimerRef.current = null;
    }
    setDeleteUndo(null);
  };

  /** 确认删除：落盘后关弹窗并展示撤回 */
  const confirmDeleteTodo = async (): Promise<void> => {
    if (!deleteConfirm) return;
    const { id, title } = deleteConfirm;
    setDeleteConfirm(null);
    setContextMenu(null);
    const next = await window.todoApi.deleteTodo(id);
    setSnapshot(next);
    showDeleteUndo(title);
  };

  /** 撤回最近一次删除 */
  const undoDeleteTodo = async (): Promise<void> => {
    dismissDeleteUndo();
    const next = await window.todoApi.undoLastDelete();
    setSnapshot(next);
  };

  /** 打开新右键菜单时重置面板与草稿 */
  useEffect(() => {
    setSubtaskDraft("");
    setContextPanel(null);
    setDueDaysDraft("");
    setWaitingReasonDraft("");
  }, [contextMenu?.id]);

  /** 切换右键面板；再次点击同一图标则收起 */
  const toggleContextPanel = (panel: Exclude<ContextPanel, null>): void => {
    setContextPanel((current) => (current === panel ? null : panel));
  };

  /** 右键菜单打开时：点外部 / Escape 关闭（不再监听 scroll，展开编辑会误触发并关掉菜单） */
  useEffect(() => {
    if (!contextMenu) return;

    const close = (): void => setContextMenu(null);

    const handleOutsidePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (contextMenuRef.current?.contains(target)) return;
      close();
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close();
    };

    // 下一帧再绑，避免打开菜单的那次右键/点击立刻关闭
    const timer = window.setTimeout(() => {
      window.addEventListener("pointerdown", handleOutsidePointerDown, true);
    }, 0);

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  /** 将浮层钳制在窗口内；仅在打开菜单时计算一次，避免编辑时重算导致按钮错位 */
  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;

    const el = contextMenuRef.current;
    const pad = 8;
    const { width, height } = el.getBoundingClientRect();
    const maxLeft = Math.max(pad, window.innerWidth - width - pad);
    const maxTop = Math.max(pad, window.innerHeight - height - pad);
    el.style.left = `${Math.min(Math.max(pad, contextMenu.x), maxLeft)}px`;
    el.style.top = `${Math.min(Math.max(pad, contextMenu.y), maxTop)}px`;
  }, [contextMenu]);

  /** 当前右键菜单对应的待办；删除后变为 null，菜单随之关闭 */
  const contextMenuTodo = contextMenu
    ? snapshot.activeTodos.find((todo) => todo.id === contextMenu.id) ?? null
    : null;

  /** 保存预计天数；空值表示不改动并收起面板。写入成功后关闭整菜单 */
  const commitDueDays = async (): Promise<void> => {
    if (!contextMenuTodo) return;
    const todoId = contextMenuTodo.id;
    const trimmed = dueDaysDraftRef.current.trim();
    if (!trimmed) {
      setContextPanel(null);
      setDueDaysDraft(contextMenuTodo.dueDays ? String(contextMenuTodo.dueDays) : "");
      return;
    }
    const days = Number(trimmed);
    if (!Number.isFinite(days)) {
      setDueDaysDraft(contextMenuTodo.dueDays ? String(contextMenuTodo.dueDays) : "");
      return;
    }
    const next = await window.todoApi.setTodoDueDays(todoId, days);
    setSnapshot(next);
    setContextMenu(null);
  };

  /** 进入等待或更新等待原因后关闭菜单 */
  const commitWaiting = async (): Promise<void> => {
    if (!contextMenuTodo) return;
    const reason = waitingReasonDraftRef.current.trim();
    const next = await window.todoApi.setTodoWaiting(contextMenuTodo.id, {
      reason: reason || null
    });
    setSnapshot(next);
    setContextMenu(null);
  };

  /** 等待中恢复为进行中 */
  const commitResume = async (): Promise<void> => {
    if (!contextMenuTodo) return;
    const next = await window.todoApi.resumeTodo(contextMenuTodo.id);
    setSnapshot(next);
    setContextMenu(null);
  };

  /** 今日进行中待办用过的标签，供顶部筛选条展示 */
  const availableTags = useMemo(() => {
    const tags = new Set<string>();
    for (const todo of snapshot.activeTodos) {
      for (const tag of todo.tags) tags.add(tag);
    }
    return [...tags];
  }, [snapshot.activeTodos]);

  /** 经标签筛选后的列表；无筛选时等于全部进行中待办 */
  const visibleTodos = useMemo(() => {
    if (!tagFilter) return snapshot.activeTodos;
    return snapshot.activeTodos.filter((todo) => todo.tags.includes(tagFilter));
  }, [snapshot.activeTodos, tagFilter]);

  /** 当前筛选标签已不存在时（例如最后一条带该标签的待办被删），自动回到「全部」 */
  useEffect(() => {
    if (tagFilter && !availableTags.includes(tagFilter)) {
      setTagFilter(null);
    }
  }, [availableTags, tagFilter]);

  const remainingLabel = useMemo(() => {
    if (snapshot.activeTodos.length === 0) return "今天没有待办";
    // 筛选中时显示该标签下的数量，避免与总数混淆
    if (tagFilter) return `「${tagFilter}」 ${visibleTodos.length} 件`;
    return `还有 ${snapshot.activeTodos.length} 件待办`;
  }, [snapshot.activeTodos.length, tagFilter, visibleTodos.length]);
  const unpinLabel = settings?.displayMode === "desktop" ? "取消置顶，回到桌面固定" : "取消置顶，回到普通窗口";

  /** 标题完整显示时走内联编辑 */
  const startInlineEdit = (todo: Todo): void => {
    setEditModal(null);
    setEditingId(todo.id);
    setEditingTitle(todo.title);
  };

  /**
   * 点击标题：若内联单行输入装不下完整标题则弹窗，否则内联编辑。
   * 列表仍可两行展示；这里单独按「单行宽度」判断编辑方式。
   */
  const handleTitleClick = (todo: Todo, event: React.MouseEvent<HTMLButtonElement>): void => {
    const el = event.currentTarget;
    const styles = window.getComputedStyle(el);
    const probe = document.createElement("span");
    probe.textContent = todo.title;
    probe.style.cssText = [
      "position:absolute",
      "visibility:hidden",
      "pointer-events:none",
      "white-space:nowrap",
      `font:${styles.font}`,
      `letter-spacing:${styles.letterSpacing}`,
      `padding-left:${styles.paddingLeft}`,
      `padding-right:${styles.paddingRight}`
    ].join(";");
    document.body.appendChild(probe);
    const needsModal = probe.offsetWidth > el.clientWidth + 1;
    probe.remove();

    if (needsModal) {
      setEditingId(null);
      setEditingTitle("");
      setContextMenu(null);
      setEditModal({ id: todo.id, title: todo.title });
      return;
    }
    startInlineEdit(todo);
  };

  const cancelEdit = (): void => {
    setEditingId(null);
    setEditingTitle("");
  };

  const closeEditModal = (): void => {
    setEditModal(null);
  };

  const saveEdit = async (): Promise<void> => {
    if (!editingId) return;

    const title = editingTitle.trim();
    if (!title) {
      cancelEdit();
      return;
    }

    const next = await window.todoApi.updateTodo(editingId, { title });
    setSnapshot(next);
    cancelEdit();
  };

  /** 弹窗内保存标题；空标题视为取消 */
  const saveEditModal = async (): Promise<void> => {
    if (!editModal) return;

    const title = editModal.title.trim();
    if (!title) {
      closeEditModal();
      return;
    }

    const next = await window.todoApi.updateTodo(editModal.id, { title });
    setSnapshot(next);
    closeEditModal();
  };

  const handleEditBlur = (): void => {
    if (skipBlurSaveRef.current) {
      skipBlurSaveRef.current = false;
      return;
    }
    void saveEdit();
  };

  /** 弹窗打开时聚焦并选中全文；Escape 关闭 */
  useEffect(() => {
    if (!editModal) return;

    const timer = window.setTimeout(() => {
      editModalTextareaRef.current?.focus();
      editModalTextareaRef.current?.select();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeEditModal();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [editModal?.id]);

  /** 删除确认弹窗：Escape 取消 */
  useEffect(() => {
    if (!deleteConfirm) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        setDeleteConfirm(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteConfirm?.id]);

  /** 弹窗对应待办被删掉时自动关闭，避免对着幽灵数据编辑 */
  useEffect(() => {
    if (!editModal) return;
    const stillExists = snapshot.activeTodos.some((todo) => todo.id === editModal.id);
    if (!stillExists) closeEditModal();
  }, [editModal, snapshot.activeTodos]);

  const handleWidgetMouseDown = (event: React.MouseEvent<HTMLElement>): void => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    if (target.closest(".no-drag, button, input, select, textarea")) {
      return;
    }

    void window.todoApi.prepareWidgetDrag();
  };

  const wakeWidget = (): void => {
    void window.todoApi.wakeWidget();
  };

  const openCalendar = (): void => {
    wakeWidget();
    window.setTimeout(() => void window.todoApi.openCalendar(), 0);
  };

  const openSettings = (): void => {
    wakeWidget();
    window.setTimeout(() => void window.todoApi.openSettings(), 0);
  };

  return (
    <main className="widget-shell">
      <section className="widget-card" onMouseEnter={wakeWidget} onMouseDown={handleWidgetMouseDown}>
        <header className="widget-header">
          <div>
            <p className="eyebrow">{formatDate(snapshot.today)}</p>
            <h1>桌面代办</h1>
          </div>
          <div className="header-actions no-drag">
            <button
              className={`icon-button${isFloatingOnPage ? " active" : ""}`}
              type="button"
              title={isFloatingOnPage ? unpinLabel : "始终悬浮在任何页面上"}
              aria-label={isFloatingOnPage ? unpinLabel : "始终悬浮在任何页面上"}
              aria-pressed={isFloatingOnPage}
              onClick={() => {
                void window.todoApi.toggleFloatOnPage().then(setIsFloatingOnPage);
              }}
            >
              <Icon name="pin" />
            </button>
            <button
              className="icon-button"
              type="button"
              title="最小化"
              aria-label="最小化"
              onClick={() => window.todoApi.minimizeWidget()}
            >
              <Icon name="minimize" />
            </button>
            <button className="icon-button danger-button" type="button" title="退出应用" aria-label="退出应用" onClick={() => window.todoApi.quitApp()}>
              <Icon name="quit" />
            </button>
          </div>
        </header>

        <div className="summary-row no-drag">
          <span>{remainingLabel}</span>
          {/* 打开独立添加窗；当前有标签筛选时新建待办自动带上该标签 */}
          <button
            type="button"
            onClick={() =>
              window.todoApi.openAddTodo(tagFilter ? { tags: [tagFilter] } : undefined)
            }
          >
            添加
          </button>
        </div>

        {/* 仅当存在带标签的待办时显示筛选条 */}
        {availableTags.length > 0 ? (
          <div className="tag-filter no-drag" aria-label="按标签筛选">
            <button
              type="button"
              className={`tag-filter-chip${tagFilter === null ? " active" : ""}`}
              onClick={() => setTagFilter(null)}
            >
              全部
            </button>
            {availableTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className={`tag-filter-chip${tagFilter === tag ? " active" : ""}`}
                onClick={() => setTagFilter(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        ) : null}

        <section className="todo-list no-drag" aria-label="今日待办">
          {snapshot.activeTodos.length === 0 ? (
            <div className="empty-state">
              <strong>今天清空了</strong>
              <span>全局快捷键 {formatShortcut(settings?.shortcut)} 可以随时添加。</span>
            </div>
          ) : visibleTodos.length === 0 ? (
            <div className="empty-state">
              <strong>没有匹配的待办</strong>
              <span>换个标签，或点「全部」查看今天所有事项。</span>
            </div>
          ) : (
            visibleTodos.map((todo) => (
              <article
                className={`todo-item${todo.status === "waiting" ? " waiting" : ""}`}
                key={todo.id}
                onContextMenu={(event) => {
                  // 阻止系统菜单；标签编辑与添加时间都放在自定义右键菜单里
                  event.preventDefault();
                  setContextMenu({
                    id: todo.id,
                    x: event.clientX,
                    y: event.clientY
                  });
                }}
              >
                <div className="todo-item-main">
                  <button
                    className="check-button"
                    type="button"
                    aria-label={`完成 ${todo.title}`}
                    onClick={() => window.todoApi.completeTodo(todo.id)}
                  />
                  <TodoRating
                    rating={todo.rating}
                    onChange={(rating) => {
                      void window.todoApi.setTodoRating(todo.id, rating).then(setSnapshot);
                    }}
                  />
                  <div className="todo-item-body">
                    {editingId === todo.id ? (
                      <input
                        className="todo-title-input"
                        value={editingTitle}
                        onChange={(event) => setEditingTitle(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void saveEdit();
                          }
                          if (event.key === "Escape") {
                            skipBlurSaveRef.current = true;
                            cancelEdit();
                          }
                        }}
                        onBlur={handleEditBlur}
                        aria-label="编辑待办标题"
                        autoFocus
                      />
                    ) : (
                      <button
                        type="button"
                        className="todo-title-button"
                        title={todo.title}
                        onClick={(event) => handleTitleClick(todo, event)}
                      >
                        {todo.title}
                      </button>
                    )}
                    {/* 等待中：展示已等待天数与可选原因 */}
                    {todo.status === "waiting" ? (
                      <div className="todo-waiting-meta">
                        <span className="todo-waiting-badge">
                          {formatWaitingDays(todo.waitingSince, snapshot.today)}
                        </span>
                        {todo.waitingReason ? (
                          <span className="todo-waiting-reason" title={todo.waitingReason}>
                            {todo.waitingReason}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    {/* 已按标签筛选时不再重复展示标签 chips，避免拥挤 */}
                    {tagFilter ? null : <TodoTagChips tags={todo.tags} />}
                  </div>
                  {editingId !== todo.id ? (
                    <button
                      className="icon-button danger-button todo-delete-button"
                      type="button"
                      aria-label={`删除 ${todo.title}`}
                      onClick={() => {
                        setContextMenu(null);
                        setEditModal(null);
                        setDeleteConfirm({ id: todo.id, title: todo.title });
                      }}
                    >
                      <Trash2 aria-hidden className="button-icon" strokeWidth={2} />
                    </button>
                  ) : null}
                </div>
                <TodoSubtasks
                  subtasks={todo.subtasks}
                  onToggle={(subtaskId) => {
                    void window.todoApi.toggleTodoSubtask(todo.id, subtaskId).then(setSnapshot);
                  }}
                  onUpdate={(subtaskId, title) => {
                    void window.todoApi.updateTodoSubtask(todo.id, subtaskId, title).then(setSnapshot);
                  }}
                  onDelete={(subtaskId) => {
                    void window.todoApi.deleteTodoSubtask(todo.id, subtaskId).then(setSnapshot);
                  }}
                />
              </article>
            ))
          )}
        </section>

        <section className="completed-panel no-drag">
          <div className="section-title">
            <span>今天完成</span>
            <strong>{snapshot.completedToday.length}</strong>
          </div>
          {snapshot.completedToday.slice(0, 3).map((todo) => (
            <button className="completed-item" type="button" key={todo.id} onClick={() => window.todoApi.reopenTodo(todo.id)}>
              {todo.title}
            </button>
          ))}
        </section>

        <footer className="widget-footer no-drag">
          <div className="footer-actions">
            <button
              className="icon-button"
              type="button"
              title="完成日历"
              aria-label="完成日历"
              onMouseDown={wakeWidget}
              onClick={openCalendar}
            >
              <Icon name="calendar" />
            </button>
            <button
              className="icon-button"
              type="button"
              title="设置"
              aria-label="设置"
              onMouseDown={wakeWidget}
              onClick={openSettings}
            >
              <Icon name="settings" />
            </button>
          </div>
          <span>
            {desktopAttached === false
              ? "桌面固定暂未生效，当前以普通窗口显示"
              : `${formatShortcut(settings?.shortcut)} 呼出添加，托盘图标可显示组件`}
          </span>
        </footer>

        {/* 长标题截断时的编辑弹窗；放在 card 内并 no-drag，避免拖拽区吞交互 */}
        {editModal ? (
          <div
            className="todo-edit-modal-backdrop no-drag"
            role="presentation"
            onMouseDown={(event) => {
              // 仅点遮罩关闭，点对话框本身不关
              if (event.target === event.currentTarget) closeEditModal();
            }}
          >
            <div className="todo-edit-modal" role="dialog" aria-modal="true" aria-label="编辑待办">
              <header className="todo-edit-modal-header">
                <h2>编辑待办</h2>
                <button
                  className="icon-button"
                  type="button"
                  title="关闭"
                  aria-label="关闭"
                  onClick={closeEditModal}
                >
                  <Icon name="quit" />
                </button>
              </header>
              <textarea
                ref={editModalTextareaRef}
                className="todo-edit-modal-textarea"
                value={editModal.title}
                onChange={(event) => setEditModal({ ...editModal, title: event.target.value })}
                onKeyDown={(event) => {
                  // Ctrl/Cmd+Enter 保存；单独 Enter 允许换行草稿（标题本身会 trim）
                  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    void saveEditModal();
                  }
                }}
                aria-label="待办标题"
                rows={4}
              />
              <div className="todo-edit-modal-actions">
                <button type="button" className="todo-edit-modal-cancel" onClick={closeEditModal}>
                  取消
                </button>
                <button type="button" className="todo-edit-modal-save" onClick={() => void saveEditModal()}>
                  保存
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* 删除确认：与编辑弹窗同结构，危险操作用红色主按钮 */}
        {deleteConfirm ? (
          <div
            className="todo-edit-modal-backdrop no-drag"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setDeleteConfirm(null);
            }}
          >
            <div className="todo-edit-modal" role="dialog" aria-modal="true" aria-label="确认删除">
              <header className="todo-edit-modal-header">
                <h2>删除待办？</h2>
                <button
                  className="icon-button"
                  type="button"
                  title="关闭"
                  aria-label="关闭"
                  onClick={() => setDeleteConfirm(null)}
                >
                  <Icon name="quit" />
                </button>
              </header>
              <p className="todo-delete-confirm-text">
                确定删除「{deleteConfirm.title}」？删除后可在短时间内撤回。
              </p>
              <div className="todo-edit-modal-actions">
                <button type="button" className="todo-edit-modal-cancel" onClick={() => setDeleteConfirm(null)}>
                  取消
                </button>
                <button
                  type="button"
                  className="todo-edit-modal-danger"
                  onClick={() => void confirmDeleteTodo()}
                >
                  删除
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* 删除成功后的撤回条；超时或点关闭后消失 */}
        {deleteUndo ? (
          <div className="todo-delete-undo no-drag" role="status">
            <span className="todo-delete-undo-text">已删除「{deleteUndo.title}」</span>
            <button type="button" className="todo-delete-undo-action" onClick={() => void undoDeleteTodo()}>
              撤回
            </button>
            <button
              type="button"
              className="icon-button todo-delete-undo-close"
              title="关闭"
              aria-label="关闭撤回提示"
              onClick={dismissDeleteUndo}
            >
              <Icon name="quit" />
            </button>
          </div>
        ) : null}

        {/* 放在 widget-card 内并标记 no-drag，避免透明窗拖拽区吞点击 */}
        {contextMenu && contextMenuTodo ? (
          <div
            className="todo-context-menu no-drag"
            ref={contextMenuRef}
            role="dialog"
            aria-label="待办菜单"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="todo-context-meta">
              <strong>{formatCreatedAt(contextMenuTodo.createdAt)}</strong>
              <div className="todo-context-days-row">
                <span className="todo-info-days">{formatDaysAgo(contextMenuTodo.createdAt)}</span>
                {contextPanel !== "due" && contextMenuTodo.dueDays ? (
                  <span className="todo-due-days-label">预计 {contextMenuTodo.dueDays} 天</span>
                ) : null}
              </div>
            </div>

            {/* 图标工具条：点开对应面板，再次点击收起 */}
            <div className="todo-context-actions">
              <button
                type="button"
                className={`todo-context-icon-button${contextMenuTodo.dueDays ? " has-value" : ""}${contextPanel === "due" ? " open" : ""}`}
                title="预计完成天数"
                aria-label="预计完成天数"
                aria-expanded={contextPanel === "due"}
                onClick={() => {
                  setDueDaysDraft(contextMenuTodo.dueDays ? String(contextMenuTodo.dueDays) : "1");
                  toggleContextPanel("due");
                }}
              >
                <CalendarClock aria-hidden strokeWidth={2} />
              </button>
              <button
                type="button"
                className={`todo-context-icon-button${contextMenuTodo.tags.length > 0 ? " has-value" : ""}${contextPanel === "tags" ? " open" : ""}`}
                title="标签"
                aria-label="标签"
                aria-expanded={contextPanel === "tags"}
                onClick={() => toggleContextPanel("tags")}
              >
                <Tag aria-hidden strokeWidth={2} />
              </button>
              <button
                type="button"
                className={`todo-context-icon-button${contextMenuTodo.subtasks.length > 0 ? " has-value" : ""}${contextPanel === "subtasks" ? " open" : ""}`}
                title="子任务"
                aria-label="子任务"
                aria-expanded={contextPanel === "subtasks"}
                onClick={() => toggleContextPanel("subtasks")}
              >
                <ListTodo aria-hidden strokeWidth={2} />
              </button>
              <button
                type="button"
                className={`todo-context-icon-button${contextMenuTodo.status === "waiting" ? " has-value" : ""}${contextPanel === "waiting" ? " open" : ""}`}
                title="等待中"
                aria-label="等待中"
                aria-expanded={contextPanel === "waiting"}
                onClick={() => {
                  setWaitingReasonDraft(contextMenuTodo.waitingReason ?? "");
                  toggleContextPanel("waiting");
                }}
              >
                <Hourglass aria-hidden strokeWidth={2} />
              </button>
            </div>

            {contextPanel === "due" ? (
              <form
                className="todo-due-days-editor"
                onSubmit={(event) => {
                  event.preventDefault();
                  void commitDueDays();
                }}
              >
                <span>预计</span>
                <input
                  className="todo-due-days-input"
                  type="number"
                  min={DUE_DAYS_MIN}
                  max={DUE_DAYS_MAX}
                  inputMode="numeric"
                  value={dueDaysDraft}
                  placeholder="天"
                  aria-label="预计几天完成"
                  autoFocus
                  onChange={(event) => setDueDaysDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setContextPanel(null);
                    }
                  }}
                />
                <span>天</span>
                <button type="submit" className="todo-due-confirm">
                  确定
                </button>
                {contextMenuTodo.dueDays ? (
                  <button
                    type="button"
                    className="todo-due-clear"
                    onClick={() => {
                      // 清除已写入，关闭整菜单
                      void window.todoApi.setTodoDueDays(contextMenuTodo.id, null).then((next) => {
                        setSnapshot(next);
                        setContextMenu(null);
                      });
                    }}
                  >
                    清除
                  </button>
                ) : null}
              </form>
            ) : null}

            {contextPanel === "tags" ? (
              <TodoTagEditor
                tags={contextMenuTodo.tags}
                onChange={(tags) => {
                  // 写入成功后关闭整菜单
                  void window.todoApi.setTodoTags(contextMenuTodo.id, tags).then((next) => {
                    setSnapshot(next);
                    setContextMenu(null);
                  });
                }}
              />
            ) : null}

            {contextPanel === "subtasks" ? (
              <form
                className="todo-context-subtask"
                onSubmit={(event) => {
                  event.preventDefault();
                  const title = subtaskDraft.trim();
                  if (!title) return;
                  // 添加成功即关闭整菜单，避免操作完仍留着外壳
                  void window.todoApi.addTodoSubtask(contextMenuTodo.id, title).then((next) => {
                    setSnapshot(next);
                    setContextMenu(null);
                  });
                }}
              >
                <div className="todo-tags-custom">
                  <input
                    value={subtaskDraft}
                    onChange={(event) => setSubtaskDraft(event.target.value)}
                    placeholder="添加子任务…"
                    aria-label="添加子任务"
                    maxLength={80}
                    autoFocus
                  />
                  <button type="submit">添加</button>
                </div>
              </form>
            ) : null}

            {contextPanel === "waiting" ? (
              <form
                className="todo-waiting-editor"
                onSubmit={(event) => {
                  event.preventDefault();
                  void commitWaiting();
                }}
              >
                {contextMenuTodo.status === "waiting" ? (
                  <span className="todo-waiting-editor-days">
                    {formatWaitingDays(contextMenuTodo.waitingSince, snapshot.today)}
                  </span>
                ) : (
                  <span className="todo-waiting-editor-hint">标记为等待中（可选填原因）</span>
                )}
                <input
                  className="todo-waiting-reason-input"
                  value={waitingReasonDraft}
                  onChange={(event) => setWaitingReasonDraft(event.target.value)}
                  placeholder="等待原因…"
                  aria-label="等待原因"
                  maxLength={WAITING_REASON_MAX_LEN}
                  autoFocus
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setContextPanel(null);
                    }
                  }}
                />
                <div className="todo-waiting-editor-actions">
                  <button type="submit" className="todo-due-confirm">
                    {contextMenuTodo.status === "waiting" ? "更新" : "开始等待"}
                  </button>
                  {contextMenuTodo.status === "waiting" ? (
                    <button type="button" className="todo-due-clear" onClick={() => void commitResume()}>
                      继续进行
                    </button>
                  ) : null}
                </div>
              </form>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}
