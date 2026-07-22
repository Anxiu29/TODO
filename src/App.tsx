/**
 * 桌面挂件主界面（?view=widget）。
 *
 * 功能：今日待办列表、内联添加/编辑/完成/删除、紧急评分、
 * 右键查看添加时间与已过天数、置顶切换、完成区预览、
 * 打开日历/设置/快捷添加窗口。
 * 数据通过 window.todoApi 与主进程同步，并订阅 IPC 推送保持多窗口一致。
 */
import { Calendar, Minus, Pin, Settings, Trash2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import TodoRating from "./TodoRating";
import type { AppSettings, Todo, TodoSnapshot } from "./types/todo";

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

type TodoInfoMenu = {
  id: string;
  x: number;
  y: number;
  createdAt: string;
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
  const [newTitle, setNewTitle] = useState("");
  /** 当前正在内联编辑的待办 id */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  /** Escape 取消编辑时会触发 blur，此 ref 阻止 blur 误保存 */
  const skipBlurSaveRef = useRef(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  /** null=未知，true/false=最近一次桌面附着结果 */
  const [desktopAttached, setDesktopAttached] = useState<boolean | null>(null);
  /** 是否处于「始终置顶」模式，与主进程 pinnedFloat 同步 */
  const [isFloatingOnPage, setIsFloatingOnPage] = useState(false);
  /** 右键查看添加时间的浮层；坐标为视口 clientX/Y */
  const [infoMenu, setInfoMenu] = useState<TodoInfoMenu | null>(null);
  const infoMenuRef = useRef<HTMLDivElement>(null);

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
    };
  }, []);

  /** 右键信息浮层打开时：点外部 / Escape / 滚动关闭 */
  useEffect(() => {
    if (!infoMenu) return;

    const close = (): void => setInfoMenu(null);

    const handlePointerDown = (event: PointerEvent): void => {
      if (!infoMenuRef.current?.contains(event.target as Node)) {
        close();
      }
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close();
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", close, true);
    };
  }, [infoMenu]);

  /** 将浮层钳制在窗口内，避免贴边时显示不全 */
  useLayoutEffect(() => {
    if (!infoMenu || !infoMenuRef.current) return;

    const el = infoMenuRef.current;
    const pad = 8;
    const { width, height } = el.getBoundingClientRect();
    const maxLeft = Math.max(pad, window.innerWidth - width - pad);
    const maxTop = Math.max(pad, window.innerHeight - height - pad);
    el.style.left = `${Math.min(Math.max(pad, infoMenu.x), maxLeft)}px`;
    el.style.top = `${Math.min(Math.max(pad, infoMenu.y), maxTop)}px`;
  }, [infoMenu]);

  const remainingLabel = useMemo(() => {
    if (snapshot.activeTodos.length === 0) return "今天没有待办";
    return `还有 ${snapshot.activeTodos.length} 件待办`;
  }, [snapshot.activeTodos.length]);
  const unpinLabel = settings?.displayMode === "desktop" ? "取消置顶，回到桌面固定" : "取消置顶，回到普通窗口";

  const addTodo = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const title = newTitle.trim();
    if (!title) return;

    const next = await window.todoApi.addTodo({ title });
    setSnapshot(next);
    setNewTitle("");
  };

  const startEdit = (todo: Todo): void => {
    setEditingId(todo.id);
    setEditingTitle(todo.title);
  };

  const cancelEdit = (): void => {
    setEditingId(null);
    setEditingTitle("");
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

  const handleEditBlur = (): void => {
    if (skipBlurSaveRef.current) {
      skipBlurSaveRef.current = false;
      return;
    }
    void saveEdit();
  };

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

        <form className="quick-form no-drag" onSubmit={addTodo}>
          <input
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            placeholder="添加今天的待办..."
            aria-label="添加今天的待办"
          />
          <button type="submit">添加</button>
        </form>

        <div className="summary-row no-drag">
          <span>{remainingLabel}</span>
          <button type="button" onClick={() => window.todoApi.openAddTodo()}>
            快捷添加
          </button>
        </div>

        <section className="todo-list no-drag" aria-label="今日待办">
          {snapshot.activeTodos.length === 0 ? (
            <div className="empty-state">
              <strong>今天清空了</strong>
              <span>全局快捷键 {formatShortcut(settings?.shortcut)} 可以随时添加。</span>
            </div>
          ) : (
            snapshot.activeTodos.map((todo) => (
              <article
                className="todo-item"
                key={todo.id}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setInfoMenu({
                    id: todo.id,
                    x: event.clientX,
                    y: event.clientY,
                    createdAt: todo.createdAt
                  });
                }}
              >
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
                  <button type="button" className="todo-title-button" onClick={() => startEdit(todo)}>
                    {todo.title}
                  </button>
                )}
                {editingId !== todo.id ? (
                  <button
                    className="icon-button danger-button todo-delete-button"
                    type="button"
                    aria-label={`删除 ${todo.title}`}
                    onClick={() => window.todoApi.deleteTodo(todo.id)}
                  >
                    <Trash2 aria-hidden className="button-icon" strokeWidth={2} />
                  </button>
                ) : null}
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
      </section>
      {infoMenu ? (
        <div
          className="todo-info-menu"
          ref={infoMenuRef}
          role="dialog"
          aria-label="待办添加时间"
          style={{ left: infoMenu.x, top: infoMenu.y }}
        >
          <strong>{formatCreatedAt(infoMenu.createdAt)}</strong>
          <span className="todo-info-days">{formatDaysAgo(infoMenu.createdAt)}</span>
        </div>
      ) : null}
    </main>
  );
}
