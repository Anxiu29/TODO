import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./load-env.mjs";
import { getReleaseArtifacts } from "./release-artifacts.mjs";

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
const { portableExe, setupExe } = getReleaseArtifacts(version);

/**
 * 先传二进制，最后强制覆盖 yml。
 * 不上传 .blockmap：差量更新非必需，完整下载即可；Source 由 GitHub 按 tag 自动附带，无需我们上传。
 */
const binaryFiles = [portableExe, setupExe];
const manifestFiles = ["latest.yml", "portable.yml"];
const files = [...binaryFiles, ...manifestFiles];

const sha256Hex = (filePath) =>
  createHash("sha256").update(readFileSync(filePath)).digest("hex");

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

/** 读取远端资源的 size 与 sha256（GitHub digest 字段） */
const getRemoteAssets = () => {
  const result = spawnSync(
    "gh",
    [
      "api",
      `repos/${owner}/${repo}/releases/tags/${tag}`,
      "--jq",
      ".assets[] | [.name, (.size|tostring), (.digest // \"\")] | @tsv"
    ],
    {
      env: ghEnv,
      encoding: "utf8",
      windowsHide: true
    }
  );

  if (result.status !== 0) {
    throw new Error(`读取 Release 资源失败: ${result.stderr || result.stdout}`);
  }

  /** @type {Map<string, { size: number, sha256: string | null }>} */
  const assets = new Map();
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const [name, sizeText, digest = ""] = line.split("\t");
    const size = Number(sizeText);
    if (!name || !Number.isFinite(size)) {
      continue;
    }
    const sha256 = digest.startsWith("sha256:") ? digest.slice("sha256:".length) : null;
    assets.set(name, { size, sha256 });
  }
  return assets;
};

/** 优先复用 generate-update-yml 写好的日志，避免 GitHub / Gitee / yml 不一致 */
const loadReleaseNotes = () => {
  const notesFile = join(releaseDir, "RELEASE_NOTES.generated.md");
  if (!existsSync(notesFile)) {
    throw new Error(`缺少 ${notesFile}，请先运行 node scripts/generate-update-yml.mjs`);
  }
  return { notes: readFileSync(notesFile, "utf8"), notesFile };
};

const ensureRelease = () => {
  if (ghExists(["release", "view", tag, "--repo", repoSlug])) {
    return;
  }

  const { notes, notesFile } = loadReleaseNotes();
  console.log("使用已生成的更新日志创建 Release");
  console.log(notes);

  runGh(
    ["release", "create", tag, "--repo", repoSlug, "--title", version, "--notes-file", notesFile],
    "创建 Release"
  );
};

const pickFilesToUpload = (remoteAssets) => {
  const pending = [];

  for (const fileName of files) {
    const filePath = join(releaseDir, fileName);
    const localSize = statSync(filePath).size;
    const remote = remoteAssets.get(fileName);
    const isManifest = manifestFiles.includes(fileName);

    // 清单必须与当前二进制一致，始终覆盖上传
    if (isManifest) {
      console.log(`待上传 ${fileName}（清单强制覆盖，${formatSize(localSize)}）`);
      pending.push(fileName);
      continue;
    }

    if (remote) {
      const localSha256 = sha256Hex(filePath);
      if (remote.sha256 && remote.sha256 === localSha256) {
        console.log(`跳过 ${fileName}（远端 sha256 一致，${formatSize(localSize)}）`);
        continue;
      }
      // 无 digest 时退回按 size；有 digest 但不一致则重传
      if (!remote.sha256 && remote.size === localSize) {
        console.log(`跳过 ${fileName}（远端 size 一致且无 digest，${formatSize(localSize)}）`);
        continue;
      }
      console.log(
        `待上传 ${fileName}（远端 ${formatSize(remote.size)} -> 本地 ${formatSize(localSize)}）`
      );
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

  const remoteAssets = getRemoteAssets();
  const pending = pickFilesToUpload(remoteAssets);
  uploadFiles(pending);

  console.log(`完成: https://github.com/${repoSlug}/releases/tag/${tag}`);
};

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
