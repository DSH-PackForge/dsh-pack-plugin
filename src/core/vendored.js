// vendored 依赖内嵌（specs/manifest/v5.md §12 + specs/pack-structure/v3.md §8）——**消费侧（导入侧）实现**。
//
// 主线范围：**只消费、不生产**。产出内嵌包的整条导出侧路径（档位 / 依赖清单 / 闭包收集 /
// codeload 原件 / 上游探测 / 离线可装性自检）在 `feat/vendoring` 分支上——主线为减少 bug
// 不再提供产包路径，但仍要能**装**那条分支产出的、带 `vendor/` 的包。
//
// 职责：把「显式 vendored{}」与「DSHL vendor: 方言（v3 §8.5）」统一归一为
// 「依赖键 → 校验过的 tarball」，并在**阶段 0（未动任何文件）**完成对账与逐 tarball
// sha256/size 预验——装前发现损坏优于装到一半发现（manifest v5 §11.1）。
//
// 安装路径（v3 §8.3）：tarball 落盘到 <target>/vendor-blobs/；`pnpm install` 之前把**落盘副本**
// `pnpm-lock.yaml` 按节点形态本地化（npm 支四处同步 `file:` / git 支只改 `resolution.tarball` /
// 闭包条目只改 `resolution.tarball`，见 lockfile.js），随后 `--frozen-lockfile --trust-lockfile`
// （覆盖完整时再加 `--offline`）；DSHL 方言条目校验后直挂 node_modules/<name> 并从依赖里剔除。
import { untar } from './tar.js';
import { findImporterDep } from './lockfile.js';

const decoder = new TextDecoder();

/** DSHL 方言依赖 spec 前缀（v3 §8.5：`vendor:<file>.tgz`）。 */
const DIALECT_SPEC = /^vendor:/i;

/** v5 r3 §2：`vendor:<包名>` 依赖键前缀（剥去**一次**前导前缀后余下即包名）。 */
export const VENDOR_KEY_PREFIX = 'vendor:';

/** npm 包名形状（`name` / `@scope/name`，不含协议字符）。 */
export function isPlausiblePkgName(name) {
  return typeof name === 'string' && /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(name);
}

/**
 * 依赖键 → 包名：带 `vendor:` 前缀返回包名，裸键返回 null（裸键 = 只从网络）。
 * 只剥**一次**：`vendor:vendor:x` 剥出 `vendor:x`，它不是合法包名 → 返回 null（判非法）。
 */
export function vendorKeyToName(key) {
  const s = String(key ?? '');
  if (!s.startsWith(VENDOR_KEY_PREFIX)) return null;
  const name = s.slice(VENDOR_KEY_PREFIX.length);
  return isPlausiblePkgName(name) ? name : null;
}

/**
 * 闭包条目键（v5 r3 §12 约束 1：`name@version`，不带前缀；同名多版本必须带版本）。
 * @returns {{name: string, version: string}|null}
 */
export function parseClosureKey(key) {
  const s = String(key ?? '');
  if (!s || s.startsWith(VENDOR_KEY_PREFIX)) return null;
  const at = s.lastIndexOf('@');
  if (at <= 0 || at === s.length - 1) return null;
  const name = s.slice(0, at);
  const version = s.slice(at + 1);
  if (!isPlausiblePkgName(name) || !version || version.includes('@')) return null;
  return { name, version };
}

