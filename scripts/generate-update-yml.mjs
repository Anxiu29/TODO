import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = pkg.version;
const releaseDir = join(root, "release", version);

const sha512Base64 = (filePath) =>
  createHash("sha512").update(readFileSync(filePath)).digest("base64");

const buildYml = (fileName) => {
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
`;
};

const portableExe = `Desktop-Todo-Widget-${version}.exe`;

writeFileSync(join(releaseDir, "portable.yml"), buildYml(portableExe), "utf8");
console.log(`已生成 release/${version}/portable.yml`);
