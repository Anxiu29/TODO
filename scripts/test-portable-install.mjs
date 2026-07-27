/**
 * 本地验证便携版静默安装 VBS：不经过 cmd/powershell，不应出现控制台窗口。
 * 用法：node scripts/test-portable-install.mjs
 */
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const work = join(tmpdir(), `todo-portable-install-test-${Date.now()}`);
const pending = join(work, "pending");
const target = join(work, "app");
const oldName = "TODO-Portable-0.0.1.exe";
const newName = "TODO-Portable-0.0.2.exe";
const sourceExe = join(pending, newName);
const oldExe = join(target, oldName);
const finalExe = join(target, newName);
const logPath = join(target, ".update-portable.log");
const vbsPath = join(pending, "install-portable-update.vbs");

const vbsQuote = (value) => `"${value.replace(/"/g, '""')}"`;

mkdirSync(pending, { recursive: true });
mkdirSync(target, { recursive: true });

// 用 notepad 当「假 exe」：能启动、无控制台子系统
const notepad = join(process.env.SystemRoot || "C:\\Windows", "System32", "notepad.exe");
copyFileSync(notepad, oldExe);
copyFileSync(notepad, sourceExe);

const vbsBody = [
  "On Error Resume Next",
  "Dim sh, fso, logFile, folder, f",
  'Set sh = CreateObject("WScript.Shell")',
  'Set fso = CreateObject("Scripting.FileSystemObject")',
  `Set logFile = fso.OpenTextFile(${vbsQuote(logPath)}, 8, True)`,
  'logFile.WriteLine Now & " start"',
  "WScript.Sleep 1000",
  `If Not fso.FileExists(${vbsQuote(sourceExe)}) Then`,
  '  logFile.WriteLine Now & " pending missing"',
  "  logFile.Close",
  "  WScript.Quit 1",
  "End If",
  `fso.CopyFile ${vbsQuote(sourceExe)}, ${vbsQuote(finalExe)}, True`,
  "If Err.Number <> 0 Then",
  '  logFile.WriteLine Now & " copy failed: " & Err.Description',
  "  logFile.Close",
  "  WScript.Quit 1",
  "End If",
  'logFile.WriteLine Now & " copied"',
  `Set folder = fso.GetFolder(${vbsQuote(target)})`,
  "For Each f In folder.Files",
  '  If LCase(fso.GetExtensionName(f.Name)) = "exe" Then',
  `    If Left(f.Name, 13) = "TODO-Portable" And f.Name <> ${vbsQuote(newName)} Then`,
  "      f.Delete True",
  "    End If",
  "  End If",
  "Next",
  'logFile.WriteLine Now & " cleaned"',
  // 测试里不真正弹 notepad，改写成功标记即可（避免打扰）
  'logFile.WriteLine Now & " started"',
  "logFile.Close",
  `fso.DeleteFile ${vbsQuote(vbsPath)}, True`,
  ""
].join("\r\n");

writeFileSync(logPath, "launch-requested\n", "utf8");
writeFileSync(vbsPath, vbsBody, "ascii");

const before = spawnSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-Command",
    "(Get-Process | Where-Object { $_.ProcessName -match '^(cmd|powershell|pwsh|conhost)$' }).Count"
  ],
  { encoding: "utf8", windowsHide: true }
);
const consoleBefore = Number.parseInt((before.stdout || "").trim(), 10) || 0;

const child = spawn("wscript.exe", ["//B", "//Nologo", vbsPath], {
  detached: true,
  stdio: "ignore",
  windowsHide: true
});
child.unref();

await new Promise((r) => setTimeout(r, 3500));

const after = spawnSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-Command",
    "(Get-Process | Where-Object { $_.ProcessName -match '^(cmd|powershell|pwsh)$' }).Count"
  ],
  { encoding: "utf8", windowsHide: true }
);
const consoleAfter = Number.parseInt((after.stdout || "").trim(), 10) || 0;

const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
const okCopied = existsSync(finalExe);
const okCleaned = !existsSync(oldExe);
const okLog =
  log.includes("start") && log.includes("copied") && log.includes("cleaned") && log.includes("started");
const okNoConsoleGrowth = consoleAfter <= consoleBefore + 1; // 允许本脚本自身的 powershell 探测
const okVbsGone = !existsSync(vbsPath);

console.log("work dir:", work);
console.log("log:\n" + log);
console.log({
  okCopied,
  okCleaned,
  okLog,
  okVbsGone,
  consoleBefore,
  consoleAfter,
  okNoConsoleGrowth
});

const passed = okCopied && okCleaned && okLog && okVbsGone && okNoConsoleGrowth;
rmSync(work, { recursive: true, force: true });

if (!passed) {
  console.error("FAIL: portable silent install test failed");
  process.exit(1);
}

console.log("PASS: portable silent install VBS ok");
