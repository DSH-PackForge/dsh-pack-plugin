// home 级「可换指」目录（skills / .agent-presets）的落盘布局：
//   真实数据放 $DSH_HOME/.dsh-pack/<store>/<profileName>/，$DSH_HOME 下的 <artifact> 是 junction 指针。
// install（写入）、junction（换指）、scan（跟随指针）共用，避免三处路径漂移。

/** artifact 名（home 根目录名）→ .dsh-pack 下 store 目录名。 */
export const HOME_ARTIFACT_STORE = {
  skills: 'skills',
  '.agent-presets': 'agent-presets',
};

/** 参与换指的 artifact 名集合（供扫描器判断「顶层指针需跟随」）。 */
export const HOME_ARTIFACTS = new Set(Object.keys(HOME_ARTIFACT_STORE));

/** 判断 home 相对路径落在哪个 artifact 下（否则 null）。 */
function matchHomeArtifact(rel) {
  for (const artifact of HOME_ARTIFACTS) {
    if (rel === artifact || rel.startsWith(`${artifact}/`)) return artifact;
  }
  return null;
}

/**
 * 把 home 相对路径重写到 .dsh-pack/<store>/<profileName>/ 下（'/' 分隔）；
 * 非换指目录原样返回。`rest` 用 slice 保留前导 '/'，精确命中时为空串。
 */
export function storeHomeRel(rel, profileName) {
  const artifact = matchHomeArtifact(rel);
  if (!artifact) return rel;
  const store = HOME_ARTIFACT_STORE[artifact];
  const rest = rel === artifact ? '' : rel.slice(artifact.length);
  return `.dsh-pack/${store}/${profileName}${rest}`;
}
