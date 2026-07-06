/**
 * 完成日历窗口（?view=calendar）。
 *
 * 左侧月历格显示每日完成数量，右侧展示选中日期的完成列表。
 * 支持编辑标题、恢复为进行中；待办变更时通过 onTodosChanged 自动刷新。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import type { Todo, TodoCalendarDay } from "./types/todo";

/** 周一为首的中文星期标签 */
const weekDays = ["一", "二", "三", "四", "五", "六", "日"];

const toDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/**
 * 生成 6 行 × 7 列 = 42 个日期格，覆盖当月完整周。
 * 以周一为一周起始（firstWeekday 调整）。
 */
const getMonthCells = (current: Date): Date[] => {
  const year = current.getFullYear();
  const month = current.getMonth();
  const first = new Date(year, month, 1);
  const firstWeekday = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - firstWeekday);

  return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
};

export default function CalendarView(): React.ReactElement {
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [days, setDays] = useState<TodoCalendarDay[]>([]);
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const skipBlurSaveRef = useRef(false);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth() + 1;

  const loadCalendar = async (): Promise<void> => {
    const next = await window.todoApi.getCalendar(year, month);
    setDays(next);
  };

  /** 切换月份或待办变更时重新拉取当月完成数据 */
  useEffect(() => {
    void loadCalendar();
    const off = window.todoApi.onTodosChanged(() => {
      void loadCalendar();
    });
    return off;
  }, [year, month]);

  const dayMap = useMemo(() => new Map(days.map((day) => [day.date, day])), [days]);
  const cells = useMemo(() => getMonthCells(currentMonth), [currentMonth]);
  const selected = dayMap.get(selectedDate);

  const changeMonth = (offset: number): void => {
    setCurrentMonth((date) => new Date(date.getFullYear(), date.getMonth() + offset, 1));
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

    await window.todoApi.updateTodo(editingId, { title });
    cancelEdit();
  };

  const handleEditBlur = (): void => {
    if (skipBlurSaveRef.current) {
      skipBlurSaveRef.current = false;
      return;
    }
    void saveEdit();
  };

  return (
    <main className="calendar-shell">
      <section className="calendar-card">
        <header className="calendar-header">
          <div>
            <p className="eyebrow">完成记录</p>
            <h1>
              {year} 年 {month} 月
            </h1>
          </div>
          <div className="calendar-actions">
            <button type="button" onClick={() => changeMonth(-1)}>
              上个月
            </button>
            <button type="button" onClick={() => setCurrentMonth(new Date())}>
              今天
            </button>
            <button type="button" onClick={() => changeMonth(1)}>
              下个月
            </button>
          </div>
        </header>

        <div className="calendar-layout">
          <section className="calendar-grid" aria-label="完成事项日历">
            {weekDays.map((day) => (
              <div className="weekday" key={day}>
                {day}
              </div>
            ))}
            {cells.map((date) => {
              const dateKey = toDateKey(date);
              const data = dayMap.get(dateKey);
              const inMonth = date.getMonth() === currentMonth.getMonth();
              const isSelected = selectedDate === dateKey;

              return (
                <button
                  className={`calendar-day ${inMonth ? "" : "muted"} ${isSelected ? "selected" : ""}`}
                  type="button"
                  key={dateKey}
                  onClick={() => setSelectedDate(dateKey)}
                >
                  <span>{date.getDate()}</span>
                  {data ? <strong>{data.completedCount}</strong> : null}
                </button>
              );
            })}
          </section>

          <aside className="day-detail">
            <p className="eyebrow">{selectedDate}</p>
            <h2>完成事项</h2>
            {!selected || selected.completedTodos.length === 0 ? (
              <div className="empty-state">
                <strong>没有完成记录</strong>
                <span>完成今日待办后会出现在这里。</span>
              </div>
            ) : (
              selected.completedTodos.map((todo) => (
                <article className="detail-item" key={todo.id}>
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
                    <button type="button" onClick={() => window.todoApi.reopenTodo(todo.id)}>
                      恢复
                    </button>
                  ) : null}
                </article>
              ))
            )}
          </aside>
        </div>
      </section>
    </main>
  );
}
