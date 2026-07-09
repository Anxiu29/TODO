/**
 * 完成日历窗口（?view=calendar）。
 *
 * 左侧月历格显示每日完成数量，右侧展示选中日期的完成列表。
 * 支持编辑标题、恢复为进行中；待办变更时通过 onTodosChanged 自动刷新。
 */
import { X } from "lucide-react";
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

const formatSelectedDate = (dateKey: string): string =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long"
  }).format(new Date(`${dateKey}T00:00:00`));

/** 生成当月 1 日到月末的日期列表 */
const getMonthDays = (current: Date): Date[] => {
  const year = current.getFullYear();
  const month = current.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  return Array.from({ length: daysInMonth }, (_, index) => new Date(year, month, index + 1));
};

/** 当月 1 日是星期几（周一 = 0） */
const getFirstWeekday = (current: Date): number => {
  const first = new Date(current.getFullYear(), current.getMonth(), 1);
  return (first.getDay() + 6) % 7;
};

const VISIBLE_OPTION_COUNT = 5;
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => index + 1);

type WheelSelectProps = {
  value: number;
  options: number[];
  onChange: (value: number) => void;
  ariaLabel: string;
};

/** 滚轮选择器：展开后滚轮仅浏览选项，点击后才确认切换 */
function WheelSelect({ value, options, onChange, ariaLabel }: WheelSelectProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [browseIndex, setBrowseIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const menu = menuRef.current;
    if (!menu) return;

    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      setBrowseIndex((prev) => {
        const delta = event.deltaY > 0 ? 1 : -1;
        return Math.max(0, Math.min(options.length - 1, prev + delta));
      });
    };

    menu.addEventListener("wheel", handleWheel, { passive: false });
    return () => menu.removeEventListener("wheel", handleWheel);
  }, [open, options.length]);

  const startIndex = Math.max(
    0,
    Math.min(browseIndex - Math.floor(VISIBLE_OPTION_COUNT / 2), options.length - VISIBLE_OPTION_COUNT)
  );
  const visibleOptions = options.slice(startIndex, startIndex + VISIBLE_OPTION_COUNT);

  const toggleOpen = (): void => {
    if (!open) {
      const currentIndex = options.indexOf(value);
      setBrowseIndex(currentIndex >= 0 ? currentIndex : 0);
    }
    setOpen((prev) => !prev);
  };

  return (
    <div className="calendar-scroll-select" ref={rootRef}>
      <button
        type="button"
        className="calendar-month-select"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={toggleOpen}
      >
        {value}
      </button>
      {open ? (
        <div className="calendar-scroll-select-menu" ref={menuRef}>
          {visibleOptions.map((option) => {
            const optionIndex = options.indexOf(option);
            return (
              <button
                key={option}
                type="button"
                className={`calendar-scroll-select-option ${option === value ? "selected" : ""} ${optionIndex === browseIndex ? "focused" : ""}`}
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                }}
              >
                {option}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

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
  const monthDays = useMemo(() => getMonthDays(currentMonth), [currentMonth]);
  const firstWeekday = useMemo(() => getFirstWeekday(currentMonth), [currentMonth]);
  const weekCount = useMemo(() => Math.ceil((monthDays.length + firstWeekday) / 7), [monthDays.length, firstWeekday]);
  const selected = dayMap.get(selectedDate);
  const todayKey = toDateKey(new Date());

  const yearOptions = useMemo(() => {
    const anchor = new Date().getFullYear();
    return Array.from({ length: 20 }, (_, index) => anchor - 10 + index);
  }, []);

  const syncSelectedDate = (nextYear: number, nextMonth: number): void => {
    const selected = new Date(`${selectedDate}T00:00:00`);
    if (selected.getFullYear() === nextYear && selected.getMonth() + 1 === nextMonth) {
      return;
    }

    const now = new Date();
    if (now.getFullYear() === nextYear && now.getMonth() + 1 === nextMonth) {
      setSelectedDate(toDateKey(now));
      return;
    }

    setSelectedDate(`${nextYear}-${String(nextMonth).padStart(2, "0")}-01`);
  };

  const changeYear = (nextYear: number): void => {
    setCurrentMonth(new Date(nextYear, month - 1, 1));
    syncSelectedDate(nextYear, month);
  };

  const changeMonth = (nextMonth: number): void => {
    setCurrentMonth(new Date(year, nextMonth - 1, 1));
    syncSelectedDate(year, nextMonth);
  };

  const goToToday = (): void => {
    const now = new Date();
    setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDate(toDateKey(now));
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
          <div className="calendar-title-block no-drag">
            <p className="eyebrow">完成记录</p>
            <div className="calendar-title-row">
              <div className="calendar-month-picker">
                <WheelSelect value={year} options={yearOptions} onChange={changeYear} ariaLabel="选择年份" />
                <span className="calendar-month-label">年</span>
                <WheelSelect value={month} options={MONTH_OPTIONS} onChange={changeMonth} ariaLabel="选择月份" />
                <span className="calendar-month-label">月</span>
              </div>
              <button type="button" className="calendar-today-button" onClick={goToToday}>
                今日
              </button>
            </div>
          </div>
          <div className="header-actions no-drag">
            <button
              className="icon-button danger-button"
              type="button"
              title="关闭"
              aria-label="关闭"
              onClick={() => window.todoApi.closeCurrentWindow()}
            >
              <X aria-hidden className="button-icon" strokeWidth={2} />
            </button>
          </div>
        </header>

        <div className="calendar-layout no-drag">
          <section
            className="calendar-grid"
            aria-label="完成事项日历"
            style={{ "--calendar-weeks": weekCount } as React.CSSProperties}
          >
            {weekDays.map((day) => (
              <div className="weekday" key={day}>
                {day}
              </div>
            ))}
            {monthDays.map((date, index) => {
              const dateKey = toDateKey(date);
              const data = dayMap.get(dateKey);
              const isSelected = selectedDate === dateKey;
              const isToday = dateKey === todayKey;
              const hasData = Boolean(data?.completedCount);

              return (
                <button
                  className={`calendar-day ${isSelected ? "selected" : ""} ${isToday ? "today" : ""} ${hasData ? "has-data" : ""}`}
                  type="button"
                  key={dateKey}
                  style={index === 0 ? { gridColumnStart: firstWeekday + 1 } : undefined}
                  onClick={() => setSelectedDate(dateKey)}
                >
                  <span>{date.getDate()}</span>
                  {data ? <strong>{data.completedCount}</strong> : null}
                </button>
              );
            })}
          </section>

          <aside className="day-detail">
            <div className="day-detail-header">
              <h2>完成事项</h2>
              <p className="day-detail-date">{formatSelectedDate(selectedDate)}</p>
            </div>
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
