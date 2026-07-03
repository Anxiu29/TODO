import { useEffect, useMemo, useState } from "react";
import type React from "react";
import TodoRating from "./TodoRating";
import type { AppSettings, TodoSnapshot } from "./types/todo";

const emptySnapshot: TodoSnapshot = {
  today: "",
  activeTodos: [],
  completedToday: [],
  allTodos: []
};

const formatDate = (date: string): string => {
  if (!date) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long"
  }).format(new Date(`${date}T00:00:00`));
};

const formatShortcut = (shortcut?: string): string =>
  (shortcut ?? "CommandOrControl+Alt+T")
    .replace("CommandOrControl", "Ctrl")
    .replace(/\+/g, " + ");

type IconName = "calendar" | "quit" | "settings";

const Icon = ({ name }: { name: IconName }): React.ReactElement => {
  const paths: Record<IconName, React.ReactNode> = {
    calendar: (
      <>
        <rect x="5" y="6" width="14" height="13" rx="2" />
        <path d="M8 4v4M16 4v4M5 10h14" />
      </>
    ),
    quit: (
      <>
        <path d="M7 7l10 10M17 7 7 17" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 3.1-.2-.1a1.7 1.7 0 0 0-2 .2 1.7 1.7 0 0 0-.8 1.7V22h-3.6v-.1a1.7 1.7 0 0 0-1.2-1.6 1.7 1.7 0 0 0-1.8.2l-.2.1-1.8-3.1.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.4-1.1H5v-3.6h.2a1.7 1.7 0 0 0 1.4-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 1.8-3.1.2.1a1.7 1.7 0 0 0 2-.2A1.7 1.7 0 0 0 11 2.8V2h3.6v.8a1.7 1.7 0 0 0 1.2 1.6 1.7 1.7 0 0 0 1.8-.2l.2-.1 1.8 3.1-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.4 1.1h.2v3.6h-.2a1.7 1.7 0 0 0-1.2 1.1Z" />
      </>
    )
  };

  return (
    <svg aria-hidden="true" className="button-icon" viewBox="0 0 24 24">
      {paths[name]}
    </svg>
  );
};

export default function App(): React.ReactElement {
  const [snapshot, setSnapshot] = useState<TodoSnapshot>(emptySnapshot);
  const [newTitle, setNewTitle] = useState("");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [desktopAttached, setDesktopAttached] = useState<boolean | null>(null);

  useEffect(() => {
    void window.todoApi.getSnapshot().then(setSnapshot);
    void window.todoApi.getSettings().then(setSettings);

    const offTodos = window.todoApi.onTodosChanged(setSnapshot);
    const offDesktop = window.todoApi.onDesktopAttachResult(setDesktopAttached);
    const offSettings = window.todoApi.onSettingsChanged(setSettings);
    return () => {
      offTodos();
      offDesktop();
      offSettings();
    };
  }, []);

  const remainingLabel = useMemo(() => {
    if (snapshot.activeTodos.length === 0) return "今天没有待办";
    return `还有 ${snapshot.activeTodos.length} 件待办`;
  }, [snapshot.activeTodos.length]);

  const addTodo = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const title = newTitle.trim();
    if (!title) return;

    const next = await window.todoApi.addTodo({ title });
    setSnapshot(next);
    setNewTitle("");
  };

  return (
    <main className="widget-shell">
      <section className="widget-card">
        <header className="widget-header draggable">
          <div>
            <p className="eyebrow">{formatDate(snapshot.today)}</p>
            <h1>桌面代办</h1>
          </div>
          <div className="header-actions no-drag">
            <button className="icon-button" type="button" title="完成日历" aria-label="完成日历" onClick={() => window.todoApi.openCalendar()}>
              <Icon name="calendar" />
            </button>
            <button
              className="icon-button"
              type="button"
              title="设置"
              aria-label="设置"
              onClick={() => window.todoApi.openSettings()}
            >
              <Icon name="settings" />
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

        <div className="summary-row">
          <span>{remainingLabel}</span>
          <button type="button" onClick={() => window.todoApi.openAddTodo()}>
            快捷添加
          </button>
        </div>

        <section className="todo-list" aria-label="今日待办">
          {snapshot.activeTodos.length === 0 ? (
            <div className="empty-state">
              <strong>今天清空了</strong>
              <span>全局快捷键 {formatShortcut(settings?.shortcut)} 可以随时添加。</span>
            </div>
          ) : (
            snapshot.activeTodos.map((todo) => (
              <article className="todo-item" key={todo.id}>
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
                <span>{todo.title}</span>
                <button className="text-button danger" type="button" onClick={() => window.todoApi.deleteTodo(todo.id)}>
                  删除
                </button>
              </article>
            ))
          )}
        </section>

        <section className="completed-panel">
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
          <span>
            {desktopAttached === false
              ? "桌面固定失败，可切到当前页面显示"
              : `${formatShortcut(settings?.shortcut)} 呼出添加，托盘图标可显示组件`}
          </span>
        </footer>
      </section>
    </main>
  );
}
