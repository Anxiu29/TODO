/** 添加和编辑共用保存状态，失败保留草稿并展示可重试提示。 */
import { useRef, useState } from "react";
import { createSubmissionGate } from "./data/formSubmission";

/** 为异步保存提供同步防重锁、按钮状态与错误文案。 */
export const useFormSubmission = () => {
  const gate = useRef(createSubmissionGate());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submit = (save: () => Promise<void>): Promise<void> => gate.current(async () => {
    setSaving(true);
    setError("");
    try { await save(); } catch {
      setError("保存未完成，请检查磁盘空间和文件权限后重试，输入内容已保留。");
    } finally { setSaving(false); }
  });
  return { saving, error, submit };
};
