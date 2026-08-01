/**
 * 待办步骤列表（持久化字段仍为 subtasks）。
 *
 * 仅在已有步骤时渲染；新增一律走右键菜单，避免列表里再占一行输入。
 * 有步骤时默认展开；每行展示已进行/用时天数。
 */
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { useState } from "react";
import type React from "react";
import { formatStepDaysLabel } from "./data/todoStore";
import type { TodoSubtask } from "./types/todo";

type TodoSubtasksProps = {
  subtasks: TodoSubtask[];
  /** 今日日期键 YYYY-MM-DD，用于计算已进行天数 */
  today: string;
  onToggle: (subtaskId: string) => void;
  onUpdate: (subtaskId: string, title: string) => void;
  onDelete: (subtaskId: string) => void;
};

export default function TodoSubtasks({
  subtasks,
  today,
  onToggle,
  onUpdate,
  onDelete
}: TodoSubtasksProps): React.ReactElement | null {
  /** 无步骤时完全不占位 */
  if (subtasks.length === 0) return null;

  return (
    <TodoSubtasksPanel
      subtasks={subtasks}
      today={today}
      onToggle={onToggle}
      onUpdate={onUpdate}
      onDelete={onDelete}
    />
  );
}

type TodoSubtasksPanelProps = TodoSubtasksProps & {
  subtasks: TodoSubtask[];
};

function TodoSubtasksPanel({
  subtasks,
  today,
  onToggle,
  onUpdate,
  onDelete
}: TodoSubtasksPanelProps): React.ReactElement {
  /** 有步骤时默认展开，方便边做边勾 */
  const [expanded, setExpanded] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  const doneCount = subtasks.filter((item) => item.done).length;

  const saveEdit = (): void => {
    if (!editingId) return;
    const title = editingTitle.trim();
    if (title) {
      onUpdate(editingId, title);
    }
    setEditingId(null);
    setEditingTitle("");
  };

  return (
    <div className="todo-subtasks">
      <button
        type="button"
        className="todo-subtasks-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? (
          <ChevronDown aria-hidden className="todo-subtasks-chevron" strokeWidth={2} />
        ) : (
          <ChevronRight aria-hidden className="todo-subtasks-chevron" strokeWidth={2} />
        )}
        <span>
          步骤 {doneCount}/{subtasks.length}
        </span>
      </button>

      {expanded ? (
        <div className="todo-subtasks-body">
          {subtasks.map((subtask) => (
            <div className={`todo-subtask${subtask.done ? " done" : ""}`} key={subtask.id}>
              <button
                type="button"
                className="todo-subtask-check"
                aria-label={subtask.done ? `取消完成 ${subtask.title}` : `完成 ${subtask.title}`}
                onClick={() => onToggle(subtask.id)}
              />
              {editingId === subtask.id ? (
                <input
                  className="todo-subtask-input"
                  value={editingTitle}
                  onChange={(event) => setEditingTitle(event.target.value)}
                  onBlur={saveEdit}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      saveEdit();
                    }
                    if (event.key === "Escape") {
                      setEditingId(null);
                      setEditingTitle("");
                    }
                  }}
                  aria-label="编辑步骤"
                  autoFocus
                />
              ) : (
                <button
                  type="button"
                  className="todo-subtask-title"
                  onClick={() => {
                    setEditingId(subtask.id);
                    setEditingTitle(subtask.title);
                  }}
                >
                  {subtask.title}
                </button>
              )}
              <span className="todo-subtask-days">{formatStepDaysLabel(subtask, today)}</span>
              <button
                type="button"
                className="icon-button danger-button todo-subtask-delete"
                aria-label={`删除步骤 ${subtask.title}`}
                onClick={() => onDelete(subtask.id)}
              >
                <Trash2 aria-hidden className="button-icon" strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
