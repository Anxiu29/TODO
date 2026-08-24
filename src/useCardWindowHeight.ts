/**
 * 添加/编辑窗：标题 textarea 随内容增高，并把卡片高度同步给主进程。
 * 两窗布局相同，抽出来避免各写一份 ResizeObserver。
 */
import { useEffect, useLayoutEffect, type RefObject } from "react";

/**
 * @param title 标题变化时重算 textarea 高度
 * @param inputRef 标题输入框
 * @param cardRef 整张卡片（窗口高度按它的 scrollHeight）
 */
export const useCardWindowHeight = (
  title: string,
  inputRef: RefObject<HTMLTextAreaElement | null>,
  cardRef: RefObject<HTMLElement | null>
): void => {
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    // 先收成 auto 再读 scrollHeight，否则缩短标题时高度不会回落
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [title, inputRef]);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    const syncWindowHeight = (): void => {
      void window.todoApi.resizeAddTodoWindow(Math.ceil(card.scrollHeight));
    };

    syncWindowHeight();
    const observer = new ResizeObserver(syncWindowHeight);
    observer.observe(card);
    return () => observer.disconnect();
  }, [cardRef]);
};
