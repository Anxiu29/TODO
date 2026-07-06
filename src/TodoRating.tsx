/**
 * 待办紧急评分组件（1–5 星）。
 *
 * 点击触发按钮展开下拉菜单选择评分；点击组件外部自动关闭。
 * 评分影响 sortTodos 中的列表排序（高分优先）。
 */
import { useEffect, useRef, useState } from "react";
import type React from "react";
import { TODO_RATING_MAX, TODO_RATING_MIN } from "./types/todo";

type TodoRatingProps = {
  rating: number;
  onChange: (rating: number) => void;
};

const StarIcon = (): React.ReactElement => (
  <svg aria-hidden="true" className="todo-rating-star" viewBox="0 0 24 24">
    <path d="M12 3.2 14.7 9l6.1.5-4.6 3.9 1.4 6-5.6-3.4L6.4 19.4l1.4-6L3.2 9.5 9.3 9 12 3.2Z" />
  </svg>
);

export default function TodoRating({ rating, onChange }: TodoRatingProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  /** 菜单打开时监听全局 pointerdown，点击外部区域关闭 */
  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const options = Array.from({ length: TODO_RATING_MAX - TODO_RATING_MIN + 1 }, (_, index) => TODO_RATING_MIN + index);

  return (
    <div className="todo-rating" ref={rootRef}>
      <button
        className="todo-rating-trigger"
        type="button"
        aria-label={`紧急评分 ${rating}，点击修改`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <StarIcon />
        <span>{rating}</span>
      </button>
      {open ? (
        <div className="todo-rating-menu" role="listbox" aria-label="选择紧急评分">
          {options.map((value) => (
            <button
              className={value === rating ? "selected" : ""}
              type="button"
              key={value}
              role="option"
              aria-selected={value === rating}
              onClick={() => {
                onChange(value);
                setOpen(false);
              }}
            >
              <StarIcon />
              <span>{value}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