/** registry 版本段的形状（semver 前缀；`0.3.0-local.1` 这类预发布也算）。 */
const SEMVER_LIKE = /^\d+\.\d+\.\d+/;

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

  // 显式条目优先（§8.5：与方言并存时显式 vendored{} 优先）。方言条目由 vendor/vendor.json
  // 负责（键 = 包名、来源即包内），不参与下面 r3 的键规则。
  const byCoord = new Map(Object.entries(dialect).map(([k, v]) => [k, { ...v, pkgName: k }]));
  const shadowedDialectPaths = []; // 被显式条目接管的方言 tarball：仍属「已登记」，只是不再使用
  for (const [key, raw] of Object.entries(explicit)) {
    const e = { ...raw };
    const name = vendorKeyToName(key);
    if (name) {
      e.kind = 'direct';
      e.pkgName = name;
      // §8.5「显式条目优先」：同名的方言隐式条目被接管 → 从计划里丢弃（否则它的 tarball
      // 会被要求必须存在，等于「丢弃」没生效）。其路径仍登记在案（由 vendor.json 声明）。
      const shadowed = byCoord.get(name);
      if (shadowed?.dialect) {
        shadowedDialectPaths.push(safeVendorPath(shadowed.path));
        byCoord.delete(name);
      }
    } else {
      const closure = parseClosureKey(key);
      if (!closure) {
        // 裸键 = 已废弃的 r2 形态（v5 r3 §12 约束 1：裸键不得出现在 vendored，来源冲突 → 拒装）
        throw new Error(`vendored 条目「${key}」键非法：直接依赖必须用 vendor:<包名>、闭包条目必须用 name@version；裸键是已废弃的 r2 形态 → 拒装`);
      }
      if (e.kind !== 'closure') {
        throw new Error(`vendored 条目「${key}」形如闭包键但未声明 kind:"closure"（v5 r3 §12 约束 1）`);
      }
      if (typeof e.name !== 'string' || !e.name) throw new Error(`闭包条目「${key}」缺少 name（v5 r3 §12）`);
      if (e.name !== closure.name) throw new Error(`闭包条目「${key}」的 name（${e.name}）与键不符`);
      e.pkgName = closure.name;
      e.version = e.version ?? closure.version;
    }
    byCoord.set(key, e);
  }

  // 对账（v5 r3 §12 约束 1）：
  //  - 直接依赖：vendor:<包名> 必须 ∈ dependencies（dshhome 为各 profile 依赖并集）；
  //  - 闭包条目：必须能在随包 pnpm-lock.yaml 里按 name@version 反查到（**反查 lockfile 是防夹带
  //    的安全约束**；缺 lockfile 就无法确认来源 → 拒装）。
  const deps = allDependencyCoords(manifest);
  const lockText = entries['pnpm-lock.yaml'] ? decoder.decode(entries['pnpm-lock.yaml']) : null;
  const lockEntries = lockText ? lockfilePackageEntries(lockText) : null;
  const lockKeys = lockEntries ? new Set(lockEntries.map((x) => `${x.name}@${x.version}`)) : null;
  for (const [key, e] of byCoord) {
    if (e.dialect) continue;
    if (e.kind === 'closure') {
      if (!lockKeys) throw new Error(`闭包条目「${key}」需要随包 pnpm-lock.yaml 才能反查来源（防夹带，v5 r3 §12 约束 1）→ 拒装`);
      if (!lockKeys.has(`${e.pkgName}@${e.version}`)) {
        throw new Error(`闭包条目「${key}」不在随包 pnpm-lock.yaml 的 packages:/snapshots: 中（防夹带校验失败）→ 拒装`);
      }
      continue;
    }
    if (!deps.has(key)) {
      throw new Error(`vendored 条目「${key}」不在 dependencies 中（vendor: 键必须 ∈ dependencies，见 v5 §12 约束 1）`);
    }
  }

  // vendor/ 内只允许 .tgz 且必须逐一经 vendored 登记（§8.2：未登记文件 → 拒装）
  const registered = new Set([
    ...[...byCoord.values()].map((e) => safeVendorPath(e.path)),
    ...shadowedDialectPaths, // 被显式条目接管的方言 tarball 由 vendor.json 声明，不算未登记
  ]);
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
    // 读 tarball 内 package.json 核对 name / version（v5 §8.3、§11.1.4；也是「三处一致」的兜底）：
    // 键上只有包名——若包里装的是另一个包，名字就对不上；版本对不上则是打包端漏了重算。
    // 兼容两种布局（npm `package/` 与 codeload `<repo>-<sha>/`），子目录 git 坐标按 lockfile 的
    // `&path:` 下探。
    const tp = tarballPackageJson(bytes, subpathFromLockfile(lockText, e.pkgName));
    if (!tp || typeof tp.name !== 'string' || !tp.name) {
      throw new Error(`vendored「${coord}」tarball 内 package.json 缺失或无可读 name → 拒装`);
    }
    if (tp.name !== e.pkgName) {
      throw new Error(`vendored「${coord}」tarball 内包名（${tp.name}）与键不符（期望 ${e.pkgName}）→ 拒装`);
    }
    if (e.version && tp.version !== e.version) {
      throw new Error(`vendored「${coord}」tarball 内版本（${tp.version}）与声明版本（${e.version}）不一致（三处一致，v5 §12 约束 4）`);
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
 * @deprecated 现由 install.js 直接拼 `file:${blobRelPath(...)}`（并显式处理方言剔除）；
 *   本函数在主线内已无调用方，保留仅为对外 API 兼容（产包侧分支仍用）。新代码请勿依赖。
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

/**
 * tarball 在 vendor-blobs 下的相对路径（'/' 分隔，供 file: spec 使用）。
 * 子目录取**包名**（r3 §2：包名以 tarball 内 `package.json` 的 name 为准）——比坐标更稳、可读，
 * 也让 r2→r3 的同名依赖落点不变。
 */
export function blobRelPath(key, entry) {
  return `vendor-blobs/${coordDirName(entry?.pkgName ?? key)}/${entry.path.replace(/^vendor\//, '')}`;
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
 * `lockfilePackageEntries` 的包名投影（对外 API；导入侧内部对账直接用完整条目，
 * 因为「版本级命中」判覆盖必须带版本）。
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
  const entries = lockfilePackageEntries(lockText);
  if (!entries?.length) return null;
  const coveredKeys = new Set();  // name@version（registry 节点：必须版本级命中）
  const coveredNames = new Set(); // 名称兜底（git / file: 节点的版本段不是 semver）
  for (const [key, e] of plan.byCoord) {
    const name = e.pkgName ?? vendorKeyToName(key) ?? parseClosureKey(key)?.name ?? null;
    if (!name) continue;
    coveredNames.add(name);
    const tp = e?.bytes ? tarballPackageJson(e.bytes) : null;
    const version = e.version ?? tp?.version ?? null;
    if (version) coveredKeys.add(`${name}@${version}`);
  }
  const missing = entries
    .filter((x) => {
      if (coveredKeys.has(`${x.name}@${x.version}`)) return false;
      // registry 版本（semver）必须版本级命中——同名不同版本不算覆盖，否则 --offline 会缺件；
      // git / file: 等非 semver 版本段按包名命中即可（lockfile 里的版本段是 URL/路径，不是版本）。
      if (SEMVER_LIKE.test(String(x.version))) return true;
      return !coveredNames.has(x.name);
    })
    .map((x) => `${x.name}@${x.version}`);
  return { complete: missing.length === 0, missing, total: entries.length };
}

/**
 * 读 tarball 内 package.json（不落盘；损坏/缺失 → null）。**两种布局都要认**：
 *   - npm 布局：`package/package.json`（registry 原件、以及本工具的重打包产物）；
 *   - codeload 布局：顶层 `<repo>-<sha>/package.json`（git 坐标的**上游原件**，见 v5 §8.1）
 *     —— 实测 codeload 归档顶层是 `<repo>-<sha>/`，不是 `package/`，只认 npm 布局会让
 *     阶段 0 把自家 git 内嵌条目全判成「tarball 内 package.json 缺失」而拒装。
 *   - 带 `#path:/子目录` 的 git 坐标再下探一层 `<repo>-<sha>/<子目录>/package.json`。
 * @param {Uint8Array} tgz
 * @param {string} [subpath] git 坐标的子目录（`github:o/r#path:/x` 的 `x`）
 */
function tarballPackageJson(tgz, subpath) {
  try {
    const files = untar(tgz);
    const candidates = ['package/package.json'];
    const roots = new Set();
    for (const p of Object.keys(files)) {
      const seg = p.split('/');
      if (seg.length === 2 && seg[1] === 'package.json' && seg[0] && seg[0] !== 'package') roots.add(seg[0]);
    }
    for (const root of roots) {
      const sub = String(subpath ?? '').replace(/^\/+|\/+$/g, '');
      // 子目录优先：monorepo 根也有 package.json，先探根就会拿到「仓库根」的名字而误判
      if (sub) candidates.push(`${root}/${sub}/package.json`);
      candidates.push(`${root}/package.json`);
    }
    for (const rel of candidates) {
      const raw = files[rel];
      if (!raw) continue;
      const json = JSON.parse(new TextDecoder().decode(raw));
      if (json && typeof json === 'object') return json;
    }
    return null;
  } catch {
    return null;
  }
}

/** 从随包 lockfile 里**该包**的 importer specifier 取 git 子目录（`…&path:pkg` / `…#path:/pkg`）。 */
function subpathFromLockfile(lockText, pkgName) {
  if (!lockText || !pkgName) return null;
  const dep = findImporterDep(lockText, pkgName);
  const spec = String(dep?.specifier ?? '');
  const m = /[#&]path:?\/?([\w./@-]+)/.exec(spec);
  if (!m) return null;
  const sub = m[1].replace(/^\/+|\/+$/g, '');
  return sub || null;
}

