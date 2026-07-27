/**
 * 发版产物文件名（与 package.json build.*.artifactName 保持一致）。
 * 主推便携版；安装版备选。不上传 .blockmap（差量更新可选，完整下载即可）。
 */
export const getReleaseArtifacts = (version) => ({
  portableExe: `TODO便携版-${version}.exe`,
  setupExe: `TODO安装版-${version}.exe`
});
