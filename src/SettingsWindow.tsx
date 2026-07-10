/**
 * 偏好设置窗口（?view=settings）。
 *
 * 支持：开机自启、录制全局快捷键（快速添加 / 显示组件）。
 * 快捷键通过 input onKeyDown 捕获键盘事件，转换为 Electron Accelerator 格式后 IPC 注册。
 */
import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type React from "react";
import type { AppSettings, WidgetDisplayMode } from "./types/todo";
import type { AppVersionInfo, UpdateStatus } from "./types/update";

const formatShortcut = (shortcut?: string, fallback = "CommandOrControl+2"): string =>
  (shortcut ?? fallback)
    .replace("CommandOrControl", "Ctrl")
    .replace(/\+/g, " + ");

/**
 * 将 DOM KeyboardEvent 的 key/code 转为 Electron 加速器片段。
 * 需与 main.ts 中 normalizeShortcut 的期望格式一致。
 */
const keyToAcceleratorPart = (key: string, code: string): string => {
  if (key === " ") return "Space";
  if (key === "Escape") return "Esc";
  if (key.startsWith("Arrow")) return key.replace("Arrow", "");
  if (/^F\d{1,2}$/.test(key)) return key;
  if (/^[a-z]$/i.test(key)) return key.toUpperCase();
  if (/^\d$/.test(key)) return key;
  if (code.startsWith("Numpad") && code.length > "Numpad".length) return code.replace("Numpad", "num");
  return key.length === 1 ? key.toUpperCase() : key;
};

/** 组合 Ctrl/Alt/Shift/Meta 与主键，生成如 CommandOrControl+Alt+T */
const eventToShortcut = (event: React.KeyboardEvent<HTMLInputElement>): string => {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("CommandOrControl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");

  // 忽略单独按下修饰键
  if (!["Control", "Shift", "Alt", "Meta"].includes(event.key)) {
    parts.push(keyToAcceleratorPart(event.key, event.code));
  }

  return parts.join("+");
};

const updateStatusMessage = (status: UpdateStatus, versionInfo: AppVersionInfo | null): string => {
  switch (status.state) {
    case "idle":
      return versionInfo?.updateSupported ? "可检查 GitHub 上的新版本" : "开发模式下无法检查更新";
    case "checking":
      return "正在检查更新…";
    case "available":
      return `发现新版本 v${status.version}，正在下载…`;
    case "not-available":
      return "当前已是最新版本";
    case "downloading":
      return `正在下载更新… ${Math.round(status.percent)}%`;
    case "downloaded":
      return `新版本 v${status.version} 已下载，重启后安装`;
    case "error":
      return status.message;
  }
};

