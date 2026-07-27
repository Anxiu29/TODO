/**
 * 发版产物文件名。
 * - 本地打包 / Gitee：中文名（与 package.json build.*.artifactName 一致）
 * - GitHub Release：ASCII 英文名（GitHub 会把非 ASCII 洗成点，导致附件名损坏）
 */
export const getReleaseArtifacts = (version) => ({
  portableExe: `TODO便携版-${version}.exe`,
  setupExe: `TODO安装版-${version}.exe`,
  /** 上传 GitHub 时使用的英文别名 */
  githubPortableExe: `TODO-Portable-${version}.exe`,
  githubSetupExe: `TODO-Setup-${version}.exe`
});
