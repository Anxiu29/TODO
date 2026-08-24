import { describe, expect, it } from "vitest";
import {
  clampBoundsToWorkArea,
  defaultWidgetBoundsInWorkArea,
  isPointInBounds,
  WIDGET_DEFAULT_HEIGHT,
  WIDGET_DEFAULT_WIDTH,
  WIDGET_MIN_HEIGHT,
  WIDGET_MIN_WIDTH
} from "../src/data/windowBounds";

const area = { x: 0, y: 0, width: 1920, height: 1040 };

describe("clampBoundsToWorkArea", () => {
  it("keeps an on-screen rectangle unchanged", () => {
    expect(clampBoundsToWorkArea({ x: 100, y: 80, width: 320, height: 460 }, area)).toEqual({
      x: 100,
      y: 80,
      width: 320,
      height: 460
    });
  });

  it("pulls a window back when it sits past the right or bottom edge", () => {
    expect(clampBoundsToWorkArea({ x: 5000, y: 4000, width: 320, height: 460 }, area)).toEqual({
      x: 1920 - 320,
      y: 1040 - 460,
      width: 320,
      height: 460
    });
  });

  it("enforces the widget minimum size", () => {
    const next = clampBoundsToWorkArea({ x: 10, y: 10, width: 40, height: 40 }, area);
    expect(next.width).toBe(WIDGET_MIN_WIDTH);
    expect(next.height).toBe(WIDGET_MIN_HEIGHT);
  });

  it("shrinks to the work area when the display is smaller than the minimum", () => {
    const tiny = { x: 0, y: 0, width: 200, height: 300 };
    expect(clampBoundsToWorkArea({ x: -20, y: -20, width: 400, height: 500 }, tiny)).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 300
    });
  });
});

describe("defaultWidgetBoundsInWorkArea", () => {
  it("places the widget on the top-right of the work area", () => {
    const bounds = defaultWidgetBoundsInWorkArea(area);
    expect(bounds.width).toBe(WIDGET_DEFAULT_WIDTH);
    expect(bounds.height).toBe(WIDGET_DEFAULT_HEIGHT);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(area.width);
    expect(bounds.y).toBeGreaterThanOrEqual(area.y);
  });
});

describe("isPointInBounds", () => {
  it("treats the right and bottom edges as outside", () => {
    const bounds = { x: 10, y: 20, width: 100, height: 50 };
    expect(isPointInBounds({ x: 10, y: 20 }, bounds)).toBe(true);
    expect(isPointInBounds({ x: 109, y: 69 }, bounds)).toBe(true);
    expect(isPointInBounds({ x: 110, y: 40 }, bounds)).toBe(false);
    expect(isPointInBounds({ x: 50, y: 70 }, bounds)).toBe(false);
  });
});
