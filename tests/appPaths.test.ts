import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { getLoginExecutablePath, migrateLegacyTodos } from "../electron/appPaths";

const tempDirs: string[] = [];

const createTempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "todo-widget-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("getLoginExecutablePath", () => {
  it("uses the portable launcher path when provided", () => {
    expect(
      getLoginExecutablePath(
        "C:/Users/a/AppData/Local/Temp/abc/Desktop Todo Widget.exe",
        "D:/tools/Desktop-Todo-Widget-0.2.0.exe"
      )
    ).toBe("D:/tools/Desktop-Todo-Widget-0.2.0.exe");
  });

  it("falls back to the running exe for install builds", () => {
    expect(
      getLoginExecutablePath("C:/Users/a/AppData/Local/Programs/Desktop Todo Widget/Desktop Todo Widget.exe")
    ).toBe("C:/Users/a/AppData/Local/Programs/Desktop Todo Widget/Desktop Todo Widget.exe");
  });
});

describe("migrateLegacyTodos", () => {
  it("copies todos.json when new path is missing", () => {
    const legacyDir = createTempDir();
    const newDir = createTempDir();
    const legacyData = {
      version: 1,
      lastRefreshDate: "2026-07-08",
      todos: [{ id: "1", title: "旧待办", createdAt: "2026-07-08T00:00:00.000Z", scheduledDate: "2026-07-08", status: "active", rating: 1 }],
      settings: { displayMode: "desktop", launchAtLogin: false, shortcut: "CommandOrControl+2", showWidgetShortcut: "CommandOrControl+1" }
    };

    writeFileSync(join(legacyDir, "todos.json"), JSON.stringify(legacyData));

    migrateLegacyTodos(legacyDir, newDir);

    const migrated = JSON.parse(readFileSync(join(newDir, "todos.json"), "utf8"));
    expect(migrated.todos).toHaveLength(1);
    expect(migrated.todos[0].title).toBe("旧待办");
  });

  it("migrates when new file exists but is empty", () => {
    const legacyDir = createTempDir();
    const newDir = createTempDir();
    writeFileSync(
      join(legacyDir, "todos.json"),
      JSON.stringify({
        version: 1,
        lastRefreshDate: "2026-07-08",
        todos: [{ id: "1", title: "保留", createdAt: "2026-07-08T00:00:00.000Z", scheduledDate: "2026-07-08", status: "active", rating: 1 }],
        settings: {}
      })
    );
    writeFileSync(
      join(newDir, "todos.json"),
      JSON.stringify({
        version: 1,
        lastRefreshDate: "2026-07-08",
        todos: [],
        settings: {}
      })
    );

    migrateLegacyTodos(legacyDir, newDir);

    const migrated = JSON.parse(readFileSync(join(newDir, "todos.json"), "utf8"));
    expect(migrated.todos).toHaveLength(1);
    expect(migrated.todos[0].title).toBe("保留");
  });

  it("does not overwrite new data that already has todos", () => {
    const legacyDir = createTempDir();
    const newDir = createTempDir();
    writeFileSync(
      join(legacyDir, "todos.json"),
      JSON.stringify({
        version: 1,
        lastRefreshDate: "2026-07-08",
        todos: [{ id: "old", title: "旧", createdAt: "2026-07-08T00:00:00.000Z", scheduledDate: "2026-07-08", status: "active", rating: 1 }],
        settings: {}
      })
    );
    writeFileSync(
      join(newDir, "todos.json"),
      JSON.stringify({
        version: 1,
        lastRefreshDate: "2026-07-08",
        todos: [{ id: "new", title: "新", createdAt: "2026-07-08T00:00:00.000Z", scheduledDate: "2026-07-08", status: "active", rating: 1 }],
        settings: {}
      })
    );

    migrateLegacyTodos(legacyDir, newDir);

    const kept = JSON.parse(readFileSync(join(newDir, "todos.json"), "utf8"));
    expect(kept.todos).toHaveLength(1);
    expect(kept.todos[0].title).toBe("新");
  });

  it("migrates install-dir data to appdata when appdata is empty", () => {
    const installDirData = createTempDir();
    const appData = createTempDir();
    writeFileSync(
      join(installDirData, "todos.json"),
      JSON.stringify({
        version: 1,
        lastRefreshDate: "2026-07-08",
        todos: [{ id: "1", title: "安装目录里的待办", createdAt: "2026-07-08T00:00:00.000Z", scheduledDate: "2026-07-08", status: "active", rating: 1 }],
        settings: {}
      })
    );

    migrateLegacyTodos(installDirData, appData);

    const migrated = JSON.parse(readFileSync(join(appData, "todos.json"), "utf8"));
    expect(migrated.todos).toHaveLength(1);
    expect(migrated.todos[0].title).toBe("安装目录里的待办");
  });
});
