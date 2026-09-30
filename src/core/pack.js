import { scanProfile, selectFiles } from './scan.js';
import { buildManifest, buildHomeManifest, validateManifest } from './manifest.js';
import { buildDspack, encodeText, decodeText, dspackMarker, DSPACK_CONTAINER_VERSION } from './dspack.js';
import { syncWorkspaceSettings } from './pnpm-settings.js';
import { coverageOfVendored } from './vendored.js';
import { collectVendoredForExport, listProfileDependencies, expandVendorSelection } from './vendored.js';

// .dspack（pack-structure v3）布局：根只放机器文件；其余用户文件进 overrides/。
const ROOT_MACHINE = new Set(['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml']);

// 体积阈值（publishing v1 §8 体积礼仪）：>500 MB 警告；>2 GiB 拒绝（GitHub Release 单资产上限）。
const SIZE_WARN_BYTES = 500 * 1024 * 1024;
const SIZE_MAX_BYTES = 2 * 1024 * 1024 * 1024;

function fmtBytes(n) {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
}

/** 归档体积阈值检查：超上限抛错拒绝打包；超警告线记日志（opts.sizeLimits 可覆盖，测试用）。 */
function checkPackSize(entries, opts, log) {
  const limits = opts.sizeLimits ?? { warn: SIZE_WARN_BYTES, max: SIZE_MAX_BYTES };
  const total = Object.values(entries).reduce((s, b) => s + (b?.length ?? 0), 0);
  if (limits.max > 0 && total > limits.max) {
    throw new Error(`整合包体积 ${fmtBytes(total)} 超过上限 ${fmtBytes(limits.max)}（GitHub Release 单资产上限 2 GiB，见 publishing v1 §8）。请改用 files[] 指针制或减小 vendored 覆盖范围`);
  }
  if (limits.warn > 0 && total > limits.warn) {
    log(`警告：整合包体积 ${fmtBytes(total)} 超过 ${fmtBytes(limits.warn)}——建议优先 files[] 指针制（重内容按需下载），仅在确需离线时全量 vendoring（publishing v1 §8）`);
  }
  return total;
}

/**
 * v5 r2：按 vendor 档位 + UI 手动勾选内嵌 vendor/ + 改写 manifest。
 * 档位（workspace-config v1 r2）：`'off'` 禁用；`'auto'`（默认）= 手动 ∪ round-trip（不联网探测）；
 * `'full'` = 手动 ∪ 全部直接依赖 ∪ 传递闭包（沿 lockText 的 pnpm-lock.yaml 收齐，离线包形态）。
 */
async function applyVendorSelection(host, manifest, lookupDirs, opts, progress, lockText = null) {
  if (opts.vendor === 'off') return null;
  const log = (s) => { if (typeof opts.onOutput === 'function') opts.onOutput(String(s) + '\n'); };
  const manual = opts.vendorCoords && typeof opts.vendorCoords === 'object' ? opts.vendorCoords : {};
  const { selection, probed } = await expandVendorSelection(host, lookupDirs, manual, opts.vendor, {
    registry: opts.registry,
    // §8.6.1 探测三态：默认关闭（导出不联网）；显式打开才探测上游存活
    probeUpstream: opts.probeUpstream === true,
    log,
  });
  if (!Object.keys(selection).length && opts.vendor !== 'full') return null;
  if (probed.length) log(`自动补选内嵌：${probed.join(', ')}`);
  progress('vendor', `内嵌 ${Object.keys(selection).length} 个 vendored 依赖（档位 ${opts.vendor ?? 'auto'}）`);
  const vr = await collectVendoredForExport(host, lookupDirs, manifest.type === 'dshhome' ? {} : (manifest.dependencies ?? {}), selection, {
    registry: opts.registry,
    log,
    closure: opts.vendor === 'full',
    lockText,
  });
  // dshhome 形态没有顶层 dependencies（依赖在各 profile 的 ProfileUnit 里），故只写 vendored；
  // 各 profile 的键回写由 packHome 用 vr.keysByCoord 完成。
  if (manifest.type !== 'dshhome') manifest.dependencies = vr.dependencies;
  manifest.vendored = vr.vendored;
  // §8.6.5 离线可装性自检（等价静态校验）：把「闭包是否收齐」在导出时就讲清楚，别等发版后才发现。
  const cov = coverageOfVendored(manifest.vendored, vr.entries, lockText);
  if (cov && !cov.complete) {
    const head = cov.missing.slice(0, 5).join(', ');
    log(`警告（离线可装性自检）：lockfile ${cov.total} 个依赖中 ${cov.missing.length} 个未被包内副本覆盖（${head}${cov.missing.length > 5 ? '…' : ''}）——该包离线装不上`);
  } else if (cov) {
    log(`离线可装性自检通过：lockfile ${cov.total} 个依赖全部由包内副本覆盖（安装端可加 --offline）`);
  }
  for (const note of vr.notes) log(`注意：${note}`);
  progress('vendor', `vendored 完成：${Object.keys(vr.vendored).length} 个 tarball 已内嵌`);
  return vr;
}

