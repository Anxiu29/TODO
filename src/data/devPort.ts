/**
 * 开发态渲染端口探测。Vite 默认 5173，被上次没退干净的进程占用时改用下一个空闲端口。
 */
import { createConnection } from "node:net";

/** electron-vite / Vite 默认开发端口 */
export const DEV_RENDERER_PORT = 5173;

/**
 * 探测本机 TCP 端口是否已有进程在听。
 * 能连上视为占用；连不上（ECONNREFUSED 等）视为空闲。
 */
export const isTcpPortInUse = (port: number, host = "127.0.0.1"): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = createConnection({ port, host });
    socket.setTimeout(400);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });

/** 从 preferred 起找空闲端口；preferredInUse 供启动日志提示 */
export const pickDevRendererPort = async (
  preferred = DEV_RENDERER_PORT,
  maxTries = 20
): Promise<{ port: number; preferredInUse: boolean }> => {
  if (!(await isTcpPortInUse(preferred))) {
    return { port: preferred, preferredInUse: false };
  }

  for (let port = preferred + 1; port < preferred + maxTries; port += 1) {
    if (!(await isTcpPortInUse(port))) {
      return { port, preferredInUse: true };
    }
  }

  throw new Error(`从 ${preferred} 起连续 ${maxTries} 个端口都被占用`);
};
