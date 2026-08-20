/**
 * 挂件待办右键菜单：预计天数 / 标签 / 步骤 / 等待历史。
 * 面板状态与草稿留在本组件，避免撑大 App.tsx。
 */
import { CalendarClock, Hourglass, ListTodo, Tag } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type React from "react";
import { formatCreatedAt, formatDaysAgo, formatWaitDate, formatWaitingDays, formatWaitSpan } from "./todoFormat";
import { TodoTagEditor } from "./TodoTags";
import type { Todo, TodoSnapshot } from "./types/todo";
import { DUE_DAYS_MAX, DUE_DAYS_MIN, WAITING_REASON_MAX_LEN } from "./types/todo";

/** 右键菜单当前展开的面板；同时只开一个 */
type ContextPanel = "due" | "tags" | "subtasks" | "waiting" | null;

/** 展示用等待行：历史段 + 当前进行中段（最新在上） */
type WaitingViewItem = {
  key: string;
  startedAt: string;
  endedAt?: string;
  reason?: string;
  ongoing: boolean;
};

/** 合并 waitHistory 与当前等待段，供面板时间线展示 */
const buildWaitingViewItems = (todo: Todo, today: string): WaitingViewItem[] => {
  const items: WaitingViewItem[] = (todo.waitHistory ?? []).map((record, index) => ({
    key: `h-${index}-${record.startedAt}-${record.endedAt}`,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    reason: record.reason,
    ongoing: false
  }));
  if (todo.status === "waiting" && todo.waitingSince) {
    items.push({
      key: `current-${todo.waitingSince}`,
      startedAt: todo.waitingSince,
      reason: todo.waitingReason,
      ongoing: true
    });
  }
  return items.reverse();
};

const formatWaitingViewItem = (item: WaitingViewItem, today: string): string => {
  const range = item.ongoing
    ? `${formatWaitDate(item.startedAt)} 起`
    : `${formatWaitDate(item.startedAt)} – ${formatWaitDate(item.endedAt ?? item.startedAt)}`;
  const span = item.ongoing
    ? formatWaitingDays(item.startedAt, today)
    : formatWaitSpan(item.startedAt, item.endedAt ?? item.startedAt);
  const reason = item.reason?.trim();
  return reason ? `${range} · ${span} · ${reason}` : `${range} · ${span}`;
};

type TodoContextMenuProps = {
  todo: Todo;
  today: string;
  x: number;
  y: number;
  onClose: () => void;
  onSnapshot: (snapshot: TodoSnapshot) => void;
};

