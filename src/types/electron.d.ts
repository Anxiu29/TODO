import type { TodoApi } from "../../electron/preload";

declare global {
  interface Window {
    todoApi: TodoApi;
  }
}

export {};
