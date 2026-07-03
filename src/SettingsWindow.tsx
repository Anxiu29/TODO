import { useEffect, useMemo, useState } from "react";
import type React from "react";
import type { AppSettings } from "./types/todo";

const formatShortcut = (shortcut?: string): string =>
  (shortcut ?? "CommandOrControl+Alt+T")
    .replace("CommandOrControl", "Ctrl")
    .replace(/\+/g, " + ");

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

const eventToShortcut = (event: React.KeyboardEvent<HTMLInputElement>): string => {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("CommandOrControl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");

  if (!["Control", "Shift", "Alt", "Meta"].includes(event.key)) {
    parts.push(keyToAcceleratorPart(event.key, event.code));
  }

  return parts.join("+");
};

export default function SettingsWindow(): React.ReactElement {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [shortcutDraft, setShortcutDraft] = useState("");
  const [showWidgetShortcutDraft, setShowWidgetShortcutDraft] = useState("");
  const [message, setMessage] = useState("点击输入框后按下任意组合键");
  const [showWidgetMessage, setShowWidgetMessage] = useState("点击输入框后按下任意组合键");

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

  const shortcutLabel = useMemo(() => formatShortcut(shortcutDraft || settings?.shortcut), [settings?.shortcut, shortcutDraft]);
  const showWidgetShortcutLabel = useMemo(
    () => formatShortcut(showWidgetShortcutDraft || settings?.showWidgetShortcut),
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

  const updateDisplayMode = async (displayMode: AppSettings["displayMode"]): Promise<void> => {
    const next = await window.todoApi.setDisplayMode(displayMode);
    setSettings(next);
  };

  return (
    <main className="settings-window-shell">
      <section className="settings-window-card">
        <header className="calendar-header">
          <div>
            <p className="eyebrow">设置</p>
            <h1>偏好设置</h1>
          </div>
        </header>

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

        <section className="settings-option vertical">
          <div>
            <strong>组件显示方式</strong>
            <span>选择组件平时停留的位置。</span>
          </div>
          <div className="display-mode-options">
            <button
              className={settings?.displayMode === "float" ? "selected" : ""}
              type="button"
              onClick={() => updateDisplayMode("float")}
            >
              <strong>置顶</strong>
              <span>组件始终置顶显示在当前页面上方。</span>
            </button>
            <button
              className={settings?.displayMode === "desktop" ? "selected" : ""}
              type="button"
              onClick={() => updateDisplayMode("desktop")}
            >
              <strong>只置顶在桌面</strong>
              <span>平时贴在桌面，点击托盘图标时可出现在任何页面。</span>
            </button>
          </div>
        </section>

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
    </main>
  );
}
