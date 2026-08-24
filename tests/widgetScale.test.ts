import { describe, expect, it } from "vitest";
import { isWidgetCompact, WIDGET_CONTENT_SCALE_MIN, widgetContentScale } from "../src/data/widgetScale";
import {
  WIDGET_DEFAULT_HEIGHT,
  WIDGET_DEFAULT_WIDTH,
  WIDGET_MIN_HEIGHT,
  WIDGET_MIN_WIDTH
} from "../src/data/windowBounds";

describe("widgetContentScale", () => {
  it("stays at 1 for the default window size", () => {
    expect(widgetContentScale(WIDGET_DEFAULT_WIDTH, WIDGET_DEFAULT_HEIGHT)).toBe(1);
  });

  it("uses the minimum scale at the smallest window", () => {
    expect(widgetContentScale(WIDGET_MIN_WIDTH, WIDGET_MIN_HEIGHT)).toBe(WIDGET_CONTENT_SCALE_MIN);
  });

  it("does not grow past 1 when the window is larger than default", () => {
    expect(widgetContentScale(480, 720)).toBe(1);
  });
});

describe("isWidgetCompact", () => {
  it("turns on below 300px so header actions stay visible", () => {
    expect(isWidgetCompact(260)).toBe(true);
    expect(isWidgetCompact(320)).toBe(false);
  });
});
