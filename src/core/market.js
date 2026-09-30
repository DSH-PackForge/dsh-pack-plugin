/**
 * 市场索引读取（宿主无关：Electron GUI 与 DSH 客户端插件共用）。
 * - 兼容精简索引（schemaVersion 2，`modpacks[]`）：条目只含指针 + 展示元数据 + `id`；
 * - 完整 manifest + README 存于 `packs/<owner>.<repo>/`，用 `fetchMarketPackDetail` 懒加载；
 * - 兼容旧式单 `downloadUrl`+`sha256`+`size` 与 `files[]` 指针式；
 * - 从下载地址/版本号自动判别 `.dspack`(v4/v5) 与 `.tgz`(v3) 旧格式。
 */

import { normalizeLaunchers } from './manifest.js';

/** 默认市场索引：官方 GitHub Pages 站点（CI 每日刷新扫描 dsh-pack 标签仓库）。 */
export const DEFAULT_MARKET_INDEX = 'https://dsh-packforge.github.io/dsh-pack-market/index.json';

/**
 * 启动器注册表机器可读版本（specs/launcher-registry.md 头部记载，schemaVersion 1）。
 * 第三方（如 DSHL）可直接引用；本插件用于「兼容性」编辑器渲染认领 ID + 显示名。
 */
export const DEFAULT_LAUNCHERS_REGISTRY_URL = 'https://dsh-packforge.github.io/dsh-pack-market/launchers.json';

/** 内置回落清单（拉取失败 / 结构非法时用；与 specs/launcher-registry.md §1 表同步维护）。 */
export const BUILTIN_LAUNCHERS = [
  { id: 'dshl', name: 'DSHL · DeepSeek Harness Launcher' },
  { id: 'hdsl', name: 'HDSL · Hello DeepSeek Launcher' },
  { id: 'dsh-packforge-app', name: 'DSH PackForge GUI / dspack CLI' },
  { id: 'official-desktop', name: 'DeepSeek Harness 官方桌面端' },
  { id: 'dsh-cli', name: '裸 dsh 命令行' },
];

/**
 * 解析 launchers.json（schemaVersion 1）：`launchers[]: {id, name, url?, support?, desc?}` →
 * `[{id, name}]`。结构非法 / 无有效条目 → null（调用方回落内置清单；消费纪律见规范头部）。
 */
export function parseLaunchersRegistry(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const list = Array.isArray(json.launchers) ? json.launchers : null;
  if (!list) return null;
  const out = [];
  for (const e of list) {
    if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.id)) continue;
    out.push({ id: e.id, name: typeof e.name === 'string' && e.name ? e.name : e.id });
  }
  return out.length ? out : null;
}

/**
 * 拉取启动器注册表（机器可读版）。拉取失败 / 解析非法 → 回落内置清单（source: 'builtin'）。
 * @returns {Promise<{launchers: Array<{id, name}>, source: 'registry'|'builtin'}>}
 */
