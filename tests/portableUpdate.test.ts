/** 模拟安装脚本交接：脚本未就绪、执行失败和超时不能让主程序退出。 */
import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { buildPortableInstallScript, preparePortableInstall, type PortableInstallPaths } from "../electron/portableUpdate";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), exists: vi.fn(), write: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("node:fs", () => ({ existsSync: mocks.exists, writeFileSync: mocks.write }));
const paths: PortableInstallPaths = {
  source: "C:\\cache\\new.exe", target: "C:\\My App\\new.exe", oldExe: "C:\\My App\\old.exe",
  script: "install.vbs", log: "log", ready: "ready", proceed: "go", processId: 1234
};
const start = () => {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
  mocks.spawn.mockReturnValue(child); mocks.exists.mockReturnValue(false);
  return { child, promise: preparePortableInstall(paths) };
};
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.resetAllMocks(); });

it("retains old executables and quotes launch paths containing spaces", () => {
  const script = buildPortableInstallScript(paths);
  expect(script).not.toContain("DeleteFile");
  expect(script).not.toContain("f.Delete");
  expect(script).toContain('sh.Run """C:\\My App\\new.exe""", 1, False');
  expect(script).toContain('sh.Run """C:\\My App\\old.exe""", 1, False');
  expect(script.indexOf("fso.CopyFile")).toBeLessThan(script.indexOf("CreateTextFile"));
});
it("waits for readiness before sending exit permission", async () => {
  const { promise } = start();
  await vi.advanceTimersByTimeAsync(200); expect(mocks.write).not.toHaveBeenCalled();
  mocks.exists.mockReturnValue(true);
  await vi.advanceTimersByTimeAsync(100); await promise;
  expect(mocks.write).toHaveBeenCalledWith("go", "proceed", "ascii");
});
it("rejects a missing or disabled script host", async () => {
  const { child, promise } = start(); const assertion = expect(promise).rejects.toThrow("ENOENT");
  child.emit("error", new Error("ENOENT")); await assertion;
  expect(mocks.write).not.toHaveBeenCalled();
});
it("rejects an early script exit", async () => {
  const { child, promise } = start(); const assertion = expect(promise).rejects.toThrow("提前退出");
  child.emit("exit", 1); await assertion;
  expect(mocks.write).not.toHaveBeenCalled();
});
it("times out without permission to exit or launch", async () => {
  const { promise } = start(); const assertion = expect(promise).rejects.toThrow("超时");
  await vi.advanceTimersByTimeAsync(60_000); await assertion;
  expect(mocks.write).not.toHaveBeenCalled();
});
