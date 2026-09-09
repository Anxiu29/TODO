/**
 * 添加待办窗口（?view=add）。
 *
 * 可由挂件「添加」按钮或全局快捷键唤起。
 * 特点：Enter / 确认按钮提交后关闭、Escape 关闭；普通窗口，失焦保持打开、不置顶；
 * 再次唤起时通过 getPendingAddTodoTags 拉取 + quick-add:focus 同步预填标签
 * （添加窗为 lazy 加载，仅靠 push 会在监听器挂上前丢失标签）；
 * 提交前可点选星级（默认五星）、可选预计天数；
 * 若从某标签筛选下打开则自动带上该标签；
 * 标题一行放不下时自动换行，窗口随内容增高。
 */
import { Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type React from "react";
import { CloseWindowButton } from "./CloseWindowButton";
import { TodoTagChips } from "./TodoTags";
import { useCardWindowHeight } from "./useCardWindowHeight";
import { useEscapeToClose } from "./useEscapeToClose";
import { shouldSubmitOnEnter } from "./data/formSubmission";
import { useFormSubmission } from "./useFormSubmission";
import {
  DUE_DAYS_MAX,
  DUE_DAYS_MIN,
  normalizeDueDays,
  normalizeTodoTags,
  parseAddTodoTagsQuery,
  TODO_RATING_DEFAULT,
  TODO_RATING_MAX,
  TODO_RATING_MIN
} from "./types/todo";

export default function AddTodoWindow(): React.ReactElement {
  const [title, setTitle] = useState("");
  /** 新建默认五星，可在提交前点选 */
  const [rating, setRating] = useState(TODO_RATING_DEFAULT);
  /** 首屏先吃 URL；随后 pull / quick-add:focus 覆盖（窗口复用时 URL 可能是旧的） */
  const [tags, setTags] = useState<string[]>(() => parseAddTodoTagsQuery(window.location.search));
  /** 预计天数草稿；空字符串表示不设置 */
  const [dueDaysDraft, setDueDaysDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLFormElement>(null);
  useCardWindowHeight(title, inputRef, cardRef);
  const submission = useFormSubmission();
  useEscapeToClose();

  useEffect(() => {
    /** 同步预填标签、恢复默认星级/天数，并延迟聚焦输入框 */
    const applyFocus = (nextTags: string[]): void => {
      setTags(normalizeTodoTags(nextTags));
      setRating(TODO_RATING_DEFAULT);
      setDueDaysDraft("");
      window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    };

    // 主动拉取：添加窗 lazy 加载，ready-to-show 时监听器往往还没挂上，push 会丢
    void window.todoApi.getPendingAddTodoTags().then(applyFocus);

    const offFocus = window.todoApi.onQuickAddFocus((payload) => {
      applyFocus(Array.isArray(payload?.tags) ? payload.tags : []);
    });
    return () => {
      offFocus();
    };
  }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const value = title.replace(/\s+/g, " ").trim();
    if (!value) return;

    const dueDays = normalizeDueDays(dueDaysDraft);
    // 锁覆盖整个请求，失败时不清空草稿。
    await submission.submit(async () => {
      await window.todoApi.addTodo({
        title: value,
        rating,
        tags,
        ...(dueDays !== undefined ? { dueDays } : {})
      });
      setTitle("");
      setRating(TODO_RATING_DEFAULT);
      setTags([]);
      setDueDaysDraft("");
      await window.todoApi.closeCurrentWindow();
    });
  };

  const ratingOptions = Array.from(
    { length: TODO_RATING_MAX - TODO_RATING_MIN + 1 },
    (_, index) => TODO_RATING_MIN + index
  );

  return (
    <main className="quick-add-shell">
      <form className="quick-add-card" ref={cardRef} onSubmit={submit}>
        <header className="quick-add-header">
          <div>
            <p className="eyebrow">添加待办</p>
            <h1>新的待办事项</h1>
          </div>
          <CloseWindowButton />
        </header>
        {/* 从某个标签筛选进入时提示将自动带上该标签 */}
        {tags.length > 0 ? (
          <div className="quick-add-tags no-drag" aria-label="将添加的标签">
            <span className="quick-add-tags-label">标签</span>
            <TodoTagChips tags={tags} />
          </div>
        ) : null}
        <div className="quick-add-rating no-drag" role="group" aria-label="紧急评分">
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
        <div className="quick-add-due no-drag">
          <span className="quick-add-due-label">预计</span>
          <input
            className="quick-add-due-input"
            type="number"
            min={DUE_DAYS_MIN}
            max={DUE_DAYS_MAX}
            inputMode="numeric"
            value={dueDaysDraft}
            placeholder="可选"
            aria-label="预计几天完成"
            onChange={(event) => setDueDaysDraft(event.target.value)}
          />
          <span className="quick-add-due-unit">天</span>
        </div>
        <textarea
          className="quick-add-title-input no-drag"
          ref={inputRef}
          rows={1}
          value={title}
          disabled={submission.saving}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            // Enter 提交；换行只靠自动折行，避免标题里塞进硬回车
            if (shouldSubmitOnEnter(event.nativeEvent)) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="输入待办标题"
          aria-label="新的待办事项"
        />
        {submission.error ? <p role="alert">{submission.error}</p> : null}
        <div className="quick-add-actions no-drag">
          <button type="submit" className="quick-add-confirm" disabled={submission.saving || !title.trim()}>
            确认添加
          </button>
        </div>
      </form>
    </main>
  );
}