/** 挂件内右键浮层；写入成功后关闭，坐标在打开时钳制到窗口内 */
export default function TodoContextMenu({
  todo,
  today,
  x,
  y,
  onClose,
  onSnapshot
}: TodoContextMenuProps): React.ReactElement {
  const menuRef = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = useState<ContextPanel>(null);
  const [subtaskDraft, setSubtaskDraft] = useState("");
  const [dueDaysDraft, setDueDaysDraft] = useState("");
  const dueDaysDraftRef = useRef("");
  dueDaysDraftRef.current = dueDaysDraft;
  const [waitingReasonDraft, setWaitingReasonDraft] = useState("");
  const waitingReasonDraftRef = useRef("");
  waitingReasonDraftRef.current = waitingReasonDraft;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onSnapshotRef = useRef(onSnapshot);
  onSnapshotRef.current = onSnapshot;

  /** 换一条待办时重置面板与草稿，避免把上一件的输入带过去 */
  useEffect(() => {
    setSubtaskDraft("");
    setPanel(null);
    setDueDaysDraft("");
    setWaitingReasonDraft("");
  }, [todo.id]);

  useEffect(() => {
    const handleOutsidePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target)) return;
      onCloseRef.current();
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onCloseRef.current();
    };

    const timer = window.setTimeout(() => {
      window.addEventListener("pointerdown", handleOutsidePointerDown, true);
    }, 0);

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [todo.id]);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const pad = 8;
    const { width, height } = el.getBoundingClientRect();
    const maxLeft = Math.max(pad, window.innerWidth - width - pad);
    const maxTop = Math.max(pad, window.innerHeight - height - pad);
    el.style.left = `${Math.min(Math.max(pad, x), maxLeft)}px`;
    el.style.top = `${Math.min(Math.max(pad, y), maxTop)}px`;
  }, [todo.id, x, y]);

  const waitingViewItems = buildWaitingViewItems(todo, today);

  const togglePanel = (next: Exclude<ContextPanel, null>): void => {
    setPanel((current) => (current === next ? null : next));
  };

  const commitDueDays = async (): Promise<void> => {
    const trimmed = dueDaysDraftRef.current.trim();
    if (!trimmed) {
      setPanel(null);
      setDueDaysDraft(todo.dueDays ? String(todo.dueDays) : "");
      return;
    }
    const days = Number(trimmed);
    if (!Number.isFinite(days)) {
      setDueDaysDraft(todo.dueDays ? String(todo.dueDays) : "");
      return;
    }
    const next = await window.todoApi.setTodoDueDays(todo.id, days);
    onSnapshotRef.current(next);
    onCloseRef.current();
  };

  const commitWaiting = async (): Promise<void> => {
    const reason = waitingReasonDraftRef.current.trim();
    const next = await window.todoApi.setTodoWaiting(todo.id, {
      reason: reason || null
    });
    onSnapshotRef.current(next);
    onCloseRef.current();
  };

  const commitResume = async (): Promise<void> => {
    const next = await window.todoApi.resumeTodo(todo.id);
    onSnapshotRef.current(next);
    onCloseRef.current();
  };

  return (
    <div
      className="todo-context-menu no-drag"
      ref={menuRef}
      role="dialog"
      aria-label="待办菜单"
      style={{ left: x, top: y }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="todo-context-meta">
        <strong>{formatCreatedAt(todo.createdAt)}</strong>
        <div className="todo-context-days-row">
          <span className="todo-info-days">{formatDaysAgo(todo.createdAt, today)}</span>
          {panel !== "due" && todo.dueDays ? (
            <span className="todo-due-days-label">预计 {todo.dueDays} 天</span>
          ) : null}
        </div>
      </div>

      <div className="todo-context-actions">
        <button
          type="button"
          className={`todo-context-icon-button${todo.dueDays ? " has-value" : ""}${panel === "due" ? " open" : ""}`}
          title="预计完成天数"
          aria-label="预计完成天数"
          aria-expanded={panel === "due"}
          onClick={() => {
            setDueDaysDraft(todo.dueDays ? String(todo.dueDays) : "1");
            togglePanel("due");
          }}
        >
          <CalendarClock aria-hidden strokeWidth={2} />
        </button>
        <button
          type="button"
          className={`todo-context-icon-button${todo.tags.length > 0 ? " has-value" : ""}${panel === "tags" ? " open" : ""}`}
          title="标签"
          aria-label="标签"
          aria-expanded={panel === "tags"}
          onClick={() => togglePanel("tags")}
        >
          <Tag aria-hidden strokeWidth={2} />
        </button>
        <button
          type="button"
          className={`todo-context-icon-button${todo.subtasks.length > 0 ? " has-value" : ""}${panel === "subtasks" ? " open" : ""}`}
          title="步骤"
          aria-label="步骤"
          aria-expanded={panel === "subtasks"}
          onClick={() => togglePanel("subtasks")}
        >
          <ListTodo aria-hidden strokeWidth={2} />
        </button>
        <button
          type="button"
          className={`todo-context-icon-button${
            todo.status === "waiting" || (todo.waitHistory?.length ?? 0) > 0 ? " has-value" : ""
          }${panel === "waiting" ? " open" : ""}`}
          title="等待中"
          aria-label="等待中"
          aria-expanded={panel === "waiting"}
          onClick={() => {
            setWaitingReasonDraft(todo.waitingReason ?? "");
            togglePanel("waiting");
          }}
        >
          <Hourglass aria-hidden strokeWidth={2} />
        </button>
      </div>

      {panel === "due" ? (
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
                setPanel(null);
              }
            }}
          />
          <span>天</span>
          <button type="submit" className="todo-due-confirm">
            确定
          </button>
          {todo.dueDays ? (
            <button
              type="button"
              className="todo-due-clear"
              onClick={() => {
                void window.todoApi.setTodoDueDays(todo.id, null).then((next) => {
                  onSnapshotRef.current(next);
                  onCloseRef.current();
                });
              }}
            >
              清除
            </button>
          ) : null}
        </form>
      ) : null}

      {panel === "tags" ? (
        <TodoTagEditor
          tags={todo.tags}
          onChange={(tags) => {
            void window.todoApi.setTodoTags(todo.id, tags).then((next) => {
              onSnapshotRef.current(next);
              onCloseRef.current();
            });
          }}
        />
      ) : null}

      {panel === "subtasks" ? (
        <form
          className="todo-context-subtask"
          onSubmit={(event) => {
            event.preventDefault();
            const title = subtaskDraft.trim();
            if (!title) return;
            void window.todoApi.addTodoSubtask(todo.id, title).then((next) => {
              onSnapshotRef.current(next);
              onCloseRef.current();
            });
          }}
        >
          <div className="todo-tags-custom">
            <input
              value={subtaskDraft}
              onChange={(event) => setSubtaskDraft(event.target.value)}
              placeholder="添加步骤…"
              aria-label="添加步骤"
              maxLength={80}
              autoFocus
            />
            <button type="submit">添加</button>
          </div>
        </form>
      ) : null}

      {panel === "waiting" ? (
        <div className="todo-waiting-panel">
          <form
            className="todo-waiting-editor"
            onSubmit={(event) => {
              event.preventDefault();
              void commitWaiting();
            }}
          >
            {todo.status === "waiting" ? (
              <span className="todo-waiting-editor-days">{formatWaitingDays(todo.waitingSince, today)}</span>
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
                  setPanel(null);
                }
              }}
            />
            <div className="todo-waiting-editor-actions">
              <button type="submit" className="todo-due-confirm">
                {todo.status === "waiting" ? "更新" : "开始等待"}
              </button>
              {todo.status === "waiting" ? (
                <button type="button" className="todo-due-clear" onClick={() => void commitResume()}>
                  结束等待
                </button>
              ) : null}
            </div>
          </form>
          {waitingViewItems.length > 0 ? (
            <div className="todo-waiting-history" aria-label="等待记录">
              <div className="todo-waiting-history-title">等待记录</div>
              <ul className="todo-waiting-history-list">
                {waitingViewItems.map((item) => (
                  <li
                    key={item.key}
                    className={`todo-waiting-history-item${item.ongoing ? " ongoing" : ""}`}
                    title={formatWaitingViewItem(item, today)}
                  >
                    <span className="todo-waiting-history-range">
                      {item.ongoing
                        ? `${formatWaitDate(item.startedAt)} 起`
                        : `${formatWaitDate(item.startedAt)} – ${formatWaitDate(item.endedAt ?? item.startedAt)}`}
                    </span>
                    <span className="todo-waiting-history-span">
                      {item.ongoing
                        ? formatWaitingDays(item.startedAt, today)
                        : formatWaitSpan(item.startedAt, item.endedAt ?? item.startedAt)}
                    </span>
                    {item.reason ? (
                      <span className="todo-waiting-history-reason">{item.reason}</span>
                    ) : (
                      <span className="todo-waiting-history-reason muted">无原因</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
