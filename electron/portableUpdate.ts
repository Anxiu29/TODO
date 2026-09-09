/** 便携更新交接：复制成功后通知主进程，收到退出许可才启动新版，始终保留旧版。 */
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";

/** VBS 字符串字面量；命令行路径仍需额外保留一层引号。 */
const quote = (value: string): string => `"${value.replace(/"/g, '""')}"`;

/** 所有控制文件位于本次更新的唯一目录，避免上一次残留被误认成成功。 */
export type PortableInstallPaths = {
  source: string; target: string; oldExe: string;
  script: string; log: string; ready: string; proceed: string;
  /** 当前 Electron 主进程，脚本必须等它退出才能启动新版。 */
  processId: number;
};

/** 生成有错误检查的安装脚本：不枚举或删除程序目录中的任何 exe。 */
export const buildPortableInstallScript = (paths: PortableInstallPaths): string => [
  "Option Explicit",
  "Dim sh, fso, logFile, marker, attempt, failure, processes",
  'Set sh = CreateObject("WScript.Shell")',
  'Set fso = CreateObject("Scripting.FileSystemObject")',
  // WMI 不可用时脚本会在就绪前退出，主程序保持运行。
  'Set processes = GetObject("winmgmts:\\\\.\\root\\cimv2")',
  `Set logFile = fso.OpenTextFile(${quote(paths.log)}, 8, True)`,
  'logFile.WriteLine Now & " preparing"',
  // 仅在具体操作周围暂时忽略错误，并立即读取和清除错误状态。
  "On Error Resume Next",
  `fso.CopyFile ${quote(paths.source)}, ${quote(paths.target)}, True`,
  "failure = Err.Number",
  'If failure <> 0 Then logFile.WriteLine Now & " copy failed: " & Err.Description',
  "On Error GoTo 0",
  "If failure <> 0 Then WScript.Quit 1",
  `Set marker = fso.CreateTextFile(${quote(paths.ready)}, True)`,
  'marker.WriteLine "ready"',
  "marker.Close",
  // 当前程序未许可退出时，脚本不得自行启动新实例。
  "For attempt = 1 To 300",
  `  If fso.FileExists(${quote(paths.proceed)}) Then Exit For`,
  "  WScript.Sleep 100",
  "Next",
  `If Not fso.FileExists(${quote(paths.proceed)}) Then WScript.Quit 2`,
  // 不靠固定延迟猜测退出速度，避免新版撞上尚未释放的单实例锁。
  "For attempt = 1 To 600",
  `  If processes.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE ProcessId = ${paths.processId}").Count = 0 Then Exit For`,
  "  WScript.Sleep 100",
  "Next",
  "If attempt > 600 Then",
  '  logFile.WriteLine Now & " previous process still running; launch cancelled"',
  "  WScript.Quit 3",
  "End If",
  "On Error Resume Next",
  `sh.Run ${quote(`"${paths.target}"`)}, 1, False`,
  "failure = Err.Number",
  "If failure <> 0 Then",
  '  logFile.WriteLine Now & " launch failed: " & Err.Description',
  "  Err.Clear",
  // 新版无法创建进程时尝试恢复旧版；即使恢复失败旧 exe 也始终可手动运行。
  `  sh.Run ${quote(`"${paths.oldExe}"`)}, 1, False`,
  '  If Err.Number <> 0 Then logFile.WriteLine Now & " rollback launch failed: " & Err.Description',
  "Else",
  '  logFile.WriteLine Now & " launch requested; previous version retained"',
  "End If",
  "On Error GoTo 0",
  "logFile.Close"
].join("\r\n");

/** 等到复制成功标记才许可退出；进程错误、脚本退出和超时均拒绝交接。 */
export const preparePortableInstall = (paths: PortableInstallPaths): Promise<void> => new Promise((resolve, reject) => {
  const child = spawn("wscript.exe", ["//B", "//Nologo", paths.script], {
    detached: true, stdio: "ignore", windowsHide: true
  });
  let settled = false;
  const finish = (error?: Error): void => {
    if (settled) return;
    settled = true;
    clearInterval(poll);
    clearTimeout(timeout);
    if (error) reject(error); else resolve();
  };
  const poll = setInterval(() => {
    if (!existsSync(paths.ready)) return;
    try {
      writeFileSync(paths.proceed, "proceed", "ascii");
      finish();
    } catch (error) { finish(error as Error); }
  }, 100);
  const timeout = setTimeout(() => finish(new Error("更新准备超时，当前程序保持运行；旧版未删除。")), 60_000);
  child.once("error", (error) => finish(error));
  child.once("exit", (code) => finish(new Error(`安装脚本提前退出（${code}），请查看 ${paths.log}`)));
  child.unref();
});
