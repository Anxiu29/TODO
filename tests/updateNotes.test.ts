import { describe, expect, it } from "vitest";
import { htmlToPlainText, parseReleaseNotes } from "../src/updateNotes";

describe("htmlToPlainText", () => {
  it("strips tags and keeps list structure", () => {
    expect(htmlToPlainText("<h2>新增</h2><ul><li>日切</li><li>原子写</li></ul>")).toBe("新增\n• 日切\n• 原子写");
  });

  it("decodes entities after stripping tags", () => {
    expect(htmlToPlainText("<p>A &amp; B</p>")).toBe("A & B");
  });
});

describe("parseReleaseNotes", () => {
  it("treats a heading plus bullets as one section", () => {
    expect(parseReleaseNotes("新增\n• 日切巡检\n- 原子写盘")).toEqual([
      { title: "新增", items: ["日切巡检", "原子写盘"], paragraphs: [] }
    ]);
  });

  it("turns a lone heading into a paragraph", () => {
    expect(parseReleaseNotes("当前已是最新版本")).toEqual([
      { items: [], paragraphs: ["当前已是最新版本"] }
    ]);
  });
});
