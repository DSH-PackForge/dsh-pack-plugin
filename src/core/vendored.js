// v5 r2 vendored 依赖内嵌（specs/manifest/v5.md §12 + specs/pack-structure/v3.md §8）——消费侧实现。
//
// 职责：把「显式 vendored{}」与「DSHL vendor: 方言（v3 §8.5）」统一归一为
// 「坐标 → 校验过的 tarball」，并在**阶段 0（未动任何文件）**完成对账与逐 tarball
// sha256/size 预验——装前发现损坏优于装到一半发现（manifest v5 §11.1）。
//
// 安装路径（统一算法 v3 §8.3）：
// - 显式 vendored 条目：tarball 落盘到 <target>/vendor-blobs/，重建 package.json 时把
//   该坐标的依赖 spec 改写为 `file:vendor-blobs/...`（manifest 不动；规范对 git 坐标
//   明确允许 file: 引用，npm 坐标以 file: 达到与「store 预填充」等价的本地优先效果），
//   随后 `pnpm install --prefer-offline`——本地命中的直接用副本，未命中的走 registry。
// - DSHL 方言条目（dependencies 值 = `vendor:<file>.tgz`）：tarball 校验后直挂
//   （direct-mount，v3 §8.3）进 node_modules/<name>，并从重建的 package.json 依赖中剔除。
import { untar, buildTarball } from './tar.js';
import { parseGitCoord, parsePkgGitSpec, VENDORED_REASONS } from './manifest.js';

const decoder = new TextDecoder();

/** DSHL 方言依赖 spec 前缀（v3 §8.5：`vendor:<file>.tgz`）。 */
const DIALECT_SPEC = /^vendor:/i;

/** zip entries 里 vendor/ 下的**文件**条目（排除 vendor.json 本身与目录占位）。 */
function vendorFileEntries(entries) {
  return Object.keys(entries).filter((p) => p.startsWith('vendor/') && p !== 'vendor/vendor.json' && !p.endsWith('/'));
}

/** 所有形态的依赖坐标合集（profile：dependencies；dshhome：各 profile 依赖并集）。 */
export function allDependencyCoords(manifest) {
  if (manifest?.type === 'dshhome') {
    const set = new Set();
    for (const u of Object.values(manifest.profiles ?? {})) {
      for (const k of Object.keys(u?.dependencies ?? {})) set.add(k);
    }
    return set;
  }
  return new Set(Object.keys(manifest?.dependencies ?? {}));
}

/**
 * 解析 DSHL 方言（消费宽容，生产禁止）：vendor/vendor.json `{packages:[{file,name,sha256}]}`
 * → 隐式 vendored 条目（key = 包名）。无方言痕迹时返回 {}。
 */
function dialectEntries(manifest, entries) {
  const raw = entries['vendor/vendor.json'];
  if (!raw) return {};
  let json;
  try {
    json = JSON.parse(decoder.decode(raw));
  } catch {
    throw new Error('vendor/vendor.json 不是有效 JSON（DSHL 方言包损坏）');
  }
  const out = {};
  for (const p of json?.packages ?? []) {
    if (!p || typeof p.file !== 'string' || !p.file) continue;
    if (typeof p.name !== 'string' || !p.name) continue;
    if (typeof p.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(p.sha256)) continue;
    // 方言 file 名同样禁止路径穿越
    if (p.file.includes('..') || p.file.startsWith('/') || /^[a-zA-Z]:/.test(p.file)) continue;
    out[p.name] = { path: `vendor/${p.file}`, sha256: p.sha256.toLowerCase(), size: null, version: null, dialect: true };
  }
  return out;
}

/** 安全的 vendor/ 内相对路径校验：必须落在 vendor/ 下、以 .tgz 结尾、无 `..` / 盘符 / 绝对路径。 */
function safeVendorPath(p) {
  const rel = String(p ?? '').replace(/\\/g, '/');
  if (!rel.startsWith('vendor/')) throw new Error(`vendored[].path 必须位于 vendor/ 下：${p}`);
  if (!rel.endsWith('.tgz')) throw new Error(`vendored[].path 必须是 .tgz：${p}`);
  if (rel.split('/').includes('..')) throw new Error(`vendored[].path 含危险段 '..'：${p}`);
  return rel;
}

/** 依赖 spec 是否为 DSHL 方言（`vendor:<file>.tgz`）。 */
export function isDialectSpec(spec) {
  return typeof spec === 'string' && DIALECT_SPEC.test(spec);
}

/**
 * 阶段 0：归一显式 vendored{} 与 DSHL 方言 → 对账 → 逐 tarball sha256/size 预验。
 * 任一不满足立即抛错（拒装），保证「装前发现」。
 *
 * @returns {{
 *   active: boolean,
 *   byCoord: Map<string, {path:string, sha256:string, size:number|null, version:string|null,
 *                          dialect?:boolean, bytes:Uint8Array}>,
 * }}
 *   active=false 表示包内无任何 vendored 内容（r1 包，行为与修订前完全一致）。
 */
