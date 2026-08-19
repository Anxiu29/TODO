import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

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
    plugins: [react()],
    // 预打包常用依赖，避免首次打开窗口时再扫 lucide-react 整包
    optimizeDeps: {
      include: ["react", "react-dom", "react-dom/client", "lucide-react"]
    },
    server: {
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
