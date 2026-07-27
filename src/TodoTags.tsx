/**
 * 待办标签展示与编辑。
 * - chips：列表内只读展示已有标签
 * - editor：右键菜单内切换预设标签，并支持添加自定义标签
 */
import { useState } from "react";
import type React from "react";
import {
  CUSTOM_TAG_MAX_LEN,
  isCategoryTag,
  isPresetTag,
  normalizeTodoTags,
  PRESET_TAGS,
  URGENT_TAG
} from "./types/todo";

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
 * 工作/生活/学习互斥；「紧急」与自定义可叠加；底部可新增自定义标签。
 */
export function TodoTagEditor({ tags, onChange }: TodoTagEditorProps): React.ReactElement {
  const [customDraft, setCustomDraft] = useState("");

  /** 已挂在待办上、且非预设的自定义标签，便于再次点选取消 */
  const customTags = tags.filter((tag) => !isPresetTag(tag));

  const toggleTag = (tag: string): void => {
    if (tag === URGENT_TAG) {
      onChange(
        tags.includes(URGENT_TAG) ? tags.filter((item) => item !== URGENT_TAG) : [...tags, URGENT_TAG]
      );
      return;
    }

    if (isCategoryTag(tag)) {
      const withoutCategories = tags.filter((item) => !isCategoryTag(item));
      // 再点同一分类则取消；换分类则替换，保留紧急与自定义
      if (tags.includes(tag)) {
        onChange(withoutCategories);
        return;
      }
      onChange(normalizeTodoTags([tag, ...withoutCategories]));
      return;
    }

    // 自定义：点选切换
    if (tags.includes(tag)) {
      onChange(tags.filter((item) => item !== tag));
      return;
    }
    onChange(normalizeTodoTags([...tags, tag]));
  };

  const addCustomTag = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const tag = customDraft.trim();
    if (!tag) return;
    // 与预设重名时走预设 toggle 语义（分类互斥 / 紧急叠加）
    if (isPresetTag(tag)) {
      toggleTag(tag);
      setCustomDraft("");
      return;
    }
    if (tags.includes(tag)) {
      setCustomDraft("");
      return;
    }
    onChange(normalizeTodoTags([...tags, tag]));
    setCustomDraft("");
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
        {customTags.map((tag) => (
          <button
            key={tag}
            type="button"
            className={`todo-tag todo-tag-${tagTone(tag)} selected`}
            onClick={() => toggleTag(tag)}
            title="再次点击可移除"
          >
            {tag}
          </button>
        ))}
      </div>
      <form className="todo-tags-custom" onSubmit={addCustomTag}>
        <input
          value={customDraft}
          onChange={(event) => setCustomDraft(event.target.value)}
          placeholder="自定义标签…"
          aria-label="自定义标签"
          maxLength={CUSTOM_TAG_MAX_LEN}
        />
        <button type="submit">添加</button>
      </form>
    </div>
  );
}
