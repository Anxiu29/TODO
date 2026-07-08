import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
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
const token = process.env.GH_TOKEN;

const files = [
  `Desktop-Todo-Widget-Setup-${version}.exe`,
  `Desktop-Todo-Widget-${version}.exe`,
  "latest.yml",
  "portable.yml",
  `Desktop-Todo-Widget-Setup-${version}.exe.blockmap`
];

const api = (path, init = {}) =>
  fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "desktop-todo-widget-publish",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {})
    }
  });

const uploadAsset = async (releaseId, filePath) => {
  const fileName = basename(filePath);
  const size = statSync(filePath).size;
  const contentType = fileName.endsWith(".yml") ? "text/yaml" : "application/octet-stream";

  const response = await fetch(
    `https://uploads.github.com/repos/${owner}/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(fileName)}`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": contentType,
        "Content-Length": String(size),
        "User-Agent": "desktop-todo-widget-publish",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      body: createReadStream(filePath),
      duplex: "half"
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`上传 ${fileName} 失败: ${response.status} ${body}`);
  }

  console.log(`已上传 ${fileName}`);
};

const ensureRelease = async () => {
  const existing = await api(`/repos/${owner}/${repo}/releases/tags/${tag}`);
  if (existing.ok) {
    return existing.json();
  }

  const created = await api(`/repos/${owner}/${repo}/releases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tag_name: tag,
      name: version,
      draft: false,
      prerelease: false,
      generate_release_notes: true
    })
  });

  if (!created.ok) {
    const body = await created.text();
    throw new Error(`创建 Release 失败: ${created.status} ${body}`);
  }

  return created.json();
};

const replaceAssets = async (release) => {
  const assets = release.assets ?? [];
  const names = new Set(files);

  for (const asset of assets) {
    if (!names.has(asset.name)) {
      continue;
    }

    const deleted = await api(`/repos/${owner}/${repo}/releases/assets/${asset.id}`, {
      method: "DELETE"
    });

    if (!deleted.ok && deleted.status !== 404) {
      const body = await deleted.text();
      throw new Error(`删除旧资源 ${asset.name} 失败: ${deleted.status} ${body}`);
    }
  }

  for (const fileName of files) {
    await uploadAsset(release.id, join(releaseDir, fileName));
  }
};

const main = async () => {
  if (!token) {
    console.error("请先设置环境变量 GH_TOKEN");
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

  console.log(`发布 ${tag} 到 ${owner}/${repo}`);
  const release = await ensureRelease();
  await replaceAssets(release);
  console.log(`完成: https://github.com/${owner}/${repo}/releases/tag/${tag}`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
