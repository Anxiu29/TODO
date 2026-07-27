/**
 * 将当前版本发行包同步到 Gitee Release（国内更新源）。
 *
 * - 创建/更新 tag=v{version} 的正式发行版
 * - 同步覆盖 tag=latest 的浮动发行版（供 electron-updater generic 拉取）
 * 依赖：.env 中的 GITEE_TOKEN；需仓库 https://gitee.com/anxiu29/TODO 可写
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./load-env.mjs";
import { getReleaseArtifacts } from "./release-artifacts.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv();

const GITEE_OWNER = "anxiu29";
const GITEE_REPO = "TODO";
const GITEE_API = "https://gitee.com/api/v5";

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = pkg.version;
const tag = `v${version}`;
const releaseDir = join(root, "release", version);
const token = process.env.GITEE_TOKEN;
const { portableExe, setupExe } = getReleaseArtifacts(version);

/** 便携版优先；不上传 blockmap（差量更新非必需） */
const binaryFiles = [portableExe, setupExe];
const manifestFiles = ["latest.yml", "portable.yml"];
const files = [...binaryFiles, ...manifestFiles];

const formatSize = (bytes) => {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const sha256Hex = (filePath) =>
  createHash("sha256").update(readFileSync(filePath)).digest("hex");

/** 调用 Gitee API；query / JSON / multipart 均带 access_token */
const giteeRequest = async (path, options = {}) => {
  const url = new URL(`${GITEE_API}${path}`);
  url.searchParams.set("access_token", token);

  const init = {
    method: options.method ?? "GET",
    headers: { ...(options.headers ?? {}) }
  };

  if (options.body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify({ access_token: token, ...options.body });
  }

  if (options.form) {
    // 勿手动设 Content-Type，由 fetch 填充 multipart boundary
    init.body = options.form;
  }

  const response = await fetch(url, init);
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const detail =
      typeof data === "object" && data
        ? data.message || data.error || JSON.stringify(data)
        : text || response.statusText;
    throw new Error(`Gitee API ${options.method ?? "GET"} ${path} 失败 (${response.status}): ${detail}`);
  }

  return data;
};

const getHeadSha = () => {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(`读取 HEAD 失败: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
};

/** 取版本号更小的最近一个 v* tag，作为「上一版本」 */
const getPreviousTag = () => {
  const result = spawnSync("git", ["tag", "-l", "v*", "--sort=-version:refname"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true
  });

  if (result.status !== 0) {
    throw new Error(`读取 git tag 失败: ${result.stderr || result.stdout}`);
  }

  return (
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((name) => name && name !== tag) ?? null
  );
};

/** 与 GitHub 发版一致：优先复用已生成的日志文件 */
const loadReleaseNotes = () => {
  const notesFile = join(releaseDir, "RELEASE_NOTES.generated.md");
  if (existsSync(notesFile)) {
    return readFileSync(notesFile, "utf8");
  }

  const previousTag = getPreviousTag();
  const range = previousTag ? `${previousTag}..HEAD` : "HEAD";
  const result = spawnSync("git", ["log", range, "--pretty=format:%s", "--no-merges"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true
  });

  if (result.status !== 0) {
    throw new Error(`读取提交记录失败: ${result.stderr || result.stdout}`);
  }

  const subjects = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const title = previousTag ? `相较于 ${previousTag}` : "更新内容";
  const body =
    subjects.length === 0
      ? `${title}\n- 无新的提交说明\n`
      : `${title}\n${subjects.map((subject) => `- ${subject}`).join("\n")}\n`;

  writeFileSync(notesFile, body, "utf8");
  return body;
};

/** 按 tag 取 Release；不存在返回 null */
const getReleaseByTag = async (tagName) => {
  try {
    return await giteeRequest(
      `/repos/${GITEE_OWNER}/${GITEE_REPO}/releases/tags/${encodeURIComponent(tagName)}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("(404)")) {
      return null;
    }
    throw error;
  }
};

const createRelease = async (tagName, name, body) => {
  console.log(`创建 Gitee Release ${tagName}...`);
  return giteeRequest(`/repos/${GITEE_OWNER}/${GITEE_REPO}/releases`, {
    method: "POST",
    body: {
      tag_name: tagName,
      name,
      body,
      target_commitish: getHeadSha(),
      prerelease: false
    }
  });
};

