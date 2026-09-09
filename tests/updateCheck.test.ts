/** 模拟更新库同时发出 error 事件与 Promise 拒绝，验证顺序回退及并发保护。 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: true }, BrowserWindow: { getAllWindows: () => [] } }));
vi.mock("electron-updater", async () => {
  const { EventEmitter } = await import("node:events");
  return { default: { autoUpdater: Object.assign(new EventEmitter(), {
    setFeedURL: vi.fn(), checkForUpdates: vi.fn(), downloadUpdate: vi.fn()
  }) } };
});
import electronUpdater from "electron-updater";
import { setupAutoUpdater, checkForUpdates, getUpdateStatus, dismissUpdate } from "../electron/updater";
const updater = electronUpdater.autoUpdater;
const info = { version: "99.0.0", files: [], path: "new.exe", sha512: "fixture", releaseDate: "2026-09-09" };
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); updater.removeAllListeners(); setupAutoUpdater();
  updater.emit("update-not-available", info);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

it("shares a check and falls back once after the first source rejects", async () => {
  vi.mocked(updater.checkForUpdates)
    .mockImplementationOnce(async () => {
      const error = new Error("gitee unavailable"); updater.emit("error", error); throw error;
    })
    .mockImplementationOnce(async () => {
      updater.emit("update-available", info); return null;
    });
  const first = checkForUpdates(); const second = checkForUpdates();
  expect(second).toBe(first);
  expect(await first).toMatchObject({ state: "available", version: "99.0.0" });
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  expect(getUpdateStatus().state).toBe("available");
});

it("preserves a downloaded update when checking again or dismissing", async () => {
  updater.emit("update-downloaded", { ...info, downloadedFile: "new.exe" });
  expect((await checkForUpdates()).state).toBe("downloaded");
  expect(dismissUpdate().state).toBe("downloaded");
  expect(updater.checkForUpdates).not.toHaveBeenCalled();
});

it("reports an error after both sources fail without an event retry loop", async () => {
  vi.mocked(updater.checkForUpdates).mockImplementation(async () => {
    const error = new Error("offline"); updater.emit("error", error); throw error;
  });
  expect(await checkForUpdates()).toMatchObject({ state: "error", message: "offline" });
  expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
});
