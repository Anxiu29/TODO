/**
 * 文本文件原子替换。
 *
 * 先写入同目录临时文件，再替换目标路径，避免进程在 writeFile 中途退出时
 * 把已有 JSON 截成半截（todos.json 损坏后下次启动会被当成空库）。
 */
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";

/**
 * 将 contents 原子写入 filePath。
 * 替换失败时保留旧文件及唯一临时副本，并向调用方抛出错误；不可退化为非原子覆盖。
 */
export const writeFileAtomicSync = (filePath: string, contents: string): void => {
  mkdirSync(dirname(filePath), { recursive: true });
  // 每次使用独立文件名，后续保存不会覆盖上次失败时保留的恢复副本。
  const tempPath = join(dirname(filePath), `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  writeFileSync(tempPath, contents, { encoding: "utf8", flush: true });

  renameSync(tempPath, filePath);
};
