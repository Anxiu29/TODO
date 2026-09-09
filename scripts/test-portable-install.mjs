/**
 * 验证生产安装脚本的准备阶段：复制新版且保留旧版，不许可退出、不启动任何 exe。
 * 用法：node scripts/test-portable-install.mjs
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// 直接加载生产生成器，避免测试维护一份已过时的安装脚本。
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "electron/portableUpdate.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { buildPortableInstallScript } = await import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"));
const work = mkdtempSync(join(tmpdir(), "todo-update-check-"));
const paths = {
  source: join(work, "download.exe"), target: join(work, "new.exe"), oldExe: join(work, "old.exe"),
  script: join(work, "install.vbs"), ready: join(work, "ready"), proceed: join(work, "go"),
  log: join(work, "install.log"), processId: process.pid
};
let child;
let exited;
try {
  writeFileSync(paths.source, "new version fixture");
  writeFileSync(paths.oldExe, "old version fixture");
  // UTF-16 可让诊断运行在中文临时目录；生产路径策略仍由 updater 检查。
  writeFileSync(paths.script, "﻿" + buildPortableInstallScript(paths), "utf16le");
  child = spawn("wscript.exe", ["//B", "//Nologo", paths.script], { windowsHide: true, stdio: "ignore" });
  let failure;
  child.on("error", (error) => { failure = error; });
  exited = new Promise((resolve) => child.once("close", resolve));
  const deadline = Date.now() + 10000;
  while (!existsSync(paths.ready) && !failure && child.exitCode === null && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (failure) throw failure;
  if (!existsSync(paths.ready)) throw new Error("安装脚本没有进入就绪状态");
  if (readFileSync(paths.target, "utf8") !== "new version fixture") throw new Error("新版复制失败");
  if (readFileSync(paths.oldExe, "utf8") !== "old version fixture") throw new Error("旧版被改动");
  if (existsSync(paths.proceed)) throw new Error("测试不得许可启动应用");
  console.log("PASS: production installer prepared new copy and retained old exe; launch was not authorized");
} finally {
  // 仅终止本测试创建的脚本；等待它退出后再清理唯一临时目录。
  if (child && child.exitCode === null) child.kill();
  if (exited) await exited;
  rmSync(work, { recursive: true, force: true });
}
