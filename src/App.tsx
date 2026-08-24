/**
 * 桌面挂件主界面（?view=widget）。
 *
 * 功能：今日待办列表、独立窗口编辑标题、完成/删除（确认 + 撤回）、紧急评分、
 * 标签与步骤、等待中、右键菜单（预计天数/标签/步骤/等待）、置顶切换、完成区预览、
 * 打开日历/设置/添加窗口（全局快捷键仍可唤起同一添加窗）。
 * 标签筛选写入 settings.tagFilter，重启/开机自启后恢复上次选中的标签页。
 * 数据通过 window.todoApi 与主进程同步，并订阅 IPC 推送保持多窗口一致。
 */
import { Calendar, Minus, Pin, Settings, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import TodoContextMenu from "./TodoContextMenu";
import TodoRating from "./TodoRating";
import TodoSubtasks from "./TodoSubtasks";
import { TodoTagChips } from "./TodoTags";
import { DEFAULT_QUICK_ADD_SHORTCUT, DEFAULT_SHOW_WIDGET_SHORTCUT, formatShortcut } from "./data/shortcut";
import { formatDate, formatWaitingDays } from "./todoFormat";
import type { AppSettings, Todo, TodoSnapshot } from "./types/todo";
import { useWidgetContentScale } from "./useWidgetContentScale";
import { WidgetResizeHandles } from "./useWidgetResize";

/** IPC 加载前的占位快照，避免首屏 undefined */
const emptySnapshot: TodoSnapshot = {
  today: "",
  activeTodos: [],
  completedToday: []
};

/** 右键菜单定位；待办内容从 snapshot 按 id 实时取，避免编辑后菜单不同步 */
type TodoContextMenuPos = {
  id: string;
  x: number;
  y: number;
};

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
  const [contextMenu, setContextMenu] = useState<TodoContextMenuPos | null>(null);
  /** null=全部；否则按标签筛选今日待办；与 settings.tagFilter 同步持久化 */
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  /** 窗口小于默认尺寸时收内容，避免标题/按钮把列表挤没 */
  const cardRef = useRef<HTMLElement>(null);
  useWidgetContentScale(cardRef);
  /** 避免启动竞态：快照未到时不要因 availableTags 为空而清掉已恢复的筛选 */
  const tagFilterHydratedRef = useRef(false);

  /** 写入标签筛选并同步本地状态（重启/自启后由此恢复） */
  const persistTagFilter = useCallback((next: string | null): void => {
    setTagFilter(next);
    void window.todoApi.setTagFilter(next).then(setSettings);
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

  /** 挂载时拉取初始数据，并订阅主进程推送；unmount 时取消全部监听 */
  useEffect(() => {
    void window.todoApi.getSnapshot().then((next) => {
      setSnapshot(next);
      if (next.pendingUndoTitle) {
        showDeleteUndo(next.pendingUndoTitle);
      }
    });
    void window.todoApi.getSettings().then((next) => {
      setSettings(next);
      setTagFilter(next.tagFilter ?? null);
      tagFilterHydratedRef.current = true;
    });
    void window.todoApi.getFloatOnPage().then(setIsFloatingOnPage);

    const offTodos = window.todoApi.onTodosChanged(setSnapshot);
    const offDesktop = window.todoApi.onDesktopAttachResult(setDesktopAttached);
    const offSettings = window.todoApi.onSettingsChanged((next) => {
      setSettings(next);
      // 仅在已完成首次水合后跟随设置，避免覆盖本地尚未写入的点击
      if (tagFilterHydratedRef.current) {
        setTagFilter(next.tagFilter ?? null);
      }
    });
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

  /** 当前右键菜单对应的待办；删除后变为 null，菜单随之关闭 */
  const contextMenuTodo = contextMenu
    ? snapshot.activeTodos.find((todo) => todo.id === contextMenu.id) ?? null
    : null;

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

  /**
   * 当前筛选标签已失效时回到「全部」并落盘。
   * 快照未加载（today 为空）时不清理，避免启动瞬间冲掉记忆的标签页。
   */
  useEffect(() => {
    if (!snapshot.today || !tagFilterHydratedRef.current || !tagFilter) return;
    if (availableTags.includes(tagFilter)) return;
    // 仍有可选标签或今日仍有待办时，说明选中标签确实消失了
    if (availableTags.length > 0 || snapshot.activeTodos.length > 0) {
      persistTagFilter(null);
    }
  }, [availableTags, tagFilter, snapshot.today, snapshot.activeTodos.length, persistTagFilter]);

  const remainingLabel = useMemo(() => {
    if (snapshot.activeTodos.length === 0) return "今天没有待办";
    // 筛选中时显示该标签下的数量，避免与总数混淆
    if (tagFilter) return `「${tagFilter}」 ${visibleTodos.length} 件`;
    return `还有 ${snapshot.activeTodos.length} 件待办`;
  }, [snapshot.activeTodos.length, tagFilter, visibleTodos.length]);
  const unpinLabel =
    settings?.displayMode === "desktop" || settings?.displayMode === "system"
      ? "取消置顶，回到桌面固定"
      : "取消置顶，回到普通窗口";
  const showWidgetShortcutLabel = formatShortcut(settings?.showWidgetShortcut ?? DEFAULT_SHOW_WIDGET_SHORTCUT);
  /** 按壁纸软件 / 系统壁纸两种桌面固定给出提示 */
  const footerHint = (() => {
    if (desktopAttached === false) {
      if (settings?.displayMode === "desktop") {
        return "壁纸软件桌面固定暂未生效，当前以普通窗口显示；可改试「系统壁纸」模式";
      }
      if (settings?.displayMode === "system") {
        return "系统壁纸桌面固定暂未生效，当前以普通窗口显示；若在用动态壁纸可改试「壁纸软件」模式";
      }
    }
    if (settings?.displayMode === "desktop") {
      return `壁纸软件桌面固定；无法点击时用 ${showWidgetShortcutLabel} 唤出`;
    }
    if (settings?.displayMode === "system") {
      return `系统壁纸桌面固定；无法点击时用 ${showWidgetShortcutLabel} 唤出`;
    }
    return `${formatShortcut(settings?.shortcut ?? DEFAULT_QUICK_ADD_SHORTCUT)} 快捷添加，托盘图标可显示组件`;
  })();

  /** 点击标题：在独立窗口编辑，避免占挂件内部空间 */
  const openEditTodo = (todo: Todo): void => {
    setContextMenu(null);
    void window.todoApi.openEditTodo(todo.id);
  };

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
      <section
        ref={cardRef}
        className="widget-card"
        onMouseEnter={wakeWidget}
        onMouseDown={handleWidgetMouseDown}
      >
        {/* 透明窗没有系统缩放边，用卡片边缘热区改尺寸 */}
        <WidgetResizeHandles />
        <div className="widget-card-body">
        <header className="widget-header">
          <div className="widget-title-block">
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
              onClick={() => persistTagFilter(null)}
            >
              全部
            </button>
            {availableTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className={`tag-filter-chip${tagFilter === tag ? " active" : ""}`}
                onClick={() => persistTagFilter(tag)}
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
              <span>全局快捷键 {formatShortcut(settings?.shortcut, DEFAULT_QUICK_ADD_SHORTCUT)} 可以随时添加。</span>
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
                    <button
                      type="button"
                      className="todo-title-button"
                      title={todo.title}
                      onClick={() => openEditTodo(todo)}
                    >
                      {todo.title}
                    </button>
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
                  <button
                    className="icon-button danger-button todo-delete-button"
                    type="button"
                    aria-label={`删除 ${todo.title}`}
                    onClick={() => {
                      setContextMenu(null);
                      setDeleteConfirm({ id: todo.id, title: todo.title });
                    }}
                  >
                    <Trash2 aria-hidden className="button-icon" strokeWidth={2} />
                  </button>
                </div>
                <TodoSubtasks
                  subtasks={todo.subtasks}
                  today={snapshot.today}
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
          <span>{footerHint}</span>
        </footer>
        </div>

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
          <TodoContextMenu
            todo={contextMenuTodo}
            today={snapshot.today}
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            onSnapshot={setSnapshot}
          />
        ) : null}
      </section>
    </main>
  );
}
