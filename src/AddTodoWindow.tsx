import { useEffect, useRef, useState } from "react";
import type React from "react";

export default function AddTodoWindow(): React.ReactElement {
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focusInput = (): void => {
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

    await window.todoApi.addTodo({ title: value });
    setTitle("");
    await window.todoApi.closeCurrentWindow();
  };

  return (
    <main className="quick-add-shell">
      <form className="quick-add-card" onSubmit={submit}>
        <header className="quick-add-header draggable">
          <div>
            <p className="eyebrow">快捷添加</p>
            <h1>新的待办事项</h1>
          </div>
          <button className="icon-button no-drag" type="button" onClick={() => window.todoApi.closeCurrentWindow()}>
            关闭
          </button>
        </header>
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