export async function fetchLaunchersRegistry(host, opts = {}) {
  const url = opts.url || DEFAULT_LAUNCHERS_REGISTRY_URL;
  try {
    const tmp = await host.mkdtemp('dspack-launchers-');
    try {
      const dest = host.joinPath(tmp, 'launchers.json');
      await host.download(url, dest);
      const raw = await host.readTextFile(dest);
      const parsed = parseLaunchersRegistry(raw ? JSON.parse(raw) : null);
      if (parsed) return { launchers: parsed, source: 'registry' };
    } finally {
      await host.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  } catch { /* 落入内置回落 */ }
  return { launchers: BUILTIN_LAUNCHERS, source: 'builtin' };
}

/** 由索引条目的 id/owner/repo 推导懒加载目录 key（`<owner>.<repo>`）。 */
export function packDirId(entry) {
  if (entry?.id && typeof entry.id === 'string') return entry.id;
  if (entry?.owner && entry?.repo) return `${entry.owner}.${entry.repo}`;
  return '';
}

/** v5 兼容性字段透传（manifest v5 §13/§14）：launchers / dshVersions
 *  从索引 entry 或懒加载详情 manifest 里「有什么带什么」。中心索引（index 契约 §6.5）不平铺
 *  这两个字段（只带派生标记 launcherRestricted），完整内容在 packs/<id>/manifest.json——
 *  透传只为宽容消费：条目/manifest 里带了就带出，缺失不设键。 */
export function pickR2Fields(src) {
  const out = {};
  if (!src || typeof src !== 'object') return out;
  if (src.launchers && typeof src.launchers === 'object' && !Array.isArray(src.launchers)) out.launchers = src.launchers;
  if (Array.isArray(src.dshVersions)) {
    const versions = src.dshVersions.filter((v) => typeof v === 'string' && v.trim());
    if (versions.length) out.dshVersions = versions;
  }
  return out;
}

/** r2 字段 → 市场详情展示徽标（结构化条目，文案由 UI 层按 kind 做 i18n）：
 *  - { kind: 'launcher-require', id, minVersion }   需启动器 <id> ≥ <ver>（简式/全式都归一）
 *  - { kind: 'launcher-conflict', id, reason }      声明不支持某启动器（reason 可为空串）
 *  - { kind: 'dsh-versions', versions }             兼容 DSH 版本枚举集
 *  纯支持（supported:true 无 minVersion）不产生徽标；无任何字段 → 空列表（通用包）。 */
export function r2Badges(src) {
  const out = [];
  const r2 = pickR2Fields(src);
  for (const [id, e] of Object.entries(normalizeLaunchers(r2.launchers))) {
    if (e.supported === false) out.push({ kind: 'launcher-conflict', id, reason: e.reason ?? '' });
    else if (e.minVersion) out.push({ kind: 'launcher-require', id, minVersion: e.minVersion });
  }
  if (r2.dshVersions?.length) out.push({ kind: 'dsh-versions', versions: r2.dshVersions });
  return out;
}

/** 读取本地路径或 http(s) URL 的 index.json，返回归一化后的市场条目列表。
 *  解析异常/缺字段时不抛错，而是带 `error` 说明（packs 为空），便于调用方提示真实原因。 */
export async function readMarketIndex(host, indexPath) {
  const parsed = parseIndex(await fetchText(host, indexPath));
  const index = parsed.index;
  const raw = Array.isArray(index?.modpacks) ? index.modpacks : Array.isArray(index?.packs) ? index.packs : [];
  return {
    schemaVersion: index?.schemaVersion ?? 1,
    generatedAt: index?.generatedAt ?? null,
    packs: raw.map((e) => normalizeMarketPack(e)).filter(Boolean),
    error: parsed.error,
  };
}

/** 懒加载单个整合包的完整 manifest + README（来自 `packs/<owner>.<repo>/`）。
 *  由 index 路径推导 base：URL 去掉尾段 `index.json`；本地路径去掉文件名。
 *  返回 { manifest, readme, dir, r2 }：manifest 为解析后的对象（失败 null），readme 为原文（失败 ''），
 *  r2 = pickR2Fields(manifest)——manifest v5 的 launchers / dshVersions 有什么带什么。 */
export async function fetchMarketPackDetail(host, indexPath, entry) {
  const dir = packDirId(entry);
  if (!dir) return { manifest: null, readme: '', dir: '', r2: {} };
  const base = detailBase(indexPath);
  const manifestSrc = `${base}packs/${dir}/manifest.json`;
  const readmeSrc = `${base}packs/${dir}/README.md`;

  const [rawManifest, readme] = await Promise.all([
    fetchText(host, manifestSrc).catch(() => null),
    fetchText(host, readmeSrc).catch(() => ''),
  ]);
  let manifest = null;
  if (rawManifest) {
    try { manifest = JSON.parse(rawManifest); } catch { manifest = null; }
  }
  return { manifest, readme, dir, r2: pickR2Fields(manifest) };
}

/** 取文本（本地路径或 http(s) URL）：URL 走 host.download 拉到临时文件再读（读完清理）；否则当本地路径读。 */
async function fetchText(host, src) {
  if (!/^https?:\/\//i.test(src)) {
    return (await host.readTextFile(host.resolvePath(src))) ?? '';
  }
  const tmp = await host.mkdtemp('pfx-mkt-');
  try {
    const dest = host.joinPath(tmp, 'detail.json');
    await host.download(src, dest);
    return (await host.readTextFile(dest)) ?? '';
  } finally {
    await host.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/** 由 index 路径推导 detail base（去掉 `index.json` 尾段，保留结尾分隔符）。 */
function detailBase(indexPath) {
  const s = String(indexPath ?? '');
  return s.replace(/index\.json$/i, '');
}

/** 解析索引 JSON：空内容 / 非 JSON / 缺数组字段时返回带 error 的对象。 */
function parseIndex(text) {
  const s = String(text ?? '').trim();
  if (!s) return { index: {}, error: '市场索引内容为空' };
  try {
    const index = JSON.parse(s);
    if (!Array.isArray(index?.modpacks) && !Array.isArray(index?.packs)) {
      return { index, error: '市场索引缺少 modpacks[] 或 packs[] 字段' };
    }
    return { index, error: null };
  } catch {
    return { index: {}, error: `市场索引不是有效 JSON（开头：${s.slice(0, 80)}）` };
  }
}

/** 归一化一条市场条目；不可识别返回 null。 */
export function normalizeMarketPack(entry, locale = 'zh-CN') {
  if (!entry || typeof entry.name !== 'string') return null;
  const urls = collectUrls(entry);
  const manifestVersion = entry.manifestVersion ?? inferManifestVersion(urls);
  return {
    name: entry.name,
    displayName: pickLocale(entry.displayName, locale, entry.name),
    description: pickLocale(entry.description, locale, ''),
    version: entry.version ?? '',
    author: entry.author ?? '',
    icon: pickLocale(entry.icon, locale, ''),
    dshVersion: entry.dshVersion ?? '',
    type: entry.type ?? inferType(manifestVersion),
    profileName: entry.profileName ?? entry.name,
    defaultProfile: entry.defaultProfile ?? '',
    category: entry.category ?? '',
    updatedAt: entry.updatedAt ?? '',
    manifestVersion,
    format: detectFormat(entry, urls, manifestVersion),
    urls,
    downloadUrl: urls[0] ?? '',
    sha256: entry.sha256 ?? entry.files?.[0]?.sha256 ?? '',
    size: entry.size ?? entry.files?.[0]?.size ?? 0,
    id: entry.id ?? '',
    owner: entry.owner ?? '',
    repo: entry.repo ?? '',
    // 精简索引不再平铺这些字段；完整值见 fetchMarketPackDetail 懒加载的 manifest。
    bundles: entry.bundles ?? [],
    dependencies: entry.dependencies ?? {},
    profiles: entry.profiles,
    presets: entry.presets,
    skills: entry.skills,
    // v5 r2（index 契约 §3/§6.5）：索引只带派生标记 launcherRestricted（列表廉价过滤用），
    // 完整 launchers / dshVersions 在懒加载 manifest；此处宽容透传——条目里带了就带出。
    launcherRestricted: entry.launcherRestricted === true,
    ...pickR2Fields(entry),
  };
}

function collectUrls(entry) {
  if (Array.isArray(entry.files) && entry.files.length) {
    const out = [];
    for (const f of entry.files) for (const u of f.urls ?? []) out.push(u);
    if (out.length) return out;
  }
  return entry.downloadUrl ? [entry.downloadUrl] : [];
}

function detectFormat(entry, urls, manifestVersion) {
  if (urls.some((u) => /\.dspack(\?|#|$)/i.test(u))) return 'dspack';
  if (urls.some((u) => /\.tgz(\?|#|$)/i.test(u))) return 'tgz';
  if (manifestVersion === 5 || manifestVersion === 4) return 'dspack';
  if (manifestVersion === 3) return 'tgz';
  return 'unknown';
}

/** manifestVersion → type 兜底（未显式声明 type 时）。 */
function inferType(manifestVersion) {
  return manifestVersion === 5 ? 'dshhome' : 'profile';
}

function inferManifestVersion(urls) {
  if (urls.some((u) => /\.dspack/i.test(u))) return 4;
  if (urls.some((u) => /\.tgz/i.test(u))) return 3;
  return 0;
}

function pickLocale(map, locale, fallback) {
  if (typeof map === 'string' && map) return map;
  if (map && typeof map === 'object') {
    if (typeof map[locale] === 'string') return map[locale];
    const first = Object.values(map).find((v) => typeof v === 'string');
    if (first) return first;
  }
  return fallback ?? '';
}
