/**
 * 渲染进程入口。
 *
 * 四个 Electron 窗口共用此 HTML/JS  bundle，通过 URL 查询参数 ?view= 路由到不同组件：
 * - widget（默认）→ App 桌面挂件
 * - add → AddTodoWindow 快捷添加
 * - calendar → CalendarView 完成日历
 * - settings → SettingsWindow 偏好设置
 */
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import AddTodoWindow from "./AddTodoWindow";
import CalendarView from "./CalendarView";
import SettingsWindow from "./SettingsWindow";
import "./styles.css";

const view = new URLSearchParams(window.location.search).get("view") ?? "widget";

document.body.dataset.view = view;

const View = (): React.ReactElement => {
  if (view === "add") return <AddTodoWindow />;
  if (view === "calendar") return <CalendarView />;
  if (view === "settings") return <SettingsWindow />;
  return <App />;
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <View />
  </React.StrictMode>
);