const updateReleaseMeta = async (releaseId, tagName, name, body) => {
  // Gitee PATCH 要求带 tag_name，否则 400
  return giteeRequest(`/repos/${GITEE_OWNER}/${GITEE_REPO}/releases/${releaseId}`, {
    method: "PATCH",
    body: { tag_name: tagName, name, body, prerelease: false }
  });
};

const listAttachFiles = async (releaseId) => {
  const data = await giteeRequest(
    `/repos/${GITEE_OWNER}/${GITEE_REPO}/releases/${releaseId}/attach_files`
  );
  return Array.isArray(data) ? data : [];
};

const deleteAttachFile = async (releaseId, attachFileId, fileName) => {
  console.log(`删除已有附件 ${fileName} (#${attachFileId})`);
  await giteeRequest(
    `/repos/${GITEE_OWNER}/${GITEE_REPO}/releases/${releaseId}/attach_files/${attachFileId}`,
    { method: "DELETE" }
  );
};

const uploadAttachFile = async (releaseId, filePath) => {
  const fileName = basename(filePath);
  const size = statSync(filePath).size;
  console.log(`上传 ${fileName} (${formatSize(size)})...`);

  const bytes = readFileSync(filePath);
  const form = new FormData();
  form.append("access_token", token);
  form.append(
    "file",
    new File([bytes], fileName, { type: "application/octet-stream" })
  );

  await giteeRequest(
    `/repos/${GITEE_OWNER}/${GITEE_REPO}/releases/${releaseId}/attach_files`,
    { method: "POST", form }
  );
  console.log(`完成 ${fileName}`);
};

/**
 * 确保指定 tag 的 Release 存在，并上传/覆盖附件。
 * 清单文件始终覆盖；二进制若远端同名且本地 sha256 可知则仍覆盖（Gitee 无 digest 字段，统一重传）。
 */
const publishReleaseTag = async (tagName, name, body) => {
  let release = await getReleaseByTag(tagName);
  if (!release) {
    release = await createRelease(tagName, name, body);
  } else {
    console.log(`Gitee Release ${tagName} 已存在 (#${release.id})，更新说明并同步附件`);
    await updateReleaseMeta(release.id, tagName, name, body);
  }

  const existing = await listAttachFiles(release.id);
  const keepNames = new Set(files);

  // latest 浮动版文件名带版本号，旧 exe 不会被同名覆盖，必须先清掉多余附件，否则会撑爆 1GB 配额
  for (const item of existing) {
    if (!keepNames.has(item.name)) {
      await deleteAttachFile(release.id, item.id, `${item.name}（过期清理）`);
    }
  }

  const remaining = await listAttachFiles(release.id);
  const existingByName = new Map(remaining.map((item) => [item.name, item]));

  for (const fileName of files) {
    const filePath = join(releaseDir, fileName);
    const remote = existingByName.get(fileName);
    if (remote) {
      // Gitee 附件无可靠 checksum 字段，同名先删再传，避免旧包残留
      await deleteAttachFile(release.id, remote.id, fileName);
    } else {
      console.log(`待上传 ${fileName}（${formatSize(statSync(filePath).size)}，sha256=${sha256Hex(filePath).slice(0, 12)}…）`);
    }
    await uploadAttachFile(release.id, filePath);
  }
};

const main = async () => {
  if (!token) {
    console.error("请先设置 GITEE_TOKEN：复制 .env.example 为 .env 并填入 Gitee 私人令牌");
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

  const notes = loadReleaseNotes();
  console.log(`发布 ${tag} 到 gitee.com/${GITEE_OWNER}/${GITEE_REPO}`);
  console.log(notes);

  // 版本发行版 + latest 浮动版（应用内更新 generic 源固定读 latest）
  await publishReleaseTag(tag, version, notes);
  await publishReleaseTag(
    "latest",
    `最新版 (${version})`,
    `${notes}\n\n对应版本：${tag}\n`
  );

  console.log(`完成: https://gitee.com/${GITEE_OWNER}/${GITEE_REPO}/releases/tag/${tag}`);
  console.log(`更新源: https://gitee.com/${GITEE_OWNER}/${GITEE_REPO}/releases/tag/latest`);
};

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
