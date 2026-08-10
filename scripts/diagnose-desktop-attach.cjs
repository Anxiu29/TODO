/**
 * 诊断桌面固定能力：分别测试「Node 直接调 user32」与「PowerShell 调 user32」。
 * 在资源管理器可见的桌面环境下运行：npm run diagnose:desktop
 *
 * Win11 24H2 起 WorkerW 多为 Progman 子窗口，不再是顶层 sibling。
 */
const { spawn } = require("node:child_process");
const koffi = require("koffi");

const user32 = koffi.load("user32.dll");
koffi.alias("HWND", "void *");

const FindWindowW = user32.func("HWND __stdcall FindWindowW(str16 _lpClassName, str16 _lpWindowName)");
const FindWindowExW = user32.func(
  "HWND __stdcall FindWindowExW(HWND hWndParent, HWND hWndChildAfter, str16 lpszClass, str16 lpszWindow)"
);
const SendMessageTimeoutW = user32.func(
  "uintptr_t __stdcall SendMessageTimeoutW(HWND hWnd, uint32 Msg, uintptr_t wParam, intptr_t lParam, uint32 fuFlags, uint32 uTimeout, _Out_ uintptr_t *lpdwResult)"
);

const spawnWorker = (progman, wParam, lParam) => {
  const resultPtr = koffi.alloc("uintptr_t", 1);
  SendMessageTimeoutW(progman, 0x052c, wParam, lParam, 0, 1000, resultPtr);
  koffi.free(resultPtr);
};

const findSiblingWorkerW = () => {
  let current = null;
  while (true) {
    current = FindWindowExW(null, current, "WorkerW", null);
    if (!current) break;
    const shellView = FindWindowExW(current, null, "SHELLDLL_DefView", null);
    if (shellView) {
      return FindWindowExW(null, current, "WorkerW", null);
    }
  }
  return null;
};

const inspectDesktop = () => {
  const progman = FindWindowW("Progman", null);
  if (!progman) {
    return {
      ok: false,
      detail: "Progman=未找到（Explorer 桌面 shell 不可用）"
    };
  }

  for (const [w, l] of [
    [0, 0],
    [0xd, 0],
    [0xd, 1]
  ]) {
    spawnWorker(progman, w, l);
  }

  const siblingWorkerW = findSiblingWorkerW();
  const childDefView = FindWindowExW(progman, null, "SHELLDLL_DefView", null);
  const childWorkerW = FindWindowExW(progman, null, "WorkerW", null);

  const layout = siblingWorkerW
    ? "经典顶层 sibling WorkerW（Win10 / 部分 Win11）"
    : childWorkerW
      ? "Progman 子窗口 WorkerW（Win11 24H2 系统壁纸常见）"
      : childDefView
        ? "仅有 Progman+DefView，无 WorkerW"
        : "未识别到可用桌面层";

  const ok = Boolean(siblingWorkerW || childWorkerW || childDefView);
  return {
    ok,
    detail: [
      `Progman=找到`,
      `siblingWorkerW=${siblingWorkerW ? "找到" : "无"}`,
      `childWorkerW=${childWorkerW ? "找到" : "无"}`,
      `childDefView=${childDefView ? "找到" : "无"}`,
      `布局=${layout}`
    ].join(", ")
  };
};

const testPowerShell = () =>
  new Promise((resolve) => {
    const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32Desktop {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
}
"@
$progman = [Win32Desktop]::FindWindow("Progman", $null)
if ($progman -eq [IntPtr]::Zero) { exit 2 }
exit 0
`;

    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
    );

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolve({ ok: false, detail: `无法启动 PowerShell: ${error.message}` });
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ ok: true, detail: "PowerShell 可调用 user32.dll，Progman 已找到" });
        return;
      }

      resolve({
        ok: false,
        detail:
          code === 2
            ? "PowerShell 能运行，但未找到 Progman（桌面 shell 可能未就绪）"
            : `PowerShell 退出码 ${code}${stderr ? `，错误: ${stderr.trim()}` : ""}`
      });
    });
  });

const printSection = (title, result) => {
  const status = result.ok ? "通过" : "失败";
  console.log(`\n[${status}] ${title}`);
  console.log(`  ${result.detail}`);
};

const main = async () => {
  console.log("桌面固定诊断（请在正常桌面环境下运行）");
  console.log("=".repeat(48));

  printSection("Node 直接调用 user32.dll（应用将使用此方式）", inspectDesktop());
  printSection("PowerShell 调用 user32.dll（旧方式）", await testPowerShell());

  console.log("\n解读：");
  console.log("  - Win11 24H2 应看到 childWorkerW=找到（Progman 子窗口），应用已支持该路径；");
  console.log("  - 若 sibling / child WorkerW 皆无，桌面固定会失败；");
  console.log("  - 改完代码后请重启应用，并在设置里选「固定在桌面（系统壁纸）」再试 Win+D。");
};

void main();
