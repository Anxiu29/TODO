/** 表单输入保护：输入法组词不提交，同一保存请求结束前禁止重复提交。 */

/** 兼容部分输入法只报告 keyCode=229 的组词事件。 */
export const isComposingKey = (event: { isComposing?: boolean; keyCode?: number }): boolean =>
  event.isComposing === true || event.keyCode === 229;

/** Enter 自动重复和输入法确认都不能触发表单保存。 */
export const shouldSubmitOnEnter = (event: { key: string; shiftKey: boolean; repeat: boolean; isComposing?: boolean; keyCode?: number }): boolean =>
  event.key === "Enter" && !event.shiftKey && !event.repeat && !isComposingKey(event);

/** 同步上锁，避免 React 状态尚未刷新时第二次点击穿过保护。 */
export const createSubmissionGate = () => {
  let pending = false;
  return async (save: () => Promise<void>): Promise<void> => {
    if (pending) return;
    pending = true;
    try { await save(); } finally { pending = false; }
  };
};
