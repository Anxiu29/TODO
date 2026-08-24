/**
 * 挂件窗口位置与尺寸约束。
 * 与 BrowserWindow minWidth/minHeight 共用常量，避免 clamp 和创建窗口各写一套导致拖出屏幕。
 */
import type { WindowBounds } from "../types/todo";

/** 与 createWidgetWindow 的 minWidth 对齐；再窄标题栏三按钮会挤爆 */
export const WIDGET_MIN_WIDTH = 260;
/** 与 createWidgetWindow 的 minHeight 对齐；再矮列表/完成区会互相抢高度 */
export const WIDGET_MIN_HEIGHT = 300;
/** 首次启动默认宽度 */
export const WIDGET_DEFAULT_WIDTH = 320;
/** 首次启动默认高度 */
export const WIDGET_DEFAULT_HEIGHT = 460;
/** 默认贴在工作区右侧时，右缘再留出的空隙 */
export const WIDGET_DEFAULT_RIGHT_GAP = 40;
/** 默认距工作区顶边 */
export const WIDGET_DEFAULT_TOP = 72;

/** 显示器工作区（与 Electron Display.workArea 字段一致） */
export type WorkArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * 把窗口矩形限制在工作区内，并保证不小于最小宽高（工作区更小时以工作区为准）。
 * 纯函数，便于单测；主进程再配合 getDisplayNearestPoint 选屏。
 */
export const clampBoundsToWorkArea = (
  bounds: WindowBounds,
  area: WorkArea,
  minWidth = WIDGET_MIN_WIDTH,
  minHeight = WIDGET_MIN_HEIGHT
): WindowBounds => {
  const width = Math.min(Math.max(bounds.width, minWidth), Math.max(area.width, 1));
  const height = Math.min(Math.max(bounds.height, minHeight), Math.max(area.height, 1));
  const maxX = area.x + area.width - width;
  const maxY = area.y + area.height - height;
  const x = Math.min(Math.max(bounds.x, area.x), Math.max(area.x, maxX));
  const y = Math.min(Math.max(bounds.y, area.y), Math.max(area.y, maxY));
  return { x, y, width, height };
};

/** 光标是否落在窗口矩形内（右/下边为半开区间，与桌面巡检一致） */
export const isPointInBounds = (
  point: { x: number; y: number },
  bounds: { x: number; y: number; width: number; height: number }
): boolean =>
  point.x >= bounds.x &&
  point.x < bounds.x + bounds.width &&
  point.y >= bounds.y &&
  point.y < bounds.y + bounds.height;

/** 主屏工作区右上角的默认挂件位置 */
export const defaultWidgetBoundsInWorkArea = (area: WorkArea): WindowBounds =>
  clampBoundsToWorkArea(
    {
      x: area.x + area.width - WIDGET_DEFAULT_WIDTH - WIDGET_DEFAULT_RIGHT_GAP,
      y: area.y + WIDGET_DEFAULT_TOP,
      width: WIDGET_DEFAULT_WIDTH,
      height: WIDGET_DEFAULT_HEIGHT
    },
    area
  );
