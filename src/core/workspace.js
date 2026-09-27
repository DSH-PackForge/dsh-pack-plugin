// 工作区配置（.dshpkcfg）：导出工作区的本地快照（规范见 specs/workspace-config/v1.md）。
// 供 GUI / CLI / AI 工具 / DSH 插件共用的读取、保存与「按配置导出」入口，避免各写一份 readTextFile + JSON.parse。
import { packProfile, packHome } from './pack.js';
import { exportRepo } from './repo.js';

/** .dshpkcfg 已知字段白名单（规范 v1 r2：公共 + profile + dshhome 形态 + 兼容性/内嵌旋钮）。 */
export const WORKSPACE_KEYS = [
  'name', 'version', 'displayName', 'description', 'author', 'icon', 'dshVersion', 'out',
  'exportContent', 'profileName', 'mode', 'content', 'defaultProfile',
  'dshVersions', 'launchers', 'vendor',
];

/** 读取某个目录下的 .dshpkcfg；不存在/非法 → null。 */
export async function loadWorkspaceConfig(host, dir) {
  if (!dir) return null;
  const raw = await host.readTextFile(host.joinPath(dir, '.dshpkcfg'));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * 保存工作区配置到目录下的 .dshpkcfg（规范 v1：UTF-8、单 JSON 对象、2 空格缩进、结尾换行）。
 * 只落白名单字段、去 null/undefined；空串保留（规范「空串 = 未填写」）。
 * @returns {Promise<string>} 写入的绝对路径
 */
export async function saveWorkspaceConfig(host, dir, config) {
  if (!dir) throw new Error('缺少保存目录');
  const out = {};
  for (const k of WORKSPACE_KEYS) {
    const v = config?.[k];
    if (v === undefined || v === null) continue;
    out[k] = v;
  }
  const file = host.joinPath(dir, '.dshpkcfg');
  await host.writeTextFile(file, JSON.stringify(out, null, 2) + '\n');
  return file;
}

/**
 * 按工作区配置导出：config 打底，overrides 覆盖；按 mode 分流 dspack / repo。
 * @param {Host} host
 * @param {{name:string,dir:string}} profile
 * @param {object} overrides 显式覆盖（CLI flag / AI 工具参数 / GUI 表单）；undefined/null 视为「未设置」不覆盖
 * @returns packProfile 或 exportRepo 的结果
 */
export async function exportFromWorkspace(host, profile, overrides = {}) {
  const cfg = (await loadWorkspaceConfig(host, profile.dir)) ?? {};
  const opts = { ...cfg };
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined && v !== null) opts[k] = v;
  }
  // exportContent（{skill,preset,instruction}）→ homeInclude 前缀（profile 形态：勾选即导出上一级目录内容；
  // data 仅 dshhome 形态，这里忽略）。
  const ec = opts.exportContent;
  if (ec && typeof ec === 'object') {
    const include = [];
    if (ec.skill === true) include.push('skills/');
    if (ec.preset === true) include.push('.agent-presets/');
    if (ec.instruction === true) include.push('AGENTS.md');
    if (include.length) opts.homeInclude = include;
  }
  if (opts.mode === 'repo') {
    // repo 形态下 force 等价 replaceRelease（覆盖同版本 release 产物）
    if (opts.force === true) opts.replaceRelease = true;
    return exportRepo(host, profile, opts);
  }
  return packProfile(host, profile, opts);
}

/**
 * 按工作区配置导出 DSH_HOME（dshhome）：config 打底、overrides 覆盖；把 exportContent 布尔开关映射为 exclude 前缀。
 * @param {Host} host
 * @param {{name:string,dir:string}} home
 * @param {object} overrides 显式覆盖（CLI flag / AI 参数 / Remote 请求）
 * @returns packHome 的结果
 */
export async function exportHomeFromWorkspace(host, home, overrides = {}) {
  const cfg = (await loadWorkspaceConfig(host, home.dir)) ?? {};
  const opts = { ...cfg };
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined && v !== null) opts[k] = v;
  }
  // exportContent（{skill,preset,instruction,data}）→ exclude 前缀（未勾选即排除）
  const ec = opts.exportContent;
  if (ec && typeof ec === 'object') {
    const excludes = [];
    if (ec.skill === false) excludes.push('skills/');
    if (ec.preset === false) excludes.push('.agent-presets/');
    if (ec.instruction === false) excludes.push('AGENTS.md');
    if (ec.data === false) excludes.push('data/');
    if (excludes.length) opts.exclude = excludes;
  }
  return packHome(host, home, opts);
}
