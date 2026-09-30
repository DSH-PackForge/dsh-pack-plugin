// pnpm 配置与随包 lockfile 的一致性（v3 r3 §8.6.8 + 两条实测结论）。
//
// 带 `vendor/` 的包必须做两件事，否则在目标机上 `--frozen-lockfile` 装不上：
//
//   1) **写 `minimumReleaseAge: 0`**（§8.6.8）。pnpm 11 默认有 24h「发布冷静期」，离线安装时会
//      `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`。规范实测：只有 **camelCase** 的
//      `minimumReleaseAge` 写在 `pnpm-workspace.yaml` 里有效（kebab 与 `--config.*` 都无效；
//      pnpm 11 起也不再读 `package.json` 的 `pnpm` 字段）。安装端传 `--trust-lockfile` 是等价替代。
//
//   2) **镜像 lockfile 的 `settings`**。实测 pnpm 11 会比对 lockfile 里的 `settings:` 与运行时
//      配置，不一致直接失败：
//        [ERR_PNPM_LOCKFILE_CONFIG_MISMATCH] The current "settings.autoInstallPeers"
//        configuration doesn't match the value found in the lockfile
//      随包 lockfile 是源机器的快照（settings 往往来自源机的 .npmrc / pnpm-workspace.yaml），
//      所以打包端必须把它声明的 settings 一并写进包内 `pnpm-workspace.yaml`。

/** 从 lockfile 文本取 `settings:` 区块的顶层标量键值。 */
export function lockfileSettings(lockText) {
  const out = {};
  const lines = String(lockText ?? '').split(/\r?\n/);
  let inSection = false;
  for (const line of lines) {
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    if (!inSection) {
      if (/^settings:\s*$/.test(line)) inSection = true;
      continue;
    }
    if (indent === 0) break; // 下一个顶层区块
    const m = /^(\s+)([^\s:][^:]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    if (indent !== 2) continue; // 只取一层标量；嵌套 map 不是 pnpm 的 settings 形态
    const key = m[2].trim();
    const value = m[3].trim();
    if (key && value) out[key] = value;
  }
  return out;
}

/** 在 pnpm-workspace.yaml 文本里设置顶层键（存在则替换，不存在则追加）。 */
function setTopLevel(text, key, value) {
  const lines = String(text ?? '').split(/\r?\n/);
  const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`);
  for (let i = 0; i < lines.length; i += 1) {
    if (re.test(lines[i])) {
      lines[i] = `${key}: ${value}`;
      return lines.join('\n');
    }
  }
  // 去掉尾部空行后追加，保证文件以单个换行结束
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  lines.push(`${key}: ${value}`);
  return lines.join('\n');
}

/**
 * 把随包 lockfile 的 settings 合并进 `pnpm-workspace.yaml`，并确保 `minimumReleaseAge: 0`。
 *
 * @param {string} wsText 包内现有 pnpm-workspace.yaml（可能为空——包内没有这个文件）
 * @param {string} lockText 随包 pnpm-lock.yaml 文本
 * @returns {string} 新的 pnpm-workspace.yaml 文本（保证以 `\n` 结尾）
 */
export function syncWorkspaceSettings(wsText, lockText) {
  let text = String(wsText ?? '').replace(/^\uFEFF/, '');
  for (const [key, value] of Object.entries(lockfileSettings(lockText))) {
    // minimumReleaseAge 由下面统一钉 0（lockfile settings 里不会有它）
    if (key === 'minimumReleaseAge') continue;
    text = setTopLevel(text, key, value);
  }
  text = setTopLevel(text, 'minimumReleaseAge', '0');
  return text.endsWith('\n') ? text : `${text}\n`;
}
