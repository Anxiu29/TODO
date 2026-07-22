/**
 * 外观同步：把主题与透明度写到 document，供 styles.css 中的
 * `[data-theme]` / `--widget-opacity` 生效。四个窗口共用此逻辑。
 */
import type { AppSettings } from "./types/todo";
import { normalizeWidgetOpacity, normalizeWidgetTheme } from "./types/todo";

/** 应用外观设置；settings 缺失时回退到深色 + 默认透明度 */
export const applyAppearance = (settings: Pick<AppSettings, "theme" | "widgetOpacity"> | null | undefined): void => {
  const theme = normalizeWidgetTheme(settings?.theme);
  const opacity = normalizeWidgetOpacity(settings?.widgetOpacity);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.setProperty("--widget-opacity", String(opacity));
};
