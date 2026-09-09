/** 验证输入法确认、长按回车及等待保存时的重复点击。 */
import { expect, it, vi } from "vitest";
import { createSubmissionGate, shouldSubmitOnEnter } from "../src/data/formSubmission";

it("ignores composition, legacy IME keycodes and repeated Enter", () => {
  const enter = { key: "Enter", shiftKey: false, repeat: false };
  expect(shouldSubmitOnEnter(enter)).toBe(true);
  expect(shouldSubmitOnEnter({ ...enter, isComposing: true })).toBe(false);
  expect(shouldSubmitOnEnter({ ...enter, keyCode: 229 })).toBe(false);
  expect(shouldSubmitOnEnter({ ...enter, repeat: true })).toBe(false);
  expect(shouldSubmitOnEnter({ ...enter, shiftKey: true })).toBe(false);
});

it("allows only one in-flight save and unlocks after failure", async () => {
  const gate = createSubmissionGate();
  let reject!: (error: Error) => void;
  const save = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
  const first = gate(save);
  await gate(save);
  expect(save).toHaveBeenCalledTimes(1);
  const rejected = expect(first).rejects.toThrow("disk full");
  reject(new Error("disk full")); await rejected;
  const retry = vi.fn(async () => {}); await gate(retry);
  expect(retry).toHaveBeenCalledTimes(1);
});