/** 打包前强校验（含 v5 r2 字段：dshVersions ∋ dshVersion、launchers 结构等）——错误在导出时报出，不带病出厂。
 * lockText（随包 pnpm-lock.yaml）供 vendored 闭包条目对账放行（§12 约束 1）。 */
function assertManifestValid(manifest, lockText = null) {
  const errors = validateManifest(manifest, { lockText });
  if (errors.length) {
    throw new Error(`导出的 manifest 不合法（${errors.join('；')}）——请检查「兼容性」等表单项后重试`);
  }
}

/** 把扫描出的相对路径映射为归档内条目名。 */
export function dspackEntryPath(rel) {
  const r = String(rel).replace(/\\/g, '/');
  return ROOT_MACHINE.has(r) ? r : `overrides/${r}`;
}

/**
 * 一键导出（单 profile）：扫描 Profile → 生成 manifest v5 → 打包 .dspack（dspack.json version 3）。
 * 全程只读用户 Profile 目录，在内存中拼 ZIP 后一次写盘，不落暂存清单。
 *
 * @param {Host} host
 * @param {{name: string, dir: string}} profile
 * @param {object} opts 见 buildManifest + { out, force }
 * @returns {Promise<{manifest, output, sha256, size, included, excluded}>}
 */
export async function packProfile(host, profile, opts = {}) {
  const progress = (stage, detail) => {
    if (typeof opts.onProgress === 'function') opts.onProgress(stage, detail);
  };

  progress('scan', `扫描 Profile「${profile.name}」`);
  const scan = await scanProfile(host, profile.dir);
  if (scan.files.length === 0) {
    throw new Error(`Profile「${profile.name}」没有可打包的文件（全部被过滤或目录为空）`);
  }
  // opts.include（rel 白名单）指定要包含的文件；未给则全量。
  const files = selectFiles(scan.files, opts.include);
  if (files.length === 0) {
    throw new Error(`没有选中的文件（请至少勾选一个文件/目录）`);
  }

  progress('manifest', '生成 manifest v5');
  const manifest = await buildManifest(host, profile, opts, scan);

  // home 级内容（上一级目录）：用户勾选的全局 skill / 预设等，进 home/ 目录（安装落到 $DSH_HOME 根）。
  const homeDir = opts.home || host.joinPath(profile.dir, '..', '..');
  const homeFiles = (await scanProfile(host, homeDir)).files.filter((f) => !f.rel.startsWith('profiles/'));
  const homeSet = opts.homeInclude instanceof Set ? opts.homeInclude : (opts.homeInclude ? new Set(opts.homeInclude) : null);
  // 前缀匹配：允许 homeInclude 传 `skills/` 等目录前缀（精确名或目录前缀皆可命中）。
  const selectedHome = homeSet
    ? homeFiles.filter((f) => [...homeSet].some((p) => f.rel === p || f.rel.startsWith(p)))
    : [];

  progress('collect', '读取文件内容');
  const entries = {};
  for (const f of files) {
    const data = await host.readFile(f.abs);
    if (!data) continue; // 读不到：跳过
    entries[dspackEntryPath(f.rel)] = data;
  }
  for (const f of selectedHome) {
    const data = await host.readFile(f.abs);
    if (!data) continue;
    entries[`home/${f.rel}`] = data;
  }
  // v5 r2：手动勾选的依赖内嵌（UI 依赖清单）→ vendor/ 条目 + manifest.vendored + dependencies 三处一致
  // full 档闭包收集以 profile 的 pnpm-lock.yaml 为准（与归档内快照同源）
  const lockText = await host.readTextFile(host.joinPath(profile.dir, 'pnpm-lock.yaml'));
  const vendorResult = await applyVendorSelection(host, manifest, [profile.dir], opts, progress, lockText);
  if (vendorResult) {
    Object.assign(entries, vendorResult.entries);
    entries['pnpm-workspace.yaml'] = encodeText(syncWorkspaceSettings(
      entries['pnpm-workspace.yaml'] ? decodeText(entries['pnpm-workspace.yaml']) : '',
      lockText,
    ));
  }

  // 打包前强校验（r2 字段结构 / dshVersion ∈ dshVersions 等；闭包条目按 lockfile 放行）
  assertManifestValid(manifest, lockText);

  // manifest.json 始终在归档根（契约头，覆盖任何扫描残留）；dspack.json 为容器标记。
  entries['manifest.json'] = encodeText(JSON.stringify(manifest, null, 2) + '\n');
  entries['dspack.json'] = encodeText(JSON.stringify(dspackMarker(DSPACK_CONTAINER_VERSION)) + '\n');

  checkPackSize(entries, opts, (s) => { if (typeof opts.onOutput === 'function') opts.onOutput(s + '\n'); });

  progress('pack', '打包 .dspack');
  const bytes = buildDspack(entries);
  const outDir = opts.out ? host.resolvePath(opts.out) : host.cwd();
  const outPath = host.joinPath(outDir, `${manifest.name}-${manifest.version}.dspack`);

  if ((await host.stat(outPath)) != null && !opts.force) {
    throw new Error(`输出文件已存在：${outPath}（使用 --force 覆盖）`);
  }
  await host.mkdir(outDir);
  progress('write', `写盘 ${outPath}`);
  await host.writeFile(outPath, bytes);

  return {
    manifest,
    output: outPath,
    sha256: await host.sha256(bytes),
    size: bytes.length,
    included: Object.keys(entries).length,
    excluded: scan.excluded.length,
    vendored: Object.keys(manifest.vendored ?? {}),
  };
}

