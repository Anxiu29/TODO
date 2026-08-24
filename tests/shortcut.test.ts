import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUICK_ADD_SHORTCUT,
  DEFAULT_SHOW_WIDGET_SHORTCUT,
  eventToShortcut,
  formatShortcut,
  keyToAcceleratorPart,
  normalizeShortcut,
  shortcutCandidateList
} from "../src/data/shortcut";

describe("normalizeShortcut", () => {
  it("maps ctrl aliases to CommandOrControl and uppercases the key", () => {
    expect(normalizeShortcut("ctrl+alt+t")).toBe("CommandOrControl+Alt+T");
    expect(normalizeShortcut("Control+2")).toBe("CommandOrControl+2");
    expect(normalizeShortcut("  CmdOrCtrl + Shift + n  ")).toBe("CommandOrControl+Shift+N");
  });

  it("keeps Electron-style input stable", () => {
    expect(normalizeShortcut(DEFAULT_QUICK_ADD_SHORTCUT)).toBe(DEFAULT_QUICK_ADD_SHORTCUT);
    expect(normalizeShortcut(DEFAULT_SHOW_WIDGET_SHORTCUT)).toBe(DEFAULT_SHOW_WIDGET_SHORTCUT);
  });
});

describe("formatShortcut", () => {
  it("turns accelerators into readable Ctrl labels", () => {
    expect(formatShortcut("CommandOrControl+Alt+T")).toBe("Ctrl + Alt + T");
    expect(formatShortcut(undefined, DEFAULT_SHOW_WIDGET_SHORTCUT)).toBe("Ctrl + 1");
  });
});

describe("eventToShortcut", () => {
  it("ignores modifier-only keydowns", () => {
    expect(
      eventToShortcut({
        key: "Control",
        code: "ControlLeft",
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false
      })
    ).toBe("CommandOrControl");
  });

  it("combines modifiers with the main key", () => {
    expect(
      eventToShortcut({
        key: "t",
        code: "KeyT",
        ctrlKey: true,
        metaKey: false,
        altKey: true,
        shiftKey: false
      })
    ).toBe("CommandOrControl+Alt+T");
  });
});

describe("keyToAcceleratorPart", () => {
  it("maps space, arrows and numpad", () => {
    expect(keyToAcceleratorPart(" ", "Space")).toBe("Space");
    expect(keyToAcceleratorPart("ArrowDown", "ArrowDown")).toBe("Down");
    // 数字键优先于 Numpad code，避免把主键盘 5 写成 num5
    expect(keyToAcceleratorPart("5", "Numpad5")).toBe("5");
    expect(keyToAcceleratorPart("Enter", "NumpadEnter")).toBe("numEnter");
  });
});

describe("shortcutCandidateList", () => {
  it("only tries the requested combo when the user just set one", () => {
    expect(shortcutCandidateList("CommandOrControl+3", true)).toEqual(["CommandOrControl+3"]);
  });

  it("appends fallbacks and drops duplicates on startup", () => {
    expect(shortcutCandidateList(DEFAULT_QUICK_ADD_SHORTCUT, false)[0]).toBe(DEFAULT_QUICK_ADD_SHORTCUT);
    expect(new Set(shortcutCandidateList(DEFAULT_QUICK_ADD_SHORTCUT, false)).size).toBe(
      shortcutCandidateList(DEFAULT_QUICK_ADD_SHORTCUT, false).length
    );
  });
});
