import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./load-env.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv();

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const publishConfig = pkg.build?.publish?.[0];

if (!publishConfig || publishConfig.provider !== "github") {
  console.error("package.json 缺少 build.publish GitHub 配置");
  process.exit(1);
}

const version = pkg.version;
const tag = `v${version}`;
const releaseDir = join(root, "release", version);
const owner = publishConfig.owner;
const repo = publishConfig.repo;
const repoSlug = `${owner}/${repo}`;
const token = process.env.GH_TOKEN;

const files = [
  "latest.yml",
  "portable.yml",
  `Desktop-Todo-Widget-Setup-${version}.exe.blockmap`,
  `Desktop-Todo-Widget-Setup-${version}.exe`,
  `Desktop-Todo-Widget-${version}.exe`
];

const ghEnv = {
  ...process.env,
  GH_TOKEN: token,
  GITHUB_TOKEN: token
};

const formatSize = (bytes) => {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const runGh = (args, label) => {
  console.log(`> gh ${args.join(" ")}`);
  const result = spawnSync("gh", args, {
    env: ghEnv,
    stdio: "inherit",
    windowsHide: true
  });

  if (result.error) {
    throw new Error(`${label} 失败: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${label} 失败，退出码 ${result.status}`);
  }
};

const ghExists = (args) =>
  spawnSync("gh", args, {
    env: ghEnv,
    stdio: "ignore",
    windowsHide: true
  }).status === 0;

const ensureGh = () => {
  const result = spawnSync("gh", ["--version"], {
    env: ghEnv,
    stdio: "pipe",
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error("未找到 gh 命令，请先安装 GitHub CLI: https://cli.github.com/");
  }
};

const getRemoteAssetSizes = () => {
  const result = spawnSync(
    "gh",
    ["api", `repos/${owner}/${repo}/releases/tags/${tag}`, "--jq", ".assets[] | [.name, .size] | @tsv"],
    {
      env: ghEnv,
      encoding: "utf8",
      windowsHide: true
    }
  );

  if (result.status !== 0) {
    throw new Error(`读取 Release 资源失败: ${result.stderr || result.stdout}`);
  }

  const sizes = new Map();
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const tab = line.lastIndexOf("\t");
    if (tab === -1) {
      continue;
    }
    const name = line.slice(0, tab);
    const size = Number(line.slice(tab + 1));
    if (name && Number.isFinite(size)) {
      sizes.set(name, size);
    }
  }
  return sizes;
};

const ensureRelease = () => {
  if (ghExists(["release", "view", tag, "--repo", repoSlug])) {
    return;
  }

  const notesFile = join(root, "RELEASE_NOTES.md");
  const createArgs = ["release", "create", tag, "--repo", repoSlug, "--title", version];

  if (existsSync(notesFile) && readFileSync(notesFile, "utf8").trim()) {
    createArgs.push("--notes-file", notesFile);
    console.log(`使用 RELEASE_NOTES.md 作为更新日志`);
  } else {
    createArgs.push("--generate-notes");
    console.log("未找到 RELEASE_NOTES.md（或内容为空），使用 GitHub 自动生成的提交说明");
  }

  runGh(createArgs, "创建 Release");
};

const pickFilesToUpload = (remoteSizes) => {
  const pending = [];

  for (const fileName of files) {
    const filePath = join(releaseDir, fileName);
    const localSize = statSync(filePath).size;
    const remoteSize = remoteSizes.get(fileName);

    if (remoteSize === localSize) {
      console.log(`跳过 ${fileName}（远端已存在，${formatSize(localSize)}）`);
      continue;
    }

    if (remoteSize !== undefined) {
      console.log(`待上传 ${fileName}（远端 ${formatSize(remoteSize)} -> 本地 ${formatSize(localSize)}）`);
    } else {
      console.log(`待上传 ${fileName}（${formatSize(localSize)}）`);
    }

    pending.push(fileName);
  }

  return pending;
};

const uploadFiles = (pending) => {
  if (pending.length === 0) {
    console.log("所有文件均已是最新，无需上传。");
    return;
  }

  console.log(`共 ${pending.length} 个文件待上传，逐个上传以避免卡死。`);

  for (const fileName of pending) {
    const filePath = join(releaseDir, fileName);
    const size = statSync(filePath).size;
    console.log(`\n开始上传 ${fileName} (${formatSize(size)})...`);
    runGh(
      ["release", "upload", tag, "--repo", repoSlug, "--clobber", filePath],
      `上传 ${fileName}`
    );
    console.log(`完成 ${fileName}`);
  }
};

const main = () => {
  if (!token) {
    console.error("请先设置 GH_TOKEN：复制 .env.example 为 .env 并填入 token，或设置环境变量");
    process.exit(1);
  }

  if (!existsSync(releaseDir)) {
    console.error(`未找到打包目录: ${releaseDir}`);
    console.error("请先运行 npm run dist");
    process.exit(1);
  }

  const missing = files.filter((fileName) => !existsSync(join(releaseDir, fileName)));
  if (missing.length > 0) {
    console.error("缺少以下文件，请先重新打包:");
    for (const fileName of missing) {
      console.error(`- ${fileName}`);
    }
    process.exit(1);
  }

  ensureGh();
  console.log(`发布 ${tag} 到 ${repoSlug}`);
  ensureRelease();

  const remoteSizes = getRemoteAssetSizes();
  const pending = pickFilesToUpload(remoteSizes);
  uploadFiles(pending);

  console.log(`完成: https://github.com/${repoSlug}/releases/tag/${tag}`);
};

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
