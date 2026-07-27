/**
 * electron-builder afterPack：打包解压目录后立刻瘦身。
 * - 删除体积很大的 Chromium 许可 HTML（不影响运行）
 * - 只保留中/英 locale，防止 electronLanguages 未生效时仍带全量语言包
 */
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

/** @param {import("electron-builder").AfterPackContext} context */
export default async function afterPack(context) {
  const appOutDir = context.appOutDir;

  const licensePath = join(appOutDir, "LICENSES.chromium.html");
  if (existsSync(licensePath)) {
    unlinkSync(licensePath);
    console.log("afterPack: 已删除 LICENSES.chromium.html");
  }

  const localesDir = join(appOutDir, "locales");
  if (!existsSync(localesDir)) {
    return;
  }

  /** 与 UI 语言相关；Windows 下文件名为 xx-YY.pak */
  const keep = new Set(["zh-CN.pak", "en-US.pak"]);
  let removed = 0;

  for (const name of readdirSync(localesDir)) {
    if (keep.has(name)) {
      continue;
    }
    unlinkSync(join(localesDir, name));
    removed += 1;
  }

  console.log(`afterPack: locales 已清理，删除 ${removed} 个，保留 ${[...keep].join(", ")}`);
}
