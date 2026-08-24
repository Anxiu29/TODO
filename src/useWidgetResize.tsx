/**
 * 挂件边缘/角落拖拽缩放。
 * 会话立刻用当前窗口矩形开始，不等 begin IPC；detach 触发的 pointercancel 不结束缩放。
 */
import { useEffect, useRef } from "react";
import type React from "react";
import {
  applyWidgetResizeDelta,
  type WidgetResizeEdge
} from "./data/widgetResize";
import { WIDGET_MIN_HEIGHT, WIDGET_MIN_WIDTH } from "./data/windowBounds";
import type { WindowBounds } from "./types/todo";

const RESIZE_EDGES: Array<{ edge: WidgetResizeEdge; label: string }> = [
  { edge: "n", label: "向上调整大小" },
  { edge: "s", label: "向下调整大小" },
  { edge: "e", label: "向右调整大小" },
  { edge: "w", label: "向左调整大小" },
  { edge: "ne", label: "向右上调整大小" },
  { edge: "nw", label: "向左上调整大小" },
  { edge: "se", label: "向右下调整大小" },
  { edge: "sw", label: "向左下调整大小" }
];

type ResizeSession = {
  edge: WidgetResizeEdge;
  start: WindowBounds;
  originX: number;
  originY: number;
};

const currentWindowBounds = (): WindowBounds => ({
  x: window.screenX,
  y: window.screenY,
  width: window.outerWidth,
  height: window.outerHeight
});

/** 在 widget-card 内铺八向热区；拖动时同步窗口矩形 */
export const WidgetResizeHandles = (): React.ReactElement => {
  const sessionRef = useRef<ResizeSession | null>(null);
  const pendingRef = useRef(false);
  const frameRef = useRef(0);
  const pendingBoundsRef = useRef<WindowBounds | null>(null);
  const handleRef = useRef<HTMLDivElement | null>(null);
  const pointerIdRef = useRef<number | null>(null);

  const flushBounds = (): void => {
    frameRef.current = 0;
    const next = pendingBoundsRef.current;
    if (!next) return;
    window.todoApi.resizeWidgetTo(next);
  };

  const recapture = (): void => {
    const handle = handleRef.current;
    const pointerId = pointerIdRef.current;
    if (!handle || pointerId === null || !pendingRef.current) return;
    try {
      handle.setPointerCapture(pointerId);
    } catch {
      // detach 后句柄可能暂时无效，下一帧再试
    }
  };

  const endResize = (): void => {
    if (!pendingRef.current && !sessionRef.current) return;
    pendingRef.current = false;
    sessionRef.current = null;
    handleRef.current = null;
    pointerIdRef.current = null;
    if (frameRef.current) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    }
    if (pendingBoundsRef.current) {
      window.todoApi.resizeWidgetTo(pendingBoundsRef.current);
      pendingBoundsRef.current = null;
    }
    void window.todoApi.endWidgetResize();
  };

  useEffect(() => {
    const onBlur = (): void => endResize();
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, []);

  const onPointerDown =
    (edge: WidgetResizeEdge) =>
    (event: React.PointerEvent<HTMLDivElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      handleRef.current = event.currentTarget;
      pointerIdRef.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      pendingRef.current = true;
      sessionRef.current = {
        edge,
        start: currentWindowBounds(),
        originX: event.screenX,
        originY: event.screenY
      };
      void window.todoApi.beginWidgetResize().then((start) => {
        // 还没拖过时用主进程 bounds 校正；已经在拖则不能换起点，否则窗口会跳
        if (!start || !sessionRef.current || pendingBoundsRef.current) return;
        sessionRef.current.start = start;
      });
    };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const session = sessionRef.current;
    if (!session) return;
    pendingBoundsRef.current = applyWidgetResizeDelta(
      session.start,
      session.edge,
      event.screenX - session.originX,
      event.screenY - session.originY,
      WIDGET_MIN_WIDTH,
      WIDGET_MIN_HEIGHT
    );
    if (!frameRef.current) {
      frameRef.current = window.requestAnimationFrame(flushBounds);
    }
  };

  return (
    <>
      {RESIZE_EDGES.map(({ edge, label }) => (
        <div
          key={edge}
          className={`widget-resize-handle widget-resize-${edge} no-drag`}
          role="separator"
          aria-label={label}
          onPointerDown={onPointerDown(edge)}
          onPointerMove={onPointerMove}
          onPointerUp={endResize}
          onPointerCancel={recapture}
          onLostPointerCapture={recapture}
        />
      ))}
    </>
  );
};
