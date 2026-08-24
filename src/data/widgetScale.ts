/**
 * 挂件内容缩放：窗口小于默认尺寸时把字号/间距一起收，避免挤成一团。
 */
import {
  WIDGET_DEFAULT_HEIGHT,
  WIDGET_DEFAULT_WIDTH,
  WIDGET_MIN_HEIGHT,
  WIDGET_MIN_WIDTH
} from "./windowBounds";

/** 缩到最小窗时的内容倍率；再小会看不清按钮 */
export const WIDGET_CONTENT_SCALE_MIN = 0.82;
/** 窄于此宽度进入紧凑布局：藏底栏长提示，标题可省略 */
export const WIDGET_COMPACT_WIDTH = 300;

/** 窄窗时收起次要文案，避免挤掉关闭/添加按钮 */
export const isWidgetCompact = (width: number): boolean => width < WIDGET_COMPACT_WIDTH;

/**
 * 按当前宽高在默认尺寸与最小尺寸之间插值。
 * 不大于 1：放大窗口不放大内容。
 */
export const widgetContentScale = (width: number, height: number): number => {
  const spanWidth = WIDGET_DEFAULT_WIDTH - WIDGET_MIN_WIDTH;
  const spanHeight = WIDGET_DEFAULT_HEIGHT - WIDGET_MIN_HEIGHT;
  const tWidth = spanWidth <= 0 ? 1 : (width - WIDGET_MIN_WIDTH) / spanWidth;
  const tHeight = spanHeight <= 0 ? 1 : (height - WIDGET_MIN_HEIGHT) / spanHeight;
  const t = Math.min(1, Math.max(0, Math.min(tWidth, tHeight)));
  return WIDGET_CONTENT_SCALE_MIN + (1 - WIDGET_CONTENT_SCALE_MIN) * t;
};