/**
 * 一键导出（dshhome）：扫描整个 $DSH_HOME → 识别四类单元 → 生成 manifest v5 → 打包 .dspack（dspack.json version 3）。
 * overrides/ 按 home 相对路径平铺：profiles/、.agent-presets/、skills/、AGENTS.md、data/。
 *
 * @param {Host} host
 * @param {{name: string, dir: string}} home home 根目录
 * @param {object} opts { name, displayName, version, description, author, icon, dshVersion,
 *                        defaultProfile, include, out, force }
 * @returns {Promise<{manifest, output, sha256, size, included, excluded, summary}>}
 */
export async function packHome(host, home, opts = {}) {
  const progress = (stage, detail) => {
    if (typeof opts.onProgress === 'function') opts.onProgress(stage, detail);
  };

  progress('scan', `扫描 DSH_HOME「${home.name}」`);
  const scan = await scanProfile(host, home.dir);
  if (scan.files.length === 0) {
    throw new Error(`DSH_HOME「${home.name}」没有可打包的文件（全部被过滤或目录为空）`);
  }
  let files = selectFiles(scan.files, opts.include);
  // exclude：黑名单（rel 前缀），供「导出内容」开关排除 skill / preset / 指令 / 数据
  const excludes = opts.exclude ?? [];
  if (excludes.length) {
    files = files.filter((f) => !excludes.some((p) => f.rel === p || f.rel.startsWith(p)));
  }
  if (files.length === 0) {
    throw new Error(`没有选中的文件（请至少勾选一个文件/目录）`);
  }

  // 从扫描结果识别四类单元；web/headless（安装基线）不进包。
  const summary = summarizeHome(files);
  const profiles = [...summary.profiles.keys()]
    .filter((name) => name !== 'web' && name !== 'headless')
    .map((name) => ({ name, dir: host.joinPath(home.dir, 'profiles', name) }));
  const presets = {};
  for (const [id, path] of summary.presets) presets[id] = { path };

  const manifest = await buildHomeManifest(host, home, {
    name: opts.name,
    displayName: opts.displayName,
    version: opts.version,
    description: opts.description,
    author: opts.author,
    icon: opts.icon,
    dshVersion: opts.dshVersion,
    defaultProfile: opts.defaultProfile,
    profiles,
    presets,
    skills: summary.skills,
    instructions: summary.instructions || 'AGENTS.md',
    files: opts.files ?? [],
  });

  progress('collect', '读取文件内容');
  const entries = {};
  for (const f of files) {
    const data = await host.readFile(f.abs);
    if (!data) continue;
    entries[dspackEntryPath(f.rel)] = data;
  }

  // v5 r2：vendor 档位 + 手动勾选内嵌（vendor/ 是包级目录；依赖在各 profile 的 node_modules 里查找）。
  // 收集时按「坐标 → 版本」聚合，再回写每个 ProfileUnit（file:vendor-blobs 旧 key 一并替换）。
  // full 档闭包收集以 home 根的 pnpm-lock.yaml 为准（与归档内快照同源）。
  const lookupDirs = profiles.map((p) => p.dir);
  const lockText = await host.readTextFile(host.joinPath(home.dir, 'pnpm-lock.yaml'));
  const vendorResult = await applyVendorSelection(host, manifest, lookupDirs, opts, progress, lockText);
  if (vendorResult) {
    Object.assign(entries, vendorResult.entries);
    // §8.6.8 + 实测：带 vendor/ 的包必须让包内 pnpm-workspace.yaml 与随包 lockfile 的 settings
    // 一致，并写 minimumReleaseAge: 0（pnpm 11 发布冷静期，camelCase 才有效）。
    entries['pnpm-workspace.yaml'] = encodeText(syncWorkspaceSettings(
      entries['pnpm-workspace.yaml'] ? decodeText(entries['pnpm-workspace.yaml']) : '',
      lockText,
    ));
    // 逐 profile 回写键（v5 r3 §2）：被内嵌的直接依赖在 ProfileUnit 里也要写成 `vendor:<包名>`，
    // 值取内嵌时定下的精确版本（与 vendored[].version、tarball 内 version 三处一致）。
    const keysByCoord = vendorResult.keysByCoord ?? {};
    const vendored = manifest.vendored ?? {};
    for (const [name, unit] of Object.entries(manifest.profiles)) {
      const dir = host.joinPath(home.dir, 'profiles', name);
      const localList = await listProfileDependencies(host, [dir]);
      const deps = { ...(unit.dependencies ?? {}) };
      for (const item of localList) {
        const key = keysByCoord[item.coord];
        if (!key || !Object.hasOwn(vendored, key)) continue;
        delete deps[item.pkgName];
        delete deps[item.coord];
        deps[key] = vendored[key].version;
      }
      unit.dependencies = deps;
    }
  }

  // 打包前强校验（r2 字段结构 / dshVersion ∈ dshVersions 等；闭包条目按 lockfile 放行）
  assertManifestValid(manifest, lockText);

  entries['manifest.json'] = encodeText(JSON.stringify(manifest, null, 2) + '\n');
  entries['dspack.json'] = encodeText(JSON.stringify(dspackMarker(DSPACK_CONTAINER_VERSION)) + '\n');

  checkPackSize(entries, opts, (s) => { if (typeof opts.onOutput === 'function') opts.onOutput(s + '\n'); });

  progress('pack', '打包 .dspack');
  const bytes = buildDspack(entries);
  const outDir = opts.out ? host.resolvePath(opts.out) : host.cwd();
  const outPath = host.joinPath(outDir, `${manifest.name}-${manifest.version}.dspack`);

  if ((await host.stat(outPath)) != null && !opts.force) {
    throw new Error(`输出文件已存在：${outPath}（使用 --force 覆盖）`);
  }
  await host.mkdir(outDir);
  progress('write', `写盘 ${outPath}`);
  await host.writeFile(outPath, bytes);

  return {
    manifest,
    output: outPath,
    sha256: await host.sha256(bytes),
    size: bytes.length,
    included: Object.keys(entries).length,
    excluded: scan.excluded.length,
    summary,
  };
}

