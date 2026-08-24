/**
 * 挂件自定义缩放：按边/角把起点矩形换成新 bounds。
 * Electron 透明窗在 Windows 上没有系统缩放边，渲染层拖热区后用这套纯函数算尺寸。
 */
import type { WindowBounds } from "../types/todo";

/** 八向缩放热区 */
export type WidgetResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/**
 * 按指针位移改宽高；西/北边收缩时同步移动原点，避免窗口往反方向跳。
 * 小于 min 时钉在下限，不再继续挪 x/y。
 */
export const applyWidgetResizeDelta = (
  start: WindowBounds,
  edge: WidgetResizeEdge,
  deltaX: number,
  deltaY: number,
  minWidth: number,
  minHeight: number
): WindowBounds => {
  let width = start.width;
  let height = start.height;
  let x = start.x;
  let y = start.y;

  if (edge.includes("e")) {
    width = Math.max(minWidth, start.width + deltaX);
  }
  if (edge.includes("w")) {
    width = Math.max(minWidth, start.width - deltaX);
    x = start.x + start.width - width;
  }
  if (edge.includes("s")) {
    height = Math.max(minHeight, start.height + deltaY);
  }
  if (edge.includes("n")) {
    height = Math.max(minHeight, start.height - deltaY);
    y = start.y + start.height - height;
  }

  return { x, y, width, height };
};
