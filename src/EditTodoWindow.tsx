/**
 * 编辑待办窗口（?view=edit）。
 *
 * 从挂件点击标题唤起，独立于挂件，避免编辑框被卡片裁切。
 * 标题一行放不下时自动换行；Enter 保存、Escape 关闭。
 */
import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type React from "react";
import type { Todo } from "./types/todo";

const initialTodoId = new URLSearchParams(window.location.search).get("id");

export default function EditTodoWindow(): React.ReactElement {
  const [todoId, setTodoId] = useState(initialTodoId);
  const [title, setTitle] = useState("");
  const [ready, setReady] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLFormElement>(null);
  const todoIdRef = useRef(todoId);
  todoIdRef.current = todoId;

  /** 标题区随内容增高；量高度时 overflow hidden，避免空内容挤出滚轮 */
  const syncTitleFieldHeight = (): void => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  useLayoutEffect(() => {
    syncTitleFieldHeight();
  }, [title]);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    const syncWindowHeight = (): void => {
      const height = Math.ceil(card.scrollHeight);
      void window.todoApi.resizeAddTodoWindow(height);
    };

    syncWindowHeight();
    const observer = new ResizeObserver(syncWindowHeight);
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  /** 按 id 从快照灌入标题；待办已删则关窗 */
  const loadTodo = async (id: string | null): Promise<void> => {
    if (!id) {
      await window.todoApi.closeCurrentWindow();
      return;
    }

    const todos = (await window.todoApi.getSnapshot()).activeTodos;
    const todo = todos.find((item) => item.id === id);
    if (!todo) {
      await window.todoApi.closeCurrentWindow();
      return;
    }

    setTodoId(id);
    setTitle(todo.title);
    setReady(true);
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  };

  useEffect(() => {
    void loadTodo(todoIdRef.current);

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        void window.todoApi.closeCurrentWindow();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    const offOpen = window.todoApi.onEditTodoOpen((payload) => {
      void loadTodo(payload.id);
    });
    const offTodos = window.todoApi.onTodosChanged((snapshot) => {
      const id = todoIdRef.current;
      if (!id) return;
      if (!snapshot.activeTodos.some((item) => item.id === id)) {
        void window.todoApi.closeCurrentWindow();
      }
    });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      offOpen();
      offTodos();
    };
  }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!todoId) return;
    const value = title.replace(/\s+/g, " ").trim();
    if (!value) return;

    await window.todoApi.updateTodo(todoId, { title: value });
    await window.todoApi.closeCurrentWindow();
  };

  return (
    <main className="quick-add-shell">
      <form className="quick-add-card" ref={cardRef} onSubmit={submit}>
        <header className="quick-add-header">
          <div>
            <p className="eyebrow">编辑待办</p>
            <h1>修改标题</h1>
          </div>
          <button
            className="icon-button danger-button no-drag"
            type="button"
            title="关闭"
            aria-label="关闭"
            onClick={() => window.todoApi.closeCurrentWindow()}
          >
            <X aria-hidden className="button-icon" strokeWidth={2} />
          </button>
        </header>
        <textarea
          className="quick-add-title-input no-drag"
          ref={inputRef}
          rows={1}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="待办标题"
          aria-label="待办标题"
          disabled={!ready}
        />
        <div className="quick-add-actions no-drag">
          <button type="submit" className="quick-add-confirm" disabled={!ready || !title.trim()}>
            保存
          </button>
        </div>
      </form>
    </main>
  );
}
