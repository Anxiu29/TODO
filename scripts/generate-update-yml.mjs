/**
 * 生成/覆盖 latest.yml 与 portable.yml，并写入更新日志。
 * Gitee generic 源只能从 yml 读 releaseNotes，故必须在此嵌入。
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = pkg.version;
const tag = `v${version}`;
const releaseDir = join(root, "release", version);

const sha512Base64 = (filePath) =>
  createHash("sha512").update(readFileSync(filePath)).digest("base64");

/** 取版本号更小的最近一个 v* tag */
const getPreviousTag = () => {
  const result = spawnSync("git", ["tag", "-l", "v*", "--sort=-version:refname"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true
  });

  if (result.status !== 0) {
    return null;
  }

  return (
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((name) => name && name !== tag) ?? null
  );
};

/** 生成与发版脚本一致的更新说明，供 yml / GitHub / Gitee 复用 */
const buildReleaseNotes = () => {
  const previousTag = getPreviousTag();
  const range = previousTag ? `${previousTag}..HEAD` : "HEAD";
  const result = spawnSync("git", ["log", range, "--pretty=format:%s", "--no-merges"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true
  });

  const subjects =
    result.status === 0
      ? result.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
      : [];

  const title = previousTag ? `相较于 ${previousTag}` : "更新内容";
  if (subjects.length === 0) {
    return `${title}\n- 无新的提交说明\n`;
  }
  return `${title}\n${subjects.map((subject) => `- ${subject}`).join("\n")}\n`;
};

/** YAML 字面量块：每行缩进 2 空格 */
const toYamlLiteralBlock = (text) =>
  text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");

const buildYml = (fileName, releaseNotes) => {
  const filePath = join(releaseDir, fileName);
  const size = statSync(filePath).size;
  const sha512 = sha512Base64(filePath);

  return `version: ${version}
files:
  - url: ${fileName}
    sha512: ${sha512}
    size: ${size}
path: ${fileName}
sha512: ${sha512}
releaseDate: '${new Date().toISOString()}'
releaseNotes: |
${toYamlLiteralBlock(releaseNotes)}
`;
};

if (!existsSync(releaseDir)) {
  console.error(`未找到打包目录: ${releaseDir}`);
  process.exit(1);
}

const releaseNotes = buildReleaseNotes();
const notesFile = join(releaseDir, "RELEASE_NOTES.generated.md");
writeFileSync(notesFile, releaseNotes, "utf8");

const setupExe = `Desktop-Todo-Widget-Setup-${version}.exe`;
const portableExe = `Desktop-Todo-Widget-${version}.exe`;

for (const [ymlName, exeName] of [
  ["latest.yml", setupExe],
  ["portable.yml", portableExe]
]) {
  const exePath = join(releaseDir, exeName);
  if (!existsSync(exePath)) {
    console.error(`缺少 ${exeName}，请先 npm run dist`);
    process.exit(1);
  }
  writeFileSync(join(releaseDir, ymlName), buildYml(exeName, releaseNotes), "utf8");
  console.log(`已生成 release/${version}/${ymlName}`);
}

console.log(`已写入更新日志: release/${version}/RELEASE_NOTES.generated.md`);
