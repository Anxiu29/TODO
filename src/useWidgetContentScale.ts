/**
 * 按窗口尺寸写 --widget-scale / data-compact。
 * 直接改 DOM，避免 resize 时整页待办列表跟着重渲染造成卡顿。
 */
import { useEffect, type RefObject } from "react";
import { isWidgetCompact, widgetContentScale } from "./data/widgetScale";

const applyLayout = (el: HTMLElement): void => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  el.style.setProperty("--widget-scale", String(widgetContentScale(width, height)));
  if (isWidgetCompact(width)) {
    el.dataset.compact = "true";
  } else {
    delete el.dataset.compact;
  }
};

/** 用 innerWidth/Height，与 Electron 窗口客户区一致 */
export const useWidgetContentScale = (cardRef: RefObject<HTMLElement | null>): void => {
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    let frame = 0;
    applyLayout(el);

    const onResize = (): void => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (cardRef.current) applyLayout(cardRef.current);
      });
    };

    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [cardRef]);
};
