/**
 * 添加待办窗口（?view=add）。
 *
 * 可由挂件「添加」按钮或全局快捷键唤起。
 * 特点：失焦自动隐藏、Enter 提交后关闭、Escape 关闭、
 * 再次按快捷键时通过 quick-add:focus 事件重新聚焦输入框；
 * 提交前可点选星级，默认五星。
 */
import { Star, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type React from "react";
import { TODO_RATING_DEFAULT, TODO_RATING_MAX, TODO_RATING_MIN } from "./types/todo";

export default function AddTodoWindow(): React.ReactElement {
  const [title, setTitle] = useState("");
  /** 新建默认五星，可在提交前点选 */
  const [rating, setRating] = useState(TODO_RATING_DEFAULT);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    /** 每次唤起：恢复默认五星，并延迟聚焦输入框 */
    const focusInput = (): void => {
      setRating(TODO_RATING_DEFAULT);
      window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    };

    focusInput();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        void window.todoApi.closeCurrentWindow();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    const offFocus = window.todoApi.onQuickAddFocus(focusInput);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      offFocus();
    };
  }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const value = title.trim();
    if (!value) return;

    await window.todoApi.addTodo({ title: value, rating });
    setTitle("");
    setRating(TODO_RATING_DEFAULT);
    await window.todoApi.closeCurrentWindow();
  };

  const ratingOptions = Array.from(
    { length: TODO_RATING_MAX - TODO_RATING_MIN + 1 },
    (_, index) => TODO_RATING_MIN + index
  );

  return (
    <main className="quick-add-shell">
      <form className="quick-add-card" onSubmit={submit}>
        <header className="quick-add-header">
          <div>
            <p className="eyebrow">添加待办</p>
            <h1>新的待办事项</h1>
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
        <div className="quick-add-rating" role="group" aria-label="紧急评分">
          <span className="quick-add-rating-label">紧急</span>
          <div className="quick-add-rating-stars">
            {ratingOptions.map((value) => {
              const active = value <= rating;
              return (
                <button
                  key={value}
                  type="button"
                  className={active ? "active" : ""}
                  aria-label={`${value} 星`}
                  aria-pressed={value === rating}
                  title={`${value} 星`}
                  onClick={() => setRating(value)}
                >
                  <Star
                    aria-hidden
                    className="quick-add-rating-star"
                    fill={active ? "currentColor" : "none"}
                    strokeWidth={active ? 0 : 1.8}
                  />
                </button>
              );
            })}
          </div>
        </div>
        <input
          ref={inputRef}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="输入后按 Enter 添加"
          aria-label="新的待办事项"
        />
      </form>
    </main>
  );
}