export async function resolveVendoredPlan(host, manifest, entries, log = () => {}) {
  const files = vendorFileEntries(entries);
  const explicit = manifest.vendored && typeof manifest.vendored === 'object' && !Array.isArray(manifest.vendored) ? manifest.vendored : {};
  const dialect = dialectEntries(manifest, entries);
  if (!files.length && !Object.keys(explicit).length && !Object.keys(dialect).length) {
    return { active: false, byCoord: new Map() };
  }

  // 显式条目优先（§8.5：与方言并存时显式 vendored{} 优先）
  const byCoord = new Map(Object.entries(dialect).map(([k, v]) => [k, { ...v }]));
  for (const [coord, e] of Object.entries(explicit)) byCoord.set(coord, { ...e });

  // 对账：vendored key 必须 ∈ dependencies（dshhome 为各 profile 依赖并集）∪ lockfile packages
  // （v5 §12 约束 1：full 档闭包条目以随包 pnpm-lock.yaml 为准放行，key = npm 包名）
  const deps = allDependencyCoords(manifest);
  let lockNames = null;
  if (entries['pnpm-lock.yaml']) lockNames = lockfilePackageNames(decoder.decode(entries['pnpm-lock.yaml']));
  for (const coord of byCoord.keys()) {
    if (!deps.has(coord) && !lockNames?.has(coord)) {
      throw new Error(`vendored 条目「${coord}」不在 dependencies ∪ lockfile packages 中（对账失败，见 manifest v5 §12 约束 1）`);
    }
  }

  // vendor/ 内只允许 .tgz 且必须逐一经 vendored 登记（§8.2：未登记文件 → 拒装）
  const registered = new Set([...byCoord.values()].map((e) => safeVendorPath(e.path)));
  for (const p of files) {
    if (!p.endsWith('.tgz')) throw new Error(`vendor/ 内只允许 .tgz 文件（发现 ${p}）`);
    if (!registered.has(p)) throw new Error(`vendor/ 内存在未登记文件：${p}（vendored 清单无此条目）→ 拒装`);
  }

  // 逐 tarball sha256 + size 预验（装前发现优于装到一半发现）
  for (const [coord, e] of byCoord) {
    const rel = safeVendorPath(e.path);
    const bytes = entries[rel];
    if (!bytes || !bytes.length) throw new Error(`vendored 条目「${coord}」的 tarball 缺失或为空：${rel}`);
    if (Number.isInteger(e.size) && e.size > 0 && e.size !== bytes.length) {
      throw new Error(`vendored「${coord}」size 不符：期望 ${e.size}，实际 ${bytes.length}`);
    }
    const sha = await host.sha256(bytes);
    if (sha !== String(e.sha256 || '').toLowerCase()) {
      throw new Error(`vendored「${coord}」sha256 校验失败：期望 ${e.sha256}，实际 ${sha}`);
    }
    e.bytes = bytes;
    log(`vendored 预检通过：${coord} → ${rel}（${bytes.length} 字节）`);
  }

  return { active: true, byCoord };
}

/**
 * 直挂（direct-mount，v3 §8.3）：把方言 tarball 解进 node_modules/<name>（剥掉 `package/` 前缀）。
 * 只用于 DSHL 方言叶子插件；带传递依赖的包必须走统一算法。
 */
