import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { DEV_RENDERER_PORT, pickDevRendererPort } from "./src/data/devPort";

/**
 * 开发服先探 5173：空闲就用；被旧进程占着则顺延并打日志，避免两个 dev 抢同一端口。
 */
const pickRendererPortPlugin = (): Plugin => ({
  name: "pick-renderer-port",
  apply: "serve",
  async config() {
    const { port, preferredInUse } = await pickDevRendererPort(DEV_RENDERER_PORT);
    if (preferredInUse) {
      console.warn(`[dev] 端口 ${DEV_RENDERER_PORT} 正在使用，改用 ${port}`);
    }
    return {
      server: {
        port,
        strictPort: true
      }
    };
  }
});

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, "electron/main.ts")
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, "electron/preload.ts")
      }
    }
  },
  renderer: {
    root: ".",
    plugins: [react(), pickRendererPortPlugin()],
    // 预打包常用依赖，避免首次打开窗口时再扫 lucide-react 整包
    optimizeDeps: {
      include: ["react", "react-dom", "react-dom/client", "lucide-react"]
    },
    server: {
      port: DEV_RENDERER_PORT,
      warmup: {
        clientFiles: ["./src/main.tsx", "./src/App.tsx", "./src/styles.css"]
      }
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, "index.html")
      }
    },
    resolve: {
      alias: {
        "@": resolve(__dirname, "src")
      }
    }
  }
});
