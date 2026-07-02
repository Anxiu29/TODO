import { spawn } from "node:child_process";
import type { BrowserWindow } from "electron";

const readHwnd = (window: BrowserWindow): string => {
  const handle = window.getNativeWindowHandle();
  return process.arch === "x64" ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE());
};

export const attachWindowToDesktop = async (window: BrowserWindow): Promise<boolean> => {
  if (process.platform !== "win32") {
    return false;
  }

  const hwnd = readHwnd(window);
  const script = `
param([IntPtr]$targetHwnd)

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class Win32Desktop {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr FindWindowEx(IntPtr parentHandle, IntPtr childAfter, string className, string windowTitle);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr SetParent(IntPtr child, IntPtr newParent);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
}
"@

$progman = [Win32Desktop]::FindWindow("Progman", $null)
$result = [IntPtr]::Zero
[Win32Desktop]::SendMessageTimeout($progman, 0x052C, [IntPtr]::Zero, [IntPtr]::Zero, 0, 1000, [ref]$result) | Out-Null

$workerw = [IntPtr]::Zero
$current = [IntPtr]::Zero
do {
  $current = [Win32Desktop]::FindWindowEx([IntPtr]::Zero, $current, "WorkerW", $null)
  $shellView = [Win32Desktop]::FindWindowEx($current, [IntPtr]::Zero, "SHELLDLL_DefView", $null)
  if ($shellView -ne [IntPtr]::Zero) {
    $workerw = [Win32Desktop]::FindWindowEx([IntPtr]::Zero, $current, "WorkerW", $null)
  }
} while ($current -ne [IntPtr]::Zero -and $workerw -eq [IntPtr]::Zero)

if ($workerw -eq [IntPtr]::Zero) {
  $workerw = $progman
}

if ($workerw -eq [IntPtr]::Zero) {
  exit 2
}

$parent = [Win32Desktop]::SetParent($targetHwnd, $workerw)
if ($parent -eq [IntPtr]::Zero) {
  exit 3
}

exit 0
`;

  return await new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script, "-targetHwnd", hwnd],
      {
        windowsHide: true,
        stdio: "ignore"
      }
    );

    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
};
