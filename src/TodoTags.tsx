/**
 * 待办标签展示与编辑。
 * - chips：列表内只读展示已有标签
 * - editor：右键菜单内切换预设标签（分类互斥，紧急可叠加）
 */
import type React from "react";
import { PRESET_TAGS, URGENT_TAG } from "./types/todo";

/** 标签名 → CSS 色调后缀，用于 .todo-tag-* 样式 */
export const tagTone = (tag: string): string => {
  if (tag === "工作") return "work";
  if (tag === "生活") return "life";
  if (tag === "学习") return "study";
  if (tag === URGENT_TAG) return "urgent";
  return "custom";
};

type TodoTagChipsProps = {
  tags: string[];
};

/** 列表内紧凑展示；无标签时不占位 */
export function TodoTagChips({ tags }: TodoTagChipsProps): React.ReactElement | null {
  if (tags.length === 0) return null;

  return (
    <div className="todo-tags-chips" aria-label="标签">
      {tags.map((tag) => (
        <span key={tag} className={`todo-tag todo-tag-${tagTone(tag)}`}>
          {tag}
        </span>
      ))}
    </div>
  );
}

type TodoTagEditorProps = {
  tags: string[];
  onChange: (tags: string[]) => void;
};

/**
 * 右键菜单内标签编辑。
 * 工作/生活/学习互斥；「紧急」可与任一分类并存。
 */
export function TodoTagEditor({ tags, onChange }: TodoTagEditorProps): React.ReactElement {
  const toggleTag = (tag: string): void => {
    const hasUrgent = tags.includes(URGENT_TAG);
    const category = tags.find((item) => item !== URGENT_TAG);

    if (tag === URGENT_TAG) {
      if (hasUrgent) {
        onChange(category ? [category] : []);
        return;
      }
      onChange(category ? [category, URGENT_TAG] : [URGENT_TAG]);
      return;
    }

    // 分类：再点一次取消；换分类则替换，保留紧急
    if (category === tag) {
      onChange(hasUrgent ? [URGENT_TAG] : []);
      return;
    }
    onChange(hasUrgent ? [tag, URGENT_TAG] : [tag]);
  };

  return (
    <div className="todo-tags-editor">
      <div className="todo-tags-presets">
        {PRESET_TAGS.map((tag) => {
          const selected = tags.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              className={`todo-tag todo-tag-${tagTone(tag)}${selected ? " selected" : ""}`}
              onClick={() => toggleTag(tag)}
            >
              {tag}
            </button>
          );
        })}
      </div>
    </div>
  );
}