export async function directMount(host, target, name, entry, log = () => {}) {
  const files = untar(entry.bytes);
  let count = 0;
  for (const [p, data] of Object.entries(files)) {
    const rel = p.replace(/^package\//, '');
    if (!rel || rel === 'package') continue;
    if (rel.split('/').includes('..')) throw new Error(`tarball 内路径含 '..'：${p}（拒绝直挂）`);
    const dest = host.joinPath(target, 'node_modules', name, ...rel.split('/'));
    await host.writeFile(dest, data);
    count += 1;
  }
  if (!count) throw new Error(`vendored tarball 直挂失败：${name}（tarball 内无 package/ 文件）`);
  log(`直挂 ${name} → node_modules/${name}（${count} 个文件）`);
  return count;
}

/**
 * 重建 package.json 时的依赖 spec 决策：
 * - DSHL 方言 spec → 返回 null（从依赖中剔除，走直挂）；
 * - 显式 vendored 坐标 → 返回 `file:vendor-blobs/<dir>/<file>`（tarball 已由调用方落盘）；
 * - 其余 → 原样（coordsToPkgDeps 的产物）。
 *
 * @param {string} pkgName coordsToPkgDeps 产出的包名（git 坐标已折算为短名）
 * @param {string} coord manifest 侧原始坐标
 */
export function vendorDepSpec(plan, coord, pkgName, blobRel) {
  const entry = plan.byCoord.get(coord);
  if (!entry) return undefined; // 非 vendored 坐标，调用方保持原 spec
  if (entry.dialect) return null; // 方言：剔除依赖 + 直挂
  return `file:${blobRel}`;
}

/** 坐标 → vendor-blobs 子目录名（§8.1 建议编码：非 [a-z0-9-] 段替换为 __）。 */
export function coordDirName(coord) {
  return String(coord).replace(/[^a-zA-Z0-9-]+/g, '__');
}

/** tarball 在 vendor-blobs 下的相对路径（'/' 分隔，供 file: spec 使用）。 */
export function blobRelPath(coord, entry) {
  return `vendor-blobs/${coordDirName(coord)}/${entry.path.replace(/^vendor\//, '')}`;
}

/** 把 vendored tarball 落盘到 <target>/vendor-blobs/（file: 引用的实体）。 */
export async function materializeVendorBlobs(host, target, plan, coords, log = () => {}) {
  const written = [];
  for (const coord of coords) {
    const entry = plan.byCoord.get(coord);
    if (!entry || entry.dialect) continue;
    const rel = blobRelPath(coord, entry);
    await host.writeFile(host.joinPath(target, ...rel.split('/')), entry.bytes);
    log(`写入 ${rel}（vendored tarball，${entry.bytes.length} 字节）`);
    written.push(rel);
  }
  return written;
}

/* ---------------------------------------------------------------------------
 * 闭包完整性检测（v3 §8.3：「离线可装」是覆盖完整性派生的属性，不是包的声明）
 * 对照随包 pnpm-lock.yaml 的 packages:/snapshots: 区块，检查 vendored 是否覆盖全部依赖。
 * 完整 → 启动器可自选严格 `pnpm install --offline`（零网络、缺件即报错）。
 * ------------------------------------------------------------------------- */

/**
 * 从 pnpm-lock.yaml 的 packages:/snapshots: 区块收集全部依赖条目（key `name@version` → {name, version}）。
 * 区块内条目缩进一致（标准 2 空格，以首个条目缩进为准），嵌套字段（resolution/dependencies…）更深，不收集。
 * scoped 条目（`@scope/pkg@1.0.0`）取 lastIndexOf('@') 前为名；git 条目（`pkg@github:owner/repo#sha`）
 * 版本为 `github:...` 整段；解析器别名 key（`pkg@1.0.0(browser)`）取括号前。
 * packages: 与 snapshots: 会对同一 `name@version` 重复登记 → 按 `name@version` 去重。
 * @returns {Array<{name: string, version: string}>|null} 无 packages/snapshots 条目时返回 null（无法判定）。
 */
export function lockfilePackageEntries(lockText) {
  if (!lockText) return null;
  const out = [];
  const seen = new Set();
  let inSection = false;
  let entryIndent = -1;
  for (const line of String(lockText).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!inSection) {
      if (/^(packages|snapshots):\s*$/.test(trimmed)) inSection = true;
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (indent === 0) {
      // 其它顶层区块（importers: 等）→ 当前区块结束；packages:/snapshots: 连续出现则继续
      if (!/^(packages|snapshots):\s*$/.test(trimmed)) inSection = false;
      entryIndent = -1;
      continue;
    }
    // key 匹配到行尾的 ':'（git 条目 key 含 ':'，如 `'pkg@github:owner/repo#sha':`，不能用 [^:]+）
    const key = line.match(/^\s*(.+):\s*$/);
    if (!key) continue;
    if (entryIndent === -1) entryIndent = indent;
    if (indent !== entryIndent) continue; // 嵌套字段（resolution: / dependencies: / …）
    let k = key[1].replace(/^['"]|['"]$/g, '').trim();
    const paren = k.indexOf('('); // 解析器别名 key（如 "pkg@1.0.0(browser)"）取括号前
    if (paren > 0) k = k.slice(0, paren);
    const name = k.startsWith('@') ? k.slice(0, k.lastIndexOf('@')) : k.split('@')[0];
    if (!name) continue;
    // 版本 = 名后余段（scoped 用 lastIndexOf；git 条目版本为 `github:...` 整段）
    const version = k.length > name.length + 1 ? k.slice(name.length + 1) : '';
    const dedupe = `${name}@${version}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({ name, version });
  }
  return out.length ? out : null;
}

/**
 * 从 pnpm-lock.yaml 的 packages:/snapshots: 区块收集全部依赖包名（`name@version` → `name`）。
 * lockfilePackageEntries 的包名投影（既有调用方 computeOfflineCoverage 的兼容包装）。
 * @returns {Set<string>|null} 无 packages/snapshots 条目时返回 null（无法判定）。
 */
export function lockfilePackageNames(lockText) {
  const entries = lockfilePackageEntries(lockText);
  if (!entries) return null;
  const names = new Set(entries.map((e) => e.name));
  return names.size ? names : null;
}

/**
 * 对照 lockfile 判定 vendored 闭包覆盖：lockfile 里每个依赖包名都能由 vendored 坐标提供 → complete。
 * @returns {{complete: boolean, missing: string[], total: number}|null}
 *   null = 无法判定（无 vendor 活动条目 / lockfile 无 packages 条目），调用方保持 --prefer-offline。
 */
export function computeOfflineCoverage(lockText, plan) {
  if (!plan?.active) return null;
  const names = lockfilePackageNames(lockText);
  if (!names) return null;
  const vendoredNames = new Set();
  for (const [coord, e] of plan.byCoord) {
    const git = parseGitCoord(coord);
    vendoredNames.add(git ? git.name : coord);
    // git 坐标：lockfile 以**包名**登记（如 `other-theme@github:owner/repo#sha`），
    // 与仓库名折算可能不同 → 把 tarball 内 package.json 的真实包名一并计入覆盖集。
    const tp = e?.bytes ? tarballPackageJson(e.bytes) : null;
    if (tp?.name) vendoredNames.add(tp.name);
  }
  const missing = [...names].filter((n) => !vendoredNames.has(n));
  return { complete: missing.length === 0, missing, total: names.size };
}

/* ---------------------------------------------------------------------------
 * 导出侧（v3 §8.6 打包端义务）：依赖清单（供 UI 手动勾选）+ 按选择内嵌 vendored。
 *
 * 设计：**手动选择为主，探测为辅**——UI 经 listProfileDependencies 列出依赖让作者勾选；
 * 勾选后按坐标类型取件：
 *   - `file:vendor-blobs/...`（装过 vendored 包的 profile）→ 直接复用原 tarball 字节（round-trip）；
 *   - npm 精确版本 → 先试 registry 取原件（字节一致）；取不到（上游消失 / 断网）→ 从
 *     node_modules 重打包，版本按 §8.6 加 `-local.N` 后缀（上游不存在的 prerelease）；
 *   - git 坐标 → 从 node_modules 重打包（不依赖 git 环境）。
 * 重打包版本的「三处一致」（dependencies 值 / vendored[].version / tarball 内 version）
 * 由本模块统一保证；安装端禁止改写包内字节（§8.6 第 6 条）。
 * ------------------------------------------------------------------------- */

/** 上游不存在的本地版本后缀（§8.6 第 3 条：禁止 `+` build metadata，npm 匹配会忽略）。 */
const LOCAL_VERSION_SUFFIX = /-local\.\d+$/;

/** registry 缺省地址（与安装侧一致，可被 opts.registry 覆盖）。 */
const DEFAULT_REGISTRY = 'https://registry.npmjs.org/';

/** 读 tarball 内 package.json（不落盘；损坏/缺失 → null）。 */
function tarballPackageJson(tgz) {
  try {
    const files = untar(tgz);
    const raw = files['package/package.json'];
    if (!raw) return null;
    return JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return null;
  }
}

/**
 * 从 vendor-blobs 子目录名反推坐标（round-trip 展示用，非权威）：
 * `github__owner__repo` → `github:owner/repo`；`@scope__pkg` → `@scope/pkg`；
 * 其余（普通 npm 名，无 `__`）原样；反推不出的回落 tarball 包名。
 */
export function coordFromDirName(dir, fallbackName = '') {
  const parts = String(dir ?? '').split('__');
  if (parts[0] === 'github' && parts.length === 3) return `github:${parts[1]}/${parts[2]}`;
  if (String(dir).startsWith('@') && parts.length === 2) return parts.join('/');
  return fallbackName || String(dir);
}

/**
 * 列出 profile（一个或多个目录）的依赖清单（UI 勾选列表的数据源）。
 * @param {Host} host
 * @param {string[]} dirs 依赖来源目录（profile 形态传 [profileDir]；dshhome 传各 profile 目录）
 * @returns {Promise<Array<{pkgName, spec, coord, kind, version, vendored, installed, dir}>>}
 *   kind ∈ 'npm'（registry 精确版本）| 'git'（github sha）| 'vendored'（file:vendor-blobs 复用）。
 */
export async function listProfileDependencies(host, dirs) {
  const out = [];
  const seen = new Set();
  for (const dir of dirs ?? []) {
    const pkgRaw = await host.readTextFile(host.joinPath(dir, 'package.json'));
    let deps = null;
    try { deps = JSON.parse(pkgRaw ?? '')?.dependencies; } catch { deps = null; }
    if (!deps || typeof deps !== 'object') continue;
    for (const [pkgName, spec] of Object.entries(deps)) {
      if (typeof spec !== 'string' || !spec) continue;
      const item = { pkgName, spec, coord: pkgName, kind: 'npm', version: spec, vendored: false, installed: false, dir };
      if (spec.startsWith('file:vendor-blobs/')) {
        const rel = spec.slice('file:'.length);
        const bytes = await host.readFile(host.joinPath(dir, ...rel.split('/')));
        const tp = bytes ? tarballPackageJson(bytes) : null;
        if (bytes && tp) {
          item.kind = 'vendored';
          item.vendored = true;
          item.coord = coordFromDirName(rel.split('/')[1], tp.name || pkgName);
          item.version = typeof tp.version === 'string' ? tp.version : '';
        } else {
          item.version = '(tarball 缺失)';
        }
      } else {
        const git = parsePkgGitSpec(spec);
        if (git) {
          item.kind = 'git';
          item.coord = `github:${git.owner}/${git.repo}${git.subpath ? `#path:/${git.subpath}` : ''}`;
          item.version = git.sha || 'latest';
        }
      }
      const installedPkg = await host.readTextFile(host.joinPath(dir, 'node_modules', pkgName, 'package.json'));
      item.installed = installedPkg != null;
      // 同名依赖出现在多个 profile（dshhome）：保留首个带 vendor-blobs 的，否则首个
      const key = `${item.coord}`;
      if (seen.has(key)) {
        const prev = out.find((x) => x.coord === key);
        if (prev && !prev.vendored && item.vendored) Object.assign(prev, item);
        continue;
      }
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

/** 递归收集目录内文件（跳过任意层级的 node_modules；返回 { rel: bytes }，rel 用 '/' 分隔）。 */
async function collectDirFiles(host, absDir, prefix = '') {
  const out = {};
  const entries = await host.readdir(absDir);
  if (!entries) return out;
  for (const e of entries) {
    if (e.name === 'node_modules') continue;
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.type === 'dir') {
      Object.assign(out, await collectDirFiles(host, e.abs, rel));
    } else if (e.type === 'file') {
      const data = await host.readFile(e.abs);
      if (data) out[rel] = data;
    }
  }
  return out;
}

/**
 * 从 node_modules/<pkgName> 重打包 npm tarball（§8.6 第 3 条）：
 * - 版本加 `-local.N` 后缀（已是本地后缀则保留）——上游不存在的 prerelease，老启动器响亮失败；
 * - tarball 内 package.json 的 version 与返回值一致（三处一致的「包内」一侧）。
 * @returns {{bytes, version, fileCount}}
 */
export async function repackageFromNodeModules(host, lookupDirs, pkgName, pinnedVersion) {
  for (const dir of lookupDirs) {
    const pkgDir = host.joinPath(dir, 'node_modules', pkgName);
    const pkgRaw = await host.readTextFile(host.joinPath(pkgDir, 'package.json'));
    if (pkgRaw == null) continue;
    let pkg;
    try { pkg = JSON.parse(pkgRaw); } catch { pkg = null; }
    if (!pkg || typeof pkg !== 'object') throw new Error(`node_modules/${pkgName}/package.json 不是有效 JSON，无法重打包`);
    const base = typeof pkg.version === 'string' && pkg.version ? pkg.version : pinnedVersion;
    const version = LOCAL_VERSION_SUFFIX.test(base) ? base : `${base}-local.1`;
    const files = await collectDirFiles(host, pkgDir);
    if (!Object.keys(files).length) throw new Error(`node_modules/${pkgName} 目录为空，无法重打包`);
    pkg.version = version;
    files['package.json'] = new TextEncoder().encode(JSON.stringify(pkg, null, 2) + '\n');
    const tarFiles = {};
    for (const [rel, data] of Object.entries(files)) tarFiles[`package/${rel}`] = data;
    return { bytes: buildTarball(tarFiles), version, fileCount: Object.keys(files).length };
  }
  throw new Error(`本地找不到 ${pkgName}（node_modules 未安装该包），且无法从上游取件——无法内嵌`);
}

/** pnpm 虚拟 store（node_modules/.pnpm/）目录名编码：`/` → `+`（`@scope/pkg` → `@scope+pkg`；git 版本段同理）。 */
function pnpmStoreKey(s) {
  return String(s).replace(/\//g, '+');
}

/**
 * 从 node_modules/.pnpm/<name>@<version>/node_modules/<name> 重打包闭包条目（v3 §8.6 思路 + .pnpm 查找）。
 * 与 repackageFromNodeModules 的关键差异：闭包条目**保持 lockfile 版本**（不加 `-local.N` 后缀）——
 * 离线解析时 pnpm 按 lockfile 的 `name@version` 找件，版本漂移会导致永不命中；闭包条目不在
 * dependencies 中，无「老启动器静默装上游」风险，无需响亮失败标记。
 * 查找顺序：每个 lookupDir 的 .pnpm 下先试精确 `name@version`（含原样 / '+' 编码两种形态），
 * 再前缀匹配 peer 后缀变体（`name@version(peer...)`）。
 * @returns {{bytes, version, fileCount}|null} 各 lookupDir 均未命中时返回 null（调用方 skip + note）。
 */
async function repackageFromPnpmStore(host, lookupDirs, pkgName, version) {
  const candidates = [`${pkgName}@${version}`, `${pnpmStoreKey(pkgName)}@${pnpmStoreKey(version)}`];
  for (const dir of lookupDirs) {
    const listing = await host.readdir(host.joinPath(dir, 'node_modules', '.pnpm'));
    if (!listing) continue;
    const hit = listing.find((e) => e.type === 'dir' && candidates.some(
      (c) => e.name === c || e.name.startsWith(`${c}(`),
    ));
    if (!hit) continue;
    const pkgDir = host.joinPath(hit.abs, 'node_modules', pkgName);
    const pkgRaw = await host.readTextFile(host.joinPath(pkgDir, 'package.json'));
    if (pkgRaw == null) continue;
    let pkg = null;
    try { pkg = JSON.parse(pkgRaw); } catch { pkg = null; }
    if (!pkg || typeof pkg !== 'object') continue;
    const files = await collectDirFiles(host, pkgDir);
    if (!Object.keys(files).length) continue;
    pkg.version = version; // 与 lockfile 一致（闭包条目的版本基准是 lockfile，非上游）
    files['package.json'] = new TextEncoder().encode(JSON.stringify(pkg, null, 2) + '\n');
    const tarFiles = {};
    for (const [rel, data] of Object.entries(files)) tarFiles[`package/${rel}`] = data;
    return { bytes: buildTarball(tarFiles), version, fileCount: Object.keys(files).length };
  }
  return null;
}

/** 从 registry 拉 npm 原件 tarball（字节与上游一致）；失败返回 null（调用方回落重打包）。 */
async function fetchRegistryTarball(host, pkgName, version, registry, log) {
  const base = pkgName.includes('/') ? pkgName.slice(pkgName.lastIndexOf('/') + 1) : pkgName;
  const url = `${registry}/${pkgName}/-/${base}-${version}.tgz`;
  const tmp = await host.mkdtemp('dspack-vendor-');
  try {
    const dest = host.joinPath(tmp, 'pkg.tgz');
    await host.download(url, dest);
    const bytes = await host.readFile(dest);
    return bytes && bytes.length ? bytes : null;
  } catch (e) {
    log(`registry 取件失败（${url}）：${e?.message ?? e} → 回落本地重打包`);
    return null;
  } finally {
    await host.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * 探测 npm 上游是否存活（registry 元数据，轻量小文件）：
 * 200 → true；404 → false（上游消失）；探测失败 / 断网 / 宿主无 download → null（未知，跳过不内嵌）。
 */
async function probeNpmAlive(host, pkgName, version, registry) {
  if (typeof host.download !== 'function') return null;
  const url = `${registry}/${pkgName}/${version}`;
  const tmp = await host.mkdtemp('dspack-probe-');
  try {
    const dest = host.joinPath(tmp, 'meta.json');
    await host.download(url, dest);
    return true;
  } catch (e) {
    return /HTTP 404/.test(String(e?.message ?? e)) ? false : null;
  } finally {
    await host.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * 展开手动选择为最终内嵌清单（vendor 档位，workspace-config v1 r2 / pack-structure v3 §8.6）：
 * - `'off'`：清空（禁用内嵌，手动选择也忽略）；
 * - `'auto'`（默认）：手动选择 ∪ { vendor-blobs round-trip } ∪ { 上游消失的 npm 依赖（探测 404）}；
 * - `'full'`：手动选择 ∪ 全部直接依赖 ∪ 传递闭包（离线包形态；闭包沿 pnpm-lock.yaml 由
 *   collectVendoredForExport 的 closure 阶段收齐，安装端 computeOfflineCoverage 判定完整性）。
 * @returns {{selection: object, probed: string[]}} probed = 自动补选的坐标（供日志/结果展示）。
 */
export async function expandVendorSelection(host, lookupDirs, manualSel, knob, opts = {}) {
  if (knob === 'off') return { selection: {}, probed: [] };
  const mode = knob === 'full' ? 'full' : 'auto';
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  const registry = opts.registry || DEFAULT_REGISTRY;
  const selection = { ...(manualSel ?? {}) };
  const probed = [];

  const items = await listProfileDependencies(host, lookupDirs);
  for (const item of items) {
    if (Object.hasOwn(selection, item.coord)) continue;
    if (item.kind === 'vendored') {
      // round-trip：装过 vendored 包的 profile 默认保持内嵌（字节复用，零探测）
      selection[item.coord] = 'explicit';
      probed.push(item.coord);
      continue;
    }
    if (mode === 'full') {
      selection[item.coord] = 'explicit';
      probed.push(item.coord);
      continue;
    }
    // auto：npm 依赖探测上游（git 依赖不探测，视为存活——git ls-remote 依赖 git 环境）
    if (item.kind === 'npm') {
      const alive = await probeNpmAlive(host, item.pkgName, item.version, registry);
      if (alive === false) {
        selection[item.coord] = 'upstream-missing';
        probed.push(item.coord);
        log(`自动内嵌「${item.coord}」：上游 ${item.version} 已消失（registry 404）`);
      }
    }
  }
  return { selection, probed };
}

/**
 * 按手动选择内嵌 vendored 依赖（导出侧核心入口）。
 * @param {Host} host
 * @param {string[]} lookupDirs 依赖与 node_modules 的来源目录（profile 形态 [profileDir]；dshhome 各 profile 目录）
 * @param {object} baseDependencies 导出 manifest 的 dependencies（坐标 → 版本/file:spec）
 * @param {object} selection UI 勾选结果：{ 坐标: reason }（reason 缺省 'explicit'，须 ∈ VENDORED_REASONS）
 * @param {object} opts { registry?, log?, closure?, lockText? }
 *   closure=true（vendor=full 档）且提供 lockText 时，直接依赖内嵌完成后沿 pnpm-lock.yaml
 *   收齐传递闭包（未覆盖条目逐个取件：registry 原件优先 → .pnpm 重打包回退 → skip + note）。
 * @returns {Promise<{vendored, dependencies, entries, notes}>}
 *   entries 为归档内 `vendor/...` 条目；dependencies 为改写后的 manifest dependencies（三处一致）。
 *   闭包条目 vendored key = npm 包名（不在 dependencies 中，由 §12 约束 1 的闭包规则放行）。
 */
export async function collectVendoredForExport(host, lookupDirs, baseDependencies, selection, opts = {}) {
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  const registry = opts.registry || DEFAULT_REGISTRY;
  const sel = selection && typeof selection === 'object' ? selection : {};
  const wantClosure = opts.closure === true;
  const lockEntries = wantClosure ? lockfilePackageEntries(opts.lockText) : null;
  const notes = [];
  if (wantClosure && !opts.lockText) {
    notes.push('未找到 pnpm-lock.yaml：full 档无法收集传递闭包（导出包非离线完整形态）');
    log('警告：full 档缺少 pnpm-lock.yaml，跳过闭包收集');
  }
  if (!Object.keys(sel).length && !lockEntries) {
    return { vendored: {}, dependencies: { ...baseDependencies }, entries: {}, notes };
  }

  for (const [coord, reason] of Object.entries(sel)) {
    if (!VENDORED_REASONS.has(reason)) {
      throw new Error(`vendored reason「${reason}」非法（仅支持 ${[...VENDORED_REASONS].join(' / ')}）`);
    }
  }

  const items = await listProfileDependencies(host, lookupDirs);
  const byCoord = new Map(items.map((i) => [i.coord, i]));

  const vendored = {};
  const entries = {};
  const dependencies = { ...baseDependencies };
  // 覆盖集合（full 档闭包收集用）：坐标折算名 + tarball 真实包名（git 坐标的 lockfile 名是包名）
  const covered = new Set();
  const cover = (coord, bytes) => {
    const git = parseGitCoord(coord);
    covered.add(git ? git.name : coord);
    const tp = tarballPackageJson(bytes);
    if (tp?.name) covered.add(tp.name);
  };

  for (const [coord, reason] of Object.entries(sel)) {
    const item = byCoord.get(coord);
    if (!item) throw new Error(`选择内嵌的依赖「${coord}」不在 profile 依赖中`);
    let bytes = null;
    let version = item.version;

    if (item.kind === 'vendored') {
      // round-trip：直接复用安装时落盘的 tarball 字节（版本后缀已固化，无需改写）
      const rel = item.spec.slice('file:'.length);
      bytes = await host.readFile(host.joinPath(item.dir, ...rel.split('/')));
      if (!bytes) throw new Error(`vendor-blobs tarball 缺失：${rel}（请重新安装该包）`);
      const tp = tarballPackageJson(bytes);
      version = typeof tp?.version === 'string' ? tp.version : item.version;
      log(`vendored「${coord}」：复用 vendor-blobs 原件（${bytes.length} 字节，v${version}）`);
    } else if (item.kind === 'npm') {
      // 先取 registry 原件（字节一致）；取不到 → 从 node_modules 重打包 + -local.N 后缀
      bytes = await fetchRegistryTarball(host, item.pkgName, item.version, registry, log);
      if (bytes) {
        log(`vendored「${coord}」：registry 原件（${bytes.length} 字节，v${item.version}）`);
      } else {
        const r = await repackageFromNodeModules(host, lookupDirs, item.pkgName, item.version);
        bytes = r.bytes;
        version = r.version;
        notes.push(`${coord}：上游取件失败，已从本地重打包为 v${r.version}（${r.fileCount} 个文件）`);
        log(`vendored「${coord}」：本地重打包 v${r.version}（${r.fileCount} 个文件）`);
      }
    } else {
      // git 坐标：从 node_modules 重打包（不依赖 git 环境；版本 = 钉死的 sha）
      const r = await repackageFromNodeModules(host, lookupDirs, item.pkgName, item.version);
      bytes = r.bytes;
      version = item.version;
      notes.push(`${coord}：git 依赖按 node_modules 内容重打包`);
      log(`vendored「${coord}」：git 依赖本地重打包（${r.fileCount} 个文件）`);
    }

    // 归档路径：vendor/<坐标编码>/<原文件名>；manifest vendored[].path 是权威
    const base = item.spec.startsWith('file:vendor-blobs/')
      ? item.spec.slice(item.spec.lastIndexOf('/') + 1)
      : `${item.pkgName.includes('/') ? item.pkgName.slice(item.pkgName.lastIndexOf('/') + 1) : item.pkgName}-${version}.tgz`;
    const entryPath = `vendor/${coordDirName(coord)}/${base}`;
    if (entries[entryPath]) throw new Error(`vendored 归档路径冲突：${entryPath}`);
    entries[entryPath] = bytes;

    // dependencies 改写：删旧 key（file: 场景是 pkgName），写 坐标 → 最终版本（三处一致）
    delete dependencies[item.pkgName];
    delete dependencies[coord];
    dependencies[coord] = version;

    vendored[coord] = {
      version,
      sha256: await host.sha256(bytes),
      size: bytes.length,
      path: entryPath,
      ...(reason ? { reason } : {}),
    };
    cover(coord, bytes);
  }

  /* ------------------- 闭包收集（vendor=full 档，v3 §8.6 打包端义务） -------------------
   * 直接依赖内嵌完成后，对照 pnpm-lock.yaml 的 packages:/snapshots: 闭包，把未被覆盖的
   * 传递依赖逐个取件：registry 原件优先（字节一致）→ node_modules/.pnpm 重打包回退
   * （保持 lockfile 版本）→ 再失败 skip 并记 note（宁缺勿错，安装端 coverage 如实判缺）。
   * 闭包条目 vendored key = npm 包名（git 坐标直接依赖按 parseGitCoord 折算后对账覆盖）。
   * ---------------------------------------------------------------------------------- */
  if (lockEntries) {
    for (const { name, version } of lockEntries) {
      if (covered.has(name)) continue;
      if (!version) {
        notes.push(`闭包条目「${name}」在 lockfile 中无版本信息 → 跳过`);
        log(`闭包条目「${name}」缺少版本，跳过`);
        continue;
      }
      let bytes = await fetchRegistryTarball(host, name, version, registry, log);
      let ok = false;
      if (bytes) {
        // 防御 registry 返回非 tarball / 名实不符（别名包等）：名不符视作取件失败回落
        const tp = tarballPackageJson(bytes);
        if (tp?.name === name) {
          ok = true;
          log(`闭包条目「${name}」：registry 原件（${bytes.length} 字节，v${version}）`);
        }
      }
      if (!ok) {
        const r = await repackageFromPnpmStore(host, lookupDirs, name, version);
        if (!r) {
          notes.push(`闭包条目「${name}@${version}」取件失败（registry 与本地 .pnpm 均无原件）→ 跳过`);
          log(`闭包条目「${name}@${version}」取件失败，跳过`);
          continue;
        }
        bytes = r.bytes;
        notes.push(`${name}：registry 取件失败，已从本地 .pnpm 重打包为 v${r.version}（${r.fileCount} 个文件）`);
        log(`闭包条目「${name}」：.pnpm 重打包 v${r.version}（${r.fileCount} 个文件）`);
      }
      const base = `${name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name}-${version}.tgz`;
      const entryPath = `vendor/${coordDirName(name)}/${base}`;
      if (entries[entryPath]) throw new Error(`vendored 归档路径冲突：${entryPath}`);
      entries[entryPath] = bytes;
      vendored[name] = {
        version,
        sha256: await host.sha256(bytes),
        size: bytes.length,
        path: entryPath,
        reason: 'explicit',
      };
      covered.add(name);
    }
  }
  return { vendored, dependencies, entries, notes };
}
