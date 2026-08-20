/**
 * 文本文件原子替换。
 *
 * 先写入同目录临时文件，再替换目标路径，避免进程在 writeFile 中途退出时
 * 把已有 JSON 截成半截（todos.json 损坏后下次启动会被当成空库）。
 */
import { copyFileSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * 将 contents 原子写入 filePath。
 * Windows 上 rename 不能覆盖已存在文件时，退化为 copy + 删除临时文件。
 */
export const writeFileAtomicSync = (filePath: string, contents: string): void => {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = join(dirname(filePath), `.${basename(filePath)}.${process.pid}.tmp`);
  writeFileSync(tempPath, contents, { encoding: "utf8", flush: true });

  try {
    renameSync(tempPath, filePath);
  } catch {
    try {
      copyFileSync(tempPath, filePath);
    } finally {
      try {
        unlinkSync(tempPath);
      } catch {
        // 目标已写好时，残留临时文件不影响下次启动；后续写入会覆盖同名 tmp
      }
    }
  }
};
