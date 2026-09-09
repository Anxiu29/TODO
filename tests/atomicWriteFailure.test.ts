/** 模拟 Windows 文件占用，验证替换失败不会覆盖旧库或丢失待恢复副本。 */
import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileAtomicSync } from "../electron/atomicWrite";

vi.mock("node:fs", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs")>(),
  renameSync: vi.fn(() => { throw Object.assign(new Error("文件被占用"), { code: "EPERM" }); })
}));

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

it("preserves the original and each recovery copy when replacement fails", () => {
  const dir = mkdtempSync(join(tmpdir(), "todo-write-failure-"));
  dirs.push(dir);
  const target = join(dir, "todos.json");
  writeFileSync(target, "original");
  expect(() => writeFileAtomicSync(target, "first change")).toThrow("文件被占用");
  expect(() => writeFileAtomicSync(target, "second change")).toThrow("文件被占用");
  expect(readFileSync(target, "utf8")).toBe("original");
  const copies = readdirSync(dir).filter((name) => name.endsWith(".tmp"));
  expect(copies).toHaveLength(2);
  expect(copies.map((name) => readFileSync(join(dir, name), "utf8")).sort()).toEqual(["first change", "second change"]);
});
