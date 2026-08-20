/**
 * 全局快捷键字符串处理（与 Electron Accelerator 对齐）。
 * 主进程注册、设置页录制、挂件提示文案共用，避免各写一套导致大小写/修饰键不一致。
 */

/** 快捷添加默认组合 */
export const DEFAULT_QUICK_ADD_SHORTCUT = "CommandOrControl+2";
/** 显示挂件默认组合 */
export const DEFAULT_SHOW_WIDGET_SHORTCUT = "CommandOrControl+1";
/** 首选被占用时依次尝试；不含显示挂件的 Ctrl+1，避免互相抢 */
export const FALLBACK_SHORTCUTS = [
  DEFAULT_QUICK_ADD_SHORTCUT,
  "CommandOrControl+Alt+T",
  "CommandOrControl+Alt+N"
] as const;

/**
 * Electron 加速器 → 用户可读。
 * 例："CommandOrControl+Alt+T" → "Ctrl + Alt + T"
 */
export const formatShortcut = (
  shortcut?: string,
  fallback = DEFAULT_QUICK_ADD_SHORTCUT
): string =>
  (shortcut ?? fallback)
    .replaceAll("CommandOrControl", "Ctrl")
    .replaceAll("+", " + ");

/**
 * 将用户输入规范化为 Electron globalShortcut 格式。
 * 例："ctrl+alt+t" → "CommandOrControl+Alt+T"
 */
export const normalizeShortcut = (input: string): string => {
  const parts = input
    .trim()
    .replace(/\s+/g, "")
    .split("+")
    .filter(Boolean);

  const normalized = parts.map((part) => {
    const lower = part.toLowerCase();
    if (["ctrl", "control", "cmdorctrl", "commandorcontrol"].includes(lower)) return "CommandOrControl";
    if (["cmd", "command"].includes(lower)) return "Command";
    if (lower === "option") return "Alt";
    if (lower === "escape") return "Esc";
    if (lower === "spacebar") return "Space";
    return part.length === 1 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1);
  });

  return normalized.join("+");
};

/** 将 DOM key/code 转为加速器主键片段 */
export const keyToAcceleratorPart = (key: string, code: string): string => {
  if (key === " ") return "Space";
  if (key === "Escape") return "Esc";
  if (key.startsWith("Arrow")) return key.replace("Arrow", "");
  if (/^F\d{1,2}$/.test(key)) return key;
  if (/^[a-z]$/i.test(key)) return key.toUpperCase();
  if (/^\d$/.test(key)) return key;
  if (code.startsWith("Numpad") && code.length > "Numpad".length) return code.replace("Numpad", "num");
  return key.length === 1 ? key.toUpperCase() : key;
};

/** 录制快捷键时用的键盘事件字段；与 DOM KeyboardEvent 对齐，避免设置页依赖 React 类型 */
export type ShortcutKeyEvent = {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

/** 组合 Ctrl/Alt/Shift/Meta 与主键，生成如 CommandOrControl+Alt+T */
export const eventToShortcut = (event: ShortcutKeyEvent): string => {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("CommandOrControl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");

  // 忽略单独按下修饰键
  if (!["Control", "Shift", "Alt", "Meta"].includes(event.key)) {
    parts.push(keyToAcceleratorPart(event.key, event.code));
  }

  return parts.join("+");
};
