import { parseDspack, decodeText } from './dspack.js';
import { validateManifest, coordsToPkgDeps, sanitizeSlug, parseGitCoord, normalizeLaunchers, compareLauncherVersions } from './manifest.js';
import { listInstalledDshVersions, sortVersionsDesc } from './discovery.js';
import { storeHomeRel } from './home-store.js';

/**
 * 一键安装：读取本地/URL 的 .dspack → 校验头 & manifest → 按 type 分支安装。
 * - profile（v5）：单 profile，装到 $DSH_HOME/profiles/<name>（现有语义，假设 DSH 已装）；
 * - dshhome（v5）：整个 DSH_HOME 快照，顺序为「先确保 dshVersion 已装 → 建 home →
 *   逐 profile install → home 级资源 → files[]/skills[] 下载」。任一环节失败整体回滚。
 *
 * 安全要点：
 * - .dspack 为标准 ZIP，格式合法性由 parseDspack（dspack.json 标记）与 manifest 校验共同保证；
 * - overrides/ 与 files[].path 的相对路径禁用 `..` 段（防逃逸）；
 * - target 名经 sanitizeSlug 规范化；同名目标无 --force 时报错；
 * - 指定 expectedSha256/expectedSize 时先做完整性校验。
 *
 * @param {Host} host
 * @param {object} opts { source, profilesRoot?, home?, name?, registry?, force?, noInstall?, dryRun?,
 *                        timeoutMs?, installedDshVersions?, expectedSha256?, expectedSize? }
 * @returns {Promise<object>}
 */
