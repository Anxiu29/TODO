/**
 * 项目发行页地址：设置页展示、主进程 openExternal 白名单共用。
 * 指向 latest，用户可直接下载当前最新版安装包/便携版。
 */
export const PROJECT_RELEASE_URLS = {
  github: "https://github.com/Anxiu29/TODO/releases/latest",
  gitee: "https://gitee.com/anxiu29/TODO/releases/latest"
} as const;

/** 允许 shell.openExternal 打开的地址（仅发行页，防任意外链） */
export const ALLOWED_EXTERNAL_URLS: ReadonlySet<string> = new Set(
  Object.values(PROJECT_RELEASE_URLS)
);
