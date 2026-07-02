import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import AddTodoWindow from "./AddTodoWindow";
import CalendarView from "./CalendarView";
import "./styles.css";

const view = new URLSearchParams(window.location.search).get("view") ?? "widget";

const View = (): React.ReactElement => {
  if (view === "add") return <AddTodoWindow />;
  if (view === "calendar") return <CalendarView />;
  return <App />;
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <View />
  </React.StrictMode>
);
