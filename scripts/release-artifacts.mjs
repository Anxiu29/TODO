/**
 * 发版产物文件名（与 package.json build.*.artifactName 一致）。
 * 必须用纯 ASCII：Electron 在 Windows 下读 process.env / 拼更新脚本时，
 * 中文文件名会乱码，导致便携版覆盖安装失败。
 */
export const getReleaseArtifacts = (version) => ({
  portableExe: `TODO-Portable-${version}.exe`,
  setupExe: `TODO-Setup-${version}.exe`
});