/**
 * 从扫描文件识别 dshhome 四类单元（相对 $DSH_HOME 根）：
 * - profiles：profiles/<name>/package.json
 * - presets：.agent-presets/<id>/agent.cordis.yml
 * - skills：skills/<name>.md（平铺）或 skills/<name>/SKILL.md（目录 bundle）
 * - instructions：根 AGENTS.md
 */
export function summarizeHome(files) {
  const profiles = new Map();
  const presets = new Map();
  const skills = [];
  const skillNames = new Set();
  let instructions = null;

  for (const f of files ?? []) {
    const rel = String(f.rel || '').replace(/\\/g, '/');
    if (!rel) continue;
    const seg = rel.split('/');

    if (seg[0] === 'profiles' && seg.length >= 3 && seg[2] === 'package.json') {
      profiles.set(seg[1], true);
      continue;
    }
    if (seg[0] === '.agent-presets' && seg.length >= 3 && seg[2] === 'agent.cordis.yml') {
      presets.set(seg[1], `.agent-presets/${seg[1]}`);
      continue;
    }
    if (seg[0] === 'skills') {
      if (seg.length === 2 && seg[1].endsWith('.md')) {
        const name = seg[1].slice(0, -3);
        if (!skillNames.has(name)) { skillNames.add(name); skills.push({ path: `skills/${name}` }); }
      } else if (seg.length >= 3 && seg[2] === 'SKILL.md') {
        if (!skillNames.has(seg[1])) { skillNames.add(seg[1]); skills.push({ path: `skills/${seg[1]}` }); }
      }
      continue;
    }
    if (rel === 'AGENTS.md') instructions = 'AGENTS.md';
  }

  return { profiles, presets, skills, instructions };
}
