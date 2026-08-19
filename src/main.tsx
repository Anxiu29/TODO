/**
 * 渲染进程入口。
 *
 * 各窗口共用此 HTML，通过 URL 查询参数 ?view= 路由到不同组件：
 * - widget（默认）→ App 桌面挂件（启动热路径，同步加载）
 * - add / edit / calendar / settings → 按需加载，避免 dev 首次编译把全部窗口打成一包
 */
import React, { lazy, Suspense, useEffect } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyAppearance } from "./theme";
import "./styles.css";

const AddTodoWindow = lazy(() => import("./AddTodoWindow"));
const EditTodoWindow = lazy(() => import("./EditTodoWindow"));
const CalendarView = lazy(() => import("./CalendarView"));
const SettingsWindow = lazy(() => import("./SettingsWindow"));

const view = new URLSearchParams(window.location.search).get("view") ?? "widget";

document.body.dataset.view = view;

/**
 * 包裹各窗口根组件：启动时拉一次设置，并监听 settings:changed，
 * 保证改主题/透明度后挂件、设置、日历、快捷添加同步刷新外观。
 */
const AppearanceSync = ({ children }: { children: React.ReactNode }): React.ReactElement => {
  useEffect(() => {
    void window.todoApi.getSettings().then(applyAppearance);
    return window.todoApi.onSettingsChanged(applyAppearance);
  }, []);

  return <>{children}</>;
};

const View = (): React.ReactElement => {
  if (view === "add") return <AddTodoWindow />;
  if (view === "edit") return <EditTodoWindow />;
  if (view === "calendar") return <CalendarView />;
  if (view === "settings") return <SettingsWindow />;
  return <App />;
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppearanceSync>
      <Suspense fallback={null}>
        <View />
      </Suspense>
    </AppearanceSync>
  </React.StrictMode>
);