export default function SettingsWindow(): React.ReactElement {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [shortcutDraft, setShortcutDraft] = useState("");
  const [showWidgetShortcutDraft, setShowWidgetShortcutDraft] = useState("");
  const [message, setMessage] = useState("点击输入框后按下任意组合键");
  const [showWidgetMessage, setShowWidgetMessage] = useState("点击输入框后按下任意组合键");
  const [versionInfo, setVersionInfo] = useState<AppVersionInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: "idle" });

  useEffect(() => {
    void window.todoApi.getAppVersion().then(setVersionInfo);
    void window.todoApi.getUpdateStatus().then(setUpdateStatus);

    return window.todoApi.onUpdateStatusChanged(setUpdateStatus);
  }, []);

  useEffect(() => {
    void window.todoApi.getSettings().then((nextSettings) => {
      setSettings(nextSettings);
      setShortcutDraft(nextSettings.shortcut);
      setShowWidgetShortcutDraft(nextSettings.showWidgetShortcut);
    });

    return window.todoApi.onSettingsChanged((nextSettings) => {
      setSettings(nextSettings);
      setShortcutDraft(nextSettings.shortcut);
      setShowWidgetShortcutDraft(nextSettings.showWidgetShortcut);
    });
  }, []);

  const shortcutLabel = useMemo(() => formatShortcut(shortcutDraft || settings?.shortcut, "CommandOrControl+2"), [settings?.shortcut, shortcutDraft]);
  const showWidgetShortcutLabel = useMemo(
    () => formatShortcut(showWidgetShortcutDraft || settings?.showWidgetShortcut, "CommandOrControl+1"),
    [settings?.showWidgetShortcut, showWidgetShortcutDraft]
  );

  const updateShortcut = async (shortcut: string): Promise<void> => {
    if (!shortcut) {
      setMessage("请按下想要设置的快捷键");
      return;
    }

    const result = await window.todoApi.setShortcut(shortcut);
    setSettings(result.settings);
    setShortcutDraft(result.settings.shortcut);
    setMessage(result.registered ? `已设置为 ${formatShortcut(result.activeShortcut)}` : "快捷键被占用或不可用，已保留原设置");
  };

  const updateShowWidgetShortcut = async (shortcut: string): Promise<void> => {
    if (!shortcut) {
      setShowWidgetMessage("请按下想要设置的快捷键");
      return;
    }

    const result = await window.todoApi.setShowWidgetShortcut(shortcut);
    setSettings(result.settings);
    setShowWidgetShortcutDraft(result.settings.showWidgetShortcut);
    setShowWidgetMessage(result.registered ? `已设置为 ${formatShortcut(result.activeShortcut)}` : "快捷键被占用或不可用，已保留原设置");
  };

  const updateLaunchAtLogin = async (enabled: boolean): Promise<void> => {
    const next = await window.todoApi.setLaunchAtLogin(enabled);
    setSettings(next);
  };

  const updateDisplayMode = async (displayMode: WidgetDisplayMode): Promise<void> => {
    const next = await window.todoApi.setDisplayMode(displayMode);
    setSettings(next);
  };

  const handleCheckForUpdates = async (): Promise<void> => {
    const status = await window.todoApi.checkForUpdates();
    setUpdateStatus(status);
  };

  const handleQuitAndInstall = (): void => {
    void window.todoApi.quitAndInstall();
  };

  const updateMessage = updateStatusMessage(updateStatus, versionInfo);
  const isUpdateBusy = updateStatus.state === "checking" || updateStatus.state === "downloading";

  return (
    <main className="settings-window-shell">
      <section className="settings-window-card">
        <header className="calendar-header">
          <div>
            <p className="eyebrow">设置</p>
            <h1>偏好设置</h1>
          </div>
          <div className="header-actions no-drag">
            <button
              className="icon-button danger-button"
              type="button"
              title="关闭"
              aria-label="关闭"
              onClick={() => window.todoApi.closeCurrentWindow()}
            >
              <X aria-hidden className="button-icon" strokeWidth={2} />
            </button>
          </div>
        </header>

        <div className="settings-content no-drag">
          <section className="settings-section">
            <h2 className="settings-section-title">常规</h2>
            <label className="settings-option">
              <div>
                <strong>开机自动启动</strong>
                <span>登录 Windows 后自动启动桌面代办。</span>
              </div>
              <input
                type="checkbox"
                checked={settings?.launchAtLogin ?? false}
                onChange={(event) => updateLaunchAtLogin(event.target.checked)}
              />
            </label>
            <label className="settings-option">
              <div>
                <strong>组件显示方式</strong>
                <span>普通窗口兼容性最好；桌面固定依赖系统桌面层，不支持时会自动降级为普通窗口。</span>
              </div>
              <select
                className="settings-select"
                value={settings?.displayMode ?? "normal"}
                disabled={!settings}
                onChange={(event) => void updateDisplayMode(event.target.value as WidgetDisplayMode)}
              >
                <option value="normal">普通组件</option>
                <option value="desktop">固定在桌面上</option>
              </select>
            </label>
          </section>

          <section className="settings-section">
            <h2 className="settings-section-title">快捷键</h2>
            <section className="settings-option vertical">
              <div>
                <strong>快速添加快捷键</strong>
                <span>点击输入框后直接按下想要的组合键。</span>
              </div>
              <input
                className="shortcut-capture"
                value={shortcutLabel}
                readOnly
                onKeyDown={(event) => {
                  event.preventDefault();
                  const shortcut = eventToShortcut(event);
                  if (shortcut) {
                    setShortcutDraft(shortcut);
                    void updateShortcut(shortcut);
                  }
                }}
                onFocus={() => setMessage("正在录制，按下任意组合键")}
              />
              <p className="settings-message">{message}</p>
            </section>

            <section className="settings-option vertical">
              <div>
                <strong>显示组件快捷键</strong>
                <span>点击输入框后按下快捷键，用来临时显示组件。</span>
              </div>
              <input
                className="shortcut-capture"
                value={showWidgetShortcutLabel}
                readOnly
                onKeyDown={(event) => {
                  event.preventDefault();
                  const shortcut = eventToShortcut(event);
                  if (shortcut) {
                    setShowWidgetShortcutDraft(shortcut);
                    void updateShowWidgetShortcut(shortcut);
                  }
                }}
                onFocus={() => setShowWidgetMessage("正在录制，按下任意组合键")}
              />
              <p className="settings-message">{showWidgetMessage}</p>
            </section>
          </section>

          <section className="settings-section">
            <h2 className="settings-section-title">更新</h2>
            <section className="settings-option vertical">
              <div>
                <strong>应用更新</strong>
                <span>当前版本 v{versionInfo?.currentVersion ?? "…"}</span>
              </div>
              <p className="settings-message">{updateMessage}</p>
              <div className="settings-actions">
                <button
                  type="button"
                  className="settings-action-button"
                  disabled={!versionInfo?.updateSupported || isUpdateBusy}
                  onClick={() => void handleCheckForUpdates()}
                >
                  {isUpdateBusy ? "请稍候…" : "检查更新"}
                </button>
                {updateStatus.state === "downloaded" ? (
                  <button type="button" className="settings-action-button primary" onClick={handleQuitAndInstall}>
                    立即重启安装
                  </button>
                ) : null}
              </div>
            </section>
          </section>
        </div>
      </section>
    </main>
  );
}
