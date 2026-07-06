/**
 * 扩展 Window 类型，使渲染进程能类型安全地访问 preload 暴露的 todoApi。
 * TodoApi 类型定义在 electron/preload.ts，与 contextBridge.exposeInMainWorld 保持一致。
 */
import type { TodoApi } from "../../electron/preload";

declare global {
  interface Window {
    todoApi: TodoApi;
  }
}

export {};
