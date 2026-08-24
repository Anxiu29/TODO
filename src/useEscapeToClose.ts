/**
 * Escape 关闭当前辅助窗口。
 *
 * 添加/编辑：标题框里按 Escape 也关窗。
 * 设置：快捷键录制 input 会 preventDefault，避免把 Escape 当成关窗。
 * 日历：ignoreEditable，改标题时 Escape 只取消编辑。
 */
import { useEffect } from "react";

type Options = {
  /** 焦点在 input/textarea/select 时不关窗 */
  ignoreEditable?: boolean;
};

/** 监听 window keydown，Escape 时 hide 当前 BrowserWindow */
export const useEscapeToClose = (options: Options = {}): void => {
  const ignoreEditable = options.ignoreEditable === true;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (event.defaultPrevented) return;
      if (ignoreEditable) {
        const target = event.target;
        if (target instanceof HTMLElement && target.closest("input, textarea, select")) {
          return;
        }
      }
      void window.todoApi.closeCurrentWindow();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ignoreEditable]);
};