export async function installPack(host, opts = {}) {
  const { source } = opts;
  if (!source) throw new Error('请指定要安装的整合包（本地 .dspack 路径或 URL）');

  // 进度回调（GUI 用它避免「卡住」观感）：onProgress(stage, detail)
  const progress = (stage, detail) => {
    if (typeof opts.onProgress === 'function') opts.onProgress(stage, detail);
  };
  // 行式日志回调（任务中心 logSink）：落盘细节逐文件 print。
  const log = makeLog(opts.onOutput);

  // 第一条日志先写清「走了哪个代理 / 还是直连」，便于定位网络问题。
  const proxy = proxyLine(host);
  if (proxy) log(proxy);

  const profilesRoot = opts.profilesRoot || host.joinPath(host.homedir(), '.dsh', 'profiles');

  progress('download', typeof source === 'string' && /^https?:\/\//i.test(source) ? '下载整合包' : '读取整合包');
  const { path: packPath, tempDir } = await resolvePackSource(host, source);
  log(`整合包：${source} → ${packPath}`);

  try {
    await verifyIntegrity(host, packPath, opts);

    progress('extract', '解析并校验整合包');
    const bytes = await host.readFile(packPath);
    if (!bytes) throw new Error('无法读取整合包文件');
    const { entries } = parseDspack(bytes);

    if (!entries['manifest.json']) throw new Error('整合包缺少 manifest.json（不是有效的 .dspack）');
    const manifest = parseJson(decodeText(entries['manifest.json']));
    const errors = validateManifest(manifest);
    if (errors.length) throw new Error(`整合包不合法：${errors.join('；')}`);

    log(`manifest v${manifest.manifestVersion} type=${manifest.type ?? 'profile'} name=${manifest.name}`);

    // 阶段 0（v5 r2 §8.4）：launchers 判定（六行判定表）——警告放行、不硬拒。
    // selfId 默认官方桌面端（本插件注入 DSH 桌面端），opts.launcherId / opts.launcherVersion 可覆盖；
    // launcherVersion 无法自报时按「版本未知」轻提示放行（launcher-registry §2）。
    const launcherSelfId = opts.launcherId || 'official-desktop';
    const launcherSelfVersion = typeof opts.launcherVersion === 'string' && opts.launcherVersion.trim()
      ? opts.launcherVersion
      : null;
    const launchersResult = {
      selfId: launcherSelfId,
      warnings: judgeLaunchers(normalizeLaunchers(manifest.launchers), launcherSelfId, launcherSelfVersion),
    };
    for (const w of launchersResult.warnings) {
      log(`launchers ${w.level === 'warn' ? '警告' : '提示'}：${w.message}`);
    }
    if (launchersResult.warnings.length) log('launchers 警告已放行（用户已确认继续，安装不受影响）');

    if (manifest.manifestVersion === 5 && manifest.type === 'dshhome') {
      return await installDshHome(host, manifest, entries, opts, progress, launchersResult);
    }
    return await installProfile(host, manifest, entries, opts, progress, profilesRoot, launchersResult);
  } finally {
    if (tempDir) await host.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** 单 profile（v5）安装：现有语义，装到 profilesRoot/<name>。 */
async function installProfile(host, manifest, entries, opts, progress, profilesRoot, launchersResult) {
  const profileName = sanitizeSlug(opts.name || manifest.profileName || manifest.name);
  if (!profileName) throw new Error('无法确定 Profile 名称');
  const target = host.joinPath(profilesRoot, profileName);
  const log = makeLog(opts.onOutput);

  // dshVersions（r2）交集决策：profile 形态做软提示（DSH 基线只硬校验 dshhome 形态）。
  const dshDecision = await decideDshVersion(host, manifest, opts, log);

  // dry-run 只读预览：即便目标已存在也照常返回计划（真实安装才要求 --force）。
  if (opts.dryRun) {
    const exists = (await host.stat(target)) != null;
    return {
      profileName, dir: target, manifest, dryRun: true, installed: false, reconcile: null,
      filesDownloaded: 0, exists, dshVersion: dshDecision?.version ?? null,
      launchers: launchersResult,
    };
  }

  if ((await host.stat(target)) != null && !opts.force) {
    throw new Error(`Profile「${profileName}」已存在：${target}（使用 --force 覆盖）`);
  }
  if ((await host.stat(target)) != null) {
    log(`覆盖已存在的 profile：${target}`);
    await host.rm(target, { recursive: true, force: true });
  }
  await host.mkdir(target);
  log(`创建 profile 目录：${target}`);

  try {
    progress('extract', '写入 overrides/ 与 package.json');
    await materializePackage(host, target, manifest, entries, log);

    // home/ → $DSH_HOME 根（上一级目录内容：全局 skill / 预设），与 overrides/（profile 根）并列。
    await materializeHome(host, host.joinPath(profilesRoot, '..'), entries, profileName, log);

    let installed = false;
    let reconcile = null;
    if (!opts.noInstall) {
      installed = true;
      progress('install', '运行 pnpm install（依赖重建，可能较慢）');
      await pnpmInstall(host, target, opts, !!entries['pnpm-lock.yaml']);
      reconcile = await reconcileProfile(host, target, manifest);
      if (reconcile.missing.length > 0) {
        throw new Error(
          `整合包层栈有 ${reconcile.missing.length} 个 bundle 无法解析为补丁层：` +
            `${reconcile.missing.join(', ')}。这些包未声明 dsh.bundle.patch，属于无效的整合包。`,
        );
      }
    }

    const files = manifest.files ?? [];
    if (files.length) progress('files', `下载 ${files.length} 个 files[] 条目`);
    const filesDownloaded = await downloadFiles(host, target, files, log);

    progress('done', profileName);
    return {
      profileName, dir: target, manifest, dryRun: false, installed, reconcile, filesDownloaded,
      dshVersion: dshDecision?.version ?? null,
      launchers: launchersResult,
    };
  } catch (e) {
    await host.rm(target, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
}

/** dshhome（v5）安装：整个 DSH_HOME 快照，顺序「先装 DSH → 建 home → 逐 profile → home 级资源 → 指针下载」。 */
async function installDshHome(host, manifest, entries, opts, progress, launchersResult) {
  const log = makeLog(opts.onOutput);

  // ① 先确保 dshVersion / dshVersions（r2 交集决策）选定的 DSH 已安装：多个 profile 的 bundle 都靠安装基线解析。
  const dshDecision = await ensureDsh(host, manifest, opts);
  if (dshDecision) log(`DSH 基线 ${dshDecision.version} 已就绪（来源：${dshDecision.source}）`);

  const homeRoot = opts.home ? host.resolvePath(opts.home) : host.joinPath(host.homedir(), '.dsh');
  log(`目标 DSH_HOME：${homeRoot}`);

  if (opts.dryRun) {
    const exists = (await host.stat(homeRoot)) != null;
    return {
      type: 'dshhome', dir: homeRoot, manifest, dryRun: true, installed: false, exists,
      profiles: Object.keys(manifest.profiles), defaultProfile: manifest.defaultProfile, filesDownloaded: 0,
      dshVersion: dshDecision?.version ?? null,
      launchers: launchersResult,
    };
  }

  if ((await host.stat(homeRoot)) != null && !opts.force) {
    throw new Error(`目标 DSH_HOME 已存在：${homeRoot}（使用 --force 覆盖）`);
  }
  if ((await host.stat(homeRoot)) != null) {
    log(`覆盖已存在的 DSH_HOME：${homeRoot}`);
    await host.rm(homeRoot, { recursive: true, force: true });
  }
  await host.mkdir(homeRoot);

  try {
    // ② 逐 profile：overrides/profiles/<name>/ 落盘 → pnpm install → 对账（各自独立）
    const installed = [];
    for (const [name, unit] of Object.entries(manifest.profiles)) {
      const profileDir = host.joinPath(homeRoot, 'profiles', name);
      progress('extract', `写入 profile「${name}」`);
      await materializeProfile(host, profileDir, name, unit, entries, log);

      if (!opts.noInstall) {
        progress('install', `运行 pnpm install（${name}，可能较慢）`);
        await pnpmInstall(host, profileDir, opts, !!entries['pnpm-lock.yaml']);
        const reconcile = await reconcileProfile(host, profileDir, unit);
        if (reconcile.missing.length > 0) {
          throw new Error(
            `profile「${name}」层栈有 ${reconcile.missing.length} 个 bundle 无法解析为补丁层：` +
              `${reconcile.missing.join(', ')}。这些包未声明 dsh.bundle.patch。`,
          );
        }
      }
      installed.push(name);
    }

    // ③ home 级 overrides：.agent-presets/ skills/ AGENTS.md data/ 等
    progress('extract', '写入 home 级资源（preset / skill / 指令 / 数据）');
    await materializeHomeOverrides(host, homeRoot, entries, log);

    // ④ files[] + 重 skills[] 指针下载
    const heavySkills = (manifest.skills ?? [])
      .filter((s) => s.sha256 && s.size)
      .map((s) => ({ path: s.path, sha256: s.sha256, size: s.size, urls: s.urls }));
    const all = [...(manifest.files ?? []), ...heavySkills];
    if (all.length) progress('files', `下载 ${all.length} 个 files[]/skills[] 条目`);
    const filesDownloaded = await downloadFiles(host, homeRoot, all, log);

    progress('done', manifest.name);
    return {
      type: 'dshhome', dir: homeRoot, manifest, dryRun: false, installed: true,
      profiles: installed, defaultProfile: manifest.defaultProfile, filesDownloaded,
      dshVersion: dshDecision?.version ?? null,
      launchers: launchersResult,
    };
  } catch (e) {
    await host.rm(homeRoot, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
}

/**
 * launchers 判定（v3 §8.4 六行判定表）：按归一化后的 launchers map 评估当前安装端，
 * 产出警告列表（警告放行、不硬拒——调用方逐条 log 并透出 result.launchers 供 UI 确认）。
 *
 * | 条目 / 查表结果 | 行为 |
 * | --- | --- |
 * | supported:true，无 minVersion | 静默 |
 * | supported:true，本启动器版本 ≥ minVersion | 静默 |
 * | supported:true，版本不足 / 版本未知 | 轻提示（info） |
 * | supported:false | 重警告（warn，显示 reason） |
 * | 未列出，map 无任何 supported:true（纯黑名单） | 静默 |
 * | 未列出，map 有 supported:true（白名单） | 轻提示（info，列出支持项） |
 *
 * @param {object} normalized normalizeLaunchers 归一化后的 map
 * @param {string} selfId 当前安装端启动器 ID（launcher-registry §1）
 * @param {string|null} selfVersion 当前启动器自报版本（无法自报时 null → 按「版本未知」处理）
 * @returns {{ level: 'info'|'warn', message: string }[]}
 */
export function judgeLaunchers(normalized, selfId, selfVersion) {
  const warnings = [];
  const map = normalized && typeof normalized === 'object' && !Array.isArray(normalized) ? normalized : {};
  const ids = Object.keys(map);
  if (!ids.length) return warnings; // launchers 缺省 = 通用包（现状不变）

  const self = map[selfId];
  if (self) {
    if (self.supported === false) {
      // 判定表第 4 行：重警告（显示 reason）→ 放行
      warnings.push({
        level: 'warn',
        message: self.reason
          ? `包作者声明不支持当前启动器「${selfId}」：${self.reason}`
          : `包作者声明不支持当前启动器「${selfId}」（未提供原因）`,
      });
    } else if (self.minVersion) {
      // 判定表第 2/3 行：版本达标静默；不足或未知（启动器无法自报）轻提示放行
      const known = typeof selfVersion === 'string' && selfVersion.trim();
      if (!known || compareLauncherVersions(selfVersion, self.minVersion) < 0) {
        warnings.push({
          level: 'info',
          message: `需要 ${selfId} ≥ ${self.minVersion}（当前${known ? `：${selfVersion}` : '版本未知'}），可能存在兼容问题`,
        });
      }
    }
    // 判定表第 1 行：supported:true 且无 minVersion → 静默
  } else {
    // 未列出（三态第三态）：纯黑名单静默；白名单轻提示列出支持项
    const supportedIds = ids.filter((id) => map[id]?.supported === true);
    if (supportedIds.length) {
      warnings.push({
        level: 'info',
        message: `本整合包声明支持：${supportedIds.join('、')}（未声明当前启动器「${selfId}」，仅供参考）`,
      });
    }
  }
  return warnings;
}

/** dshVersions（r2 §13）交集决策（确定性，永有唯一答案）：
 * dshVersions ∩ 本机已装 ≠ ∅ → 命中多个时优先 dshVersion 指定者、其次集合内最新；
 * 无交集 → null（调用方按 dshVersion 提示安装）。
 */
export function resolveDshVersion(manifest, installedVersions) {
  const versions = Array.isArray(installedVersions) ? installedVersions : [];
  if (manifest.dshVersion && versions.includes(manifest.dshVersion)) {
    return { version: manifest.dshVersion, source: 'dshVersion' };
  }
  const hits = (Array.isArray(manifest.dshVersions) ? manifest.dshVersions : []).filter((v) => versions.includes(v));
  if (hits.length) {
    const pick = manifest.dshVersion && hits.includes(manifest.dshVersion)
      ? manifest.dshVersion
      : sortVersionsDesc(hits)[0];
    return { version: pick, source: 'dshVersions' };
  }
  return null;
}

/** profile 形态的软决策（不硬校验）：有 dshVersion/dshVersions 声明时记录选定版本或提示未装。 */
async function decideDshVersion(host, manifest, opts, log) {
  if (!manifest.dshVersion && !Array.isArray(manifest.dshVersions)) return null;
  const installed = opts.installedDshVersions ?? (await listInstalledDshVersions(host));
  const decision = resolveDshVersion(manifest, installed);
  if (decision) log(`DSH 版本决策：${decision.version}（来源：${decision.source}）`);
  else log(`提示：声明的 DSH 版本（${manifest.dshVersion || (manifest.dshVersions ?? []).join(' / ')}）本机均未安装，安装后如异常请先装对应版本`);
  return decision;
}

/** 检查 dshVersion / dshVersions 选定的 DSH 是否已安装（均未声明则跳过）；未装报错提示先用启动器装。 */
async function ensureDsh(host, manifest, opts) {
  if (!manifest.dshVersion && !Array.isArray(manifest.dshVersions)) return null;
  const installed = opts.installedDshVersions ?? (await listInstalledDshVersions(host));
  const decision = resolveDshVersion(manifest, installed);
  if (decision) return decision;
  const declared = manifest.dshVersion
    ? `DSH ${manifest.dshVersion}`
    : `dshVersions [${(manifest.dshVersions ?? []).join(', ')}] 中的任一版本`;
  const have = Array.isArray(installed) ? installed.join(', ') || '无' : '未知';
  throw new Error(`dshhome 依赖 ${declared}，但本机未安装（已装：${have}）。请先用启动器安装该版本后再导入。`);
}

/* ------------------------------------------------------------------ */

/**
 * 归一化用户粘贴的路径/URL：去首尾空白 + 去掉包裹的成对引号。
 * Windows「复制路径」（资源管理器 / 属性）会给带空格或中文的路径套一对双引号；
 * 不剥掉的话，`path.resolve` 会把 `"C:\…\x.dspack"` 当成相对路径拼到 cwd 后面，
 * 得到 `cwd\"C:\…\x.dspack"` 这种错得离谱的「找不到整合包文件」。
 */
function normalizeSource(source) {
  const trimmed = String(source ?? '').trim();
  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed.length >= 2 && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/** 把「本地路径 | http(s) URL」统一解析为本地文件路径；URL 会下载到临时目录（调用方负责清理返回的 tempDir）。 */
export async function resolvePackSource(host, source) {
  const normalized = normalizeSource(source);
  if (/^https?:\/\//i.test(normalized)) {
    const tempDir = await host.mkdtemp('dspack-dl-');
    const dest = host.joinPath(tempDir, 'pack.dspack');
    await host.download(normalized, dest);
    return { path: dest, tempDir };
  }
  const local = host.resolvePath(normalized);
  const st = await host.stat(local);
  if (!st?.isFile) throw new Error(`找不到整合包文件：${local}`);
  return { path: local, tempDir: null };
}

/** 完整性校验（可选，来自市场索引的 sha256/size）。 */
export async function verifyIntegrity(host, packPath, opts = {}) {
  // 只有「正整数」的 expectedSize 才参与校验：0 / 缺失 / 非数字一律视为未提供，
  // 避免市场条目缺 size 时把 0 当成「期望 0 字节」误判（files 不可能为 0 字节）。
  if (Number.isInteger(opts.expectedSize) && opts.expectedSize > 0) {
    const st = await host.stat(packPath);
    if (!st || st.size !== opts.expectedSize) {
      throw new Error(`大小不符：期望 ${opts.expectedSize} 字节，实际 ${st?.size ?? '未知'}`);
    }
  }
  if (opts.expectedSha256) {
    const actual = await host.sha256File(packPath);
    if (actual !== opts.expectedSha256.toLowerCase()) {
      throw new Error(`sha256 校验失败（可能被篡改）：期望 ${opts.expectedSha256}，实际 ${actual}`);
    }
  }
}

/** 单 profile：overrides/* 落盘 + 重建 package.json + 快照机器文件。 */
async function materializePackage(host, dir, manifest, entries, log) {
  // 1) overrides/* → profile 根
  for (const [entryPath, data] of Object.entries(entries)) {
    if (!entryPath.startsWith('overrides/')) continue;
    const rel = safeRel(entryPath.slice('overrides/'.length));
    if (!rel) continue;
    const dest = host.joinPath(dir, rel);
    await host.writeFile(dest, data);
    log(`写入 overrides/${rel} → ${dest}`);
  }

  // 2) package.json：以 manifest 为唯一事实源重建 dependencies / bundles；保留快照其余字段
  const base = parseJson(decodeText(entries['package.json'] || new Uint8Array())) ?? {};
  const pkg = base && typeof base === 'object' && !Array.isArray(base) ? base : {};
  pkg.dependencies = coordsToPkgDeps(manifest.dependencies ?? {});
  pkg.dsh = { ...(pkg.dsh ?? {}), profile: { ...(pkg.dsh?.profile ?? {}), bundles: manifest.bundles ?? [] } };
  const pkgPath = host.joinPath(dir, 'package.json');
  await host.writeTextFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  log(`重建 package.json → ${pkgPath}`);

  // 3) pnpm 设置 / 锁文件快照（根机器文件，可选）
  for (const name of ['pnpm-workspace.yaml', 'pnpm-lock.yaml']) {
    if (entries[name]) {
      const dest = host.joinPath(dir, name);
      await host.writeFile(dest, entries[name]);
      log(`写入 ${name} → ${dest}`);
    }
  }

  // 4) cordis.patch.yml：overrides 已优先落地；缺则回退 manifest.patch
  const patchPath = host.joinPath(dir, 'cordis.patch.yml');
  if ((await host.stat(patchPath)) == null && typeof manifest.patch === 'string') {
    await host.writeTextFile(patchPath, manifest.patch);
    log(`回退 manifest.patch → ${patchPath}`);
  }
}

/** 单 profile 包携带的 home 级内容：home/* → $DSH_HOME 根；skills / .agent-presets 落到 .dsh-pack/<store>/<profileName>/（换指 slot）。 */
async function materializeHome(host, homeRoot, entries, profileName, log) {
  for (const [entryPath, data] of Object.entries(entries)) {
    if (!entryPath.startsWith('home/')) continue;
    const rel = safeRel(entryPath.slice('home/'.length));
    if (!rel) continue;
    const dest = host.joinPath(homeRoot, storeHomeRel(rel, profileName));
    await host.writeFile(dest, data);
    log(`写入 home/${rel} → ${dest}`);
  }
}

/** dshhome 单个 profile：overrides/profiles/<name>/ 落盘 + 以 ProfileUnit 重建 package.json / patch。 */
async function materializeProfile(host, profileDir, name, unit, entries, log) {
  await host.mkdir(profileDir);
  log(`创建 profile 目录：${profileDir}`);

  // 1) overrides/profiles/<name>/* → profile 根
  const prefix = `overrides/profiles/${name}/`;
  for (const [entryPath, data] of Object.entries(entries)) {
    if (!entryPath.startsWith(prefix)) continue;
    const rel = safeRel(entryPath.slice(prefix.length));
    if (!rel) continue;
    const dest = host.joinPath(profileDir, rel);
    await host.writeFile(dest, data);
    log(`写入 ${prefix}${rel} → ${dest}`);
  }

  // 2) package.json：以 ProfileUnit 为唯一事实源（bundle 层栈 + 坐标→依赖）
  const pkg = {
    name: `dsh-profile-${name}`,
    private: true,
    dependencies: coordsToPkgDeps(unit.dependencies ?? {}),
    dsh: { profile: { bundles: unit.bundles ?? [] } },
  };
  const pkgPath = host.joinPath(profileDir, 'package.json');
  await host.writeTextFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  log(`重建 package.json → ${pkgPath}`);

  // 3) cordis.patch.yml：overrides 优先；缺则回退 unit.patch
  const patchPath = host.joinPath(profileDir, 'cordis.patch.yml');
  if ((await host.stat(patchPath)) == null && typeof unit.patch === 'string') {
    await host.writeTextFile(patchPath, unit.patch);
    log(`回退 unit.patch → ${patchPath}`);
  }
}

/** dshhome：home 级 overrides（.agent-presets/ skills/ AGENTS.md data/ 等，profiles/ 除外）落盘。 */
async function materializeHomeOverrides(host, homeRoot, entries, log) {
  for (const [entryPath, data] of Object.entries(entries)) {
    if (!entryPath.startsWith('overrides/')) continue;
    const rel = safeRel(entryPath.slice('overrides/'.length));
    if (!rel) continue;
    if (rel.startsWith('profiles/')) continue; // profile 已在逐 profile 阶段单独落盘
    const dest = host.joinPath(homeRoot, rel);
    await host.writeFile(dest, data);
    log(`写入 overrides/${rel} → ${dest}`);
  }
}

/**
 * pnpm 依赖安装。优先走 host.pnpm（桌面端复用 DSH 自带 node+pnpm，不依赖用户 PATH），
 * 无此能力则回退 PATH 上的 pnpm。带 lockfile 时先试 `--frozen-lockfile`（可复现），
 * 失配则回退普通安装（v4/v5 导入语义）。
 */
async function pnpmInstall(host, target, opts, frozen) {
  // 依赖重建可能较慢（尤其 git 依赖走 git clone），给足超时但绝不无限卡死。
  const timeoutMs = opts.timeoutMs > 0 ? opts.timeoutMs : 10 * 60 * 1000;
  // 优先走 host.pnpm（桌面端复用 DSH 自带 node+pnpm，不依赖用户 PATH 上的 node/pnpm）；无此能力则回退 PATH 上的 pnpm。
  const runPnpm = typeof host.pnpm === 'function'
    ? (args, o) => host.pnpm(args, o)
    : (args, o) => host.exec('pnpm', args, o);
  const base = ['install', ...(opts.registry ? ['--registry', opts.registry] : [])];

  const args = [...base];
  if (frozen) args.push('--frozen-lockfile');
  let r = await runPnpm(args, { cwd: target, timeoutMs, onOutput: opts.onOutput });
  // frozen-lockfile 失配时回退普通安装（v4/v5 导入语义）
  if (frozen && r.status !== 0) {
    r = await runPnpm(base, { cwd: target, timeoutMs, onOutput: opts.onOutput });
  }
  if (r.error) throw new Error(`pnpm install 执行失败：${r.error}`);
  if (r.status !== 0) throw new Error(`pnpm install 失败（退出码 ${r.status ?? '未知'}）`);
}

/** files[] 重内容：每个 url 依次尝试下载 → sha256+size 校验 → 落到 path。 */
async function downloadFiles(host, target, files, log) {
  let count = 0;
  const tmp = await host.mkdtemp('dspack-files-');
  try {
    for (const f of files ?? []) {
      const rel = safeRel(f.path);
      const dest = host.joinPath(target, rel);
      const tmpFile = host.joinPath(tmp, `dl-${count}`);
      let ok = false;
      let lastErr = null;
      for (const url of f.urls) {
        log(`下载 ${rel} ← ${url}`);
        try {
          await host.download(url, tmpFile);
          ok = true;
          break;
        } catch (e) {
          lastErr = e;
          log(`  失败：${e?.message ?? e}（尝试下一源）`);
        }
      }
      if (!ok) throw new Error(`files[] 下载失败：${rel}（${lastErr?.message ?? '无可用源'}）`);

      const sha = await host.sha256File(tmpFile);
      const st = await host.stat(tmpFile);
      if (sha !== String(f.sha256).toLowerCase() || (st?.size ?? -1) !== f.size) {
        throw new Error(`files[] 完整性校验失败：${rel}`);
      }
      await host.move(tmpFile, dest);
      log(`写入 ${rel} → ${dest}`);
      count += 1;
    }
    return count;
  } finally {
    await host.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * 安装后对账（v4/v5 沿用 DSH 语义：Bundle 唯一判据 = dsh.bundle.patch 声明存在）。
 * 对 dshhome 的 ProfileUnit 同样适用（unit 含 bundles / dependencies）。
 * @returns {{ missing: string[], added: string[] }}
 *   - missing：层栈中「同时是依赖」的包，装完无 dsh.bundle.patch → 无效，需回滚；
 *   - added：依赖里声明了 dsh.bundle.patch 却未进层栈 → 自动补进（调用方需写回 manifests）。
 */
export async function reconcileProfile(host, profileDir, manifest) {
  const missing = [];
  const added = [];
  const pkgDeps = coordsToPkgDeps(manifest.dependencies ?? {});
  const bundles = [...(manifest.bundles ?? [])];

  for (const name of bundles) {
    if (!Object.hasOwn(pkgDeps, name)) continue; // 模板型 bundle：由 DSH 安装目录 fallback 兜底
    const pkg = await readJson(host, host.joinPath(profileDir, 'node_modules', name, 'package.json'));
    if (!pkg || pkg.dsh?.bundle?.patch === undefined) missing.push(name);
  }
  for (const name of Object.keys(pkgDeps)) {
    const pkg = await readJson(host, host.joinPath(profileDir, 'node_modules', name, 'package.json'));
    if (pkg && pkg.dsh?.bundle?.patch !== undefined && !bundles.includes(name)) {
      bundles.push(name);
      added.push(name);
    }
  }
  return { missing, added };
}

/* ------------------- 工具 ------------------- */

/** 把 host.proxyStatus() 转成一条日志行；宿主不支持或无信息时返回 null。 */
function proxyLine(host) {
  if (typeof host.proxyStatus !== 'function') return null;
  const ps = host.proxyStatus();
  if (!ps) return null;
  switch (ps.kind) {
    case 'manual': return `代理：手动配置 ${ps.url}`;
    case 'direct': return '代理：直连（用户已禁用代理）';
    case 'auto-env': return `代理：环境变量 ${ps.url}`;
    case 'auto-system': return `代理：系统代理 ${ps.url}`;
    case 'auto-direct': return '代理：直连（未检测到代理）';
    default: return null;
  }
}

/** 把 onOutput（任务中心 logSink）转成行式日志回调；无 sink 时为空操作。 */
function makeLog(onOutput) {
  if (typeof onOutput !== 'function') return () => {};
  return (s) => onOutput(String(s) + '\n');
}

function parseJson(raw) {
  if (raw == null || raw === '') return null;
  try {
    return raw instanceof Uint8Array ? JSON.parse(decodeText(raw)) : JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readJson(host, p) {
  return parseJson(await host.readTextFile(p));
}

/** 归一化相对路径并拒绝危险段（防路径穿越）。 */
function safeRel(rel) {
  const r = String(rel).replace(/\\/g, '/');
  if (!r || r.startsWith('/') || /^[a-zA-Z]:/.test(r)) throw new Error(`非法相对路径：${rel}`);
  if (r.split('/').includes('..')) throw new Error(`路径含危险段 '..'：${rel}`);
  return r;
}
