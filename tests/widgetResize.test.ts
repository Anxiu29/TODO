import { describe, expect, it } from "vitest";
import { applyWidgetResizeDelta } from "../src/data/widgetResize";

const start = { x: 100, y: 80, width: 320, height: 400 };

describe("applyWidgetResizeDelta", () => {
  it("grows from the east and south without moving the origin", () => {
    expect(applyWidgetResizeDelta(start, "se", 40, 20, 260, 300)).toEqual({
      x: 100,
      y: 80,
      width: 360,
      height: 420
    });
  });

  it("moves x when shrinking from the west", () => {
    expect(applyWidgetResizeDelta(start, "w", 40, 0, 260, 300)).toEqual({
      x: 140,
      y: 80,
      width: 280,
      height: 400
    });
  });

  it("pins to the minimum instead of flipping past the opposite edge", () => {
    expect(applyWidgetResizeDelta(start, "nw", 200, 200, 260, 300)).toEqual({
      x: 160,
      y: 180,
      width: 260,
      height: 300
    });
  });
});
