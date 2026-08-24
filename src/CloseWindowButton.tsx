/**
 * 辅助窗口右上角关闭按钮。四个窗口共用，避免每处复制一套 X + closeCurrentWindow。
 */
import { X } from "lucide-react";
import type React from "react";

type CloseWindowButtonProps = {
  /** 额外 class，例如挂件标题栏不需要 no-drag 时由父级处理 */
  className?: string;
};

/** 关闭当前 BrowserWindow（添加/编辑/日历/设置） */
export const CloseWindowButton = ({ className = "icon-button danger-button no-drag" }: CloseWindowButtonProps): React.ReactElement => (
  <button
    className={className}
    type="button"
    title="关闭"
    aria-label="关闭"
    onClick={() => window.todoApi.closeCurrentWindow()}
  >
    <X aria-hidden className="button-icon" strokeWidth={2} />
  </button>
);
