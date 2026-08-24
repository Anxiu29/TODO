/**
 * 编辑待办窗口（?view=edit）。
 *
 * 从挂件点击标题唤起，独立于挂件，避免编辑框被卡片裁切。
 * 标题一行放不下时自动换行；Enter 保存、Escape 关闭。
 */
import { useEffect, useRef, useState } from "react";
import type React from "react";
import { CloseWindowButton } from "./CloseWindowButton";
import { useCardWindowHeight } from "./useCardWindowHeight";
import { useEscapeToClose } from "./useEscapeToClose";

const initialTodoId = new URLSearchParams(window.location.search).get("id");

export default function EditTodoWindow(): React.ReactElement {
  const [todoId, setTodoId] = useState(initialTodoId);
  const [title, setTitle] = useState("");
  const [ready, setReady] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLFormElement>(null);
  const todoIdRef = useRef(todoId);
  todoIdRef.current = todoId;
  useCardWindowHeight(title, inputRef, cardRef);
  useEscapeToClose();

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
          <CloseWindowButton />
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
