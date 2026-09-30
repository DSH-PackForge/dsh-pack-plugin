import { parseDspack, decodeText } from './dspack.js';
import { validateManifest, coordsToPkgDeps, sanitizeSlug, parseGitCoord, normalizeLaunchers, compareLauncherVersions } from './manifest.js';
import { listInstalledDshVersions, sortVersionsDesc } from './discovery.js';
import { storeHomeRel } from './home-store.js';
import { resolveVendoredPlan, isDialectSpec, directMount, materializeVendorBlobs, blobRelPath, computeOfflineCoverage, allDependencyCoords, vendorKeyToName, VENDOR_KEY_PREFIX } from './vendored.js';
import { localizeDirectNpm, localizeDirectGit, localizeClosureNode, findPackageNodes } from './lockfile.js';

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
    // lockText：full 闭包包的 vendored 闭包条目不在直接依赖里，须对照随包 pnpm-lock.yaml 放行（v5 §12 约束 1）
    const errors = validateManifest(manifest, {
      lockText: entries['pnpm-lock.yaml'] ? decodeText(entries['pnpm-lock.yaml']) : null,
    });
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

    // 阶段 0（v5 r3）：vendored 归一 + 对账 + 逐 tarball sha256/size 预验——装前发现优于装到一半。
    // r1 包（无 vendor/）立即返回 active:false，行为与修订前完全一致。
    const vendoredPlan = await resolveVendoredPlan(host, manifest, entries, log);
    // 闭包完整性（v3 §8.3）：「离线可装」是派生属性——lockfile 里的依赖都被包内副本覆盖（版本级命中）
    // 才加 `--offline` 作零网络断言。r3 起闭包条目也会被本地化（改 resolution.tarball），
    // 所以不再有「store 预填充」这回事。
    if (vendoredPlan.active && entries['pnpm-lock.yaml']) {
      const coverage = computeOfflineCoverage(decodeText(entries['pnpm-lock.yaml']), vendoredPlan);
      if (coverage?.complete) {
        vendoredPlan.offline = true;
        log(`vendored 闭包完整（lockfile ${coverage.total} 个包全部被包内副本覆盖）→ 加 --offline 作零网络断言`);
      } else if (coverage) {
        const head = coverage.missing.slice(0, 5).join(', ');
        log(`vendored 局部覆盖：lockfile ${coverage.total} 个包中 ${coverage.missing.length} 个未内嵌（${head}${coverage.missing.length > 5 ? '…' : ''}）→ 未覆盖的仍按坐标从网络取`);
      }
    }
    if (manifest.manifestVersion === 5 && manifest.type === 'dshhome') {
      return await installDshHome(host, manifest, entries, opts, progress, vendoredPlan, launchersResult);
    }
    return await installProfile(host, manifest, entries, opts, progress, profilesRoot, vendoredPlan, launchersResult);
  } finally {
    if (tempDir) await host.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** 单 profile（v5）安装：现有语义，装到 profilesRoot/<name>。 */
async function installProfile(host, manifest, entries, opts, progress, profilesRoot, vendoredPlan, launchersResult) {
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
      vendored: summarizeVendored(vendoredPlan, manifest.dependencies ?? {}),
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
    await materializePackage(host, target, manifest, entries, log, vendoredPlan);

    // home/ → $DSH_HOME 根（上一级目录内容：全局 skill / 预设），与 overrides/（profile 根）并列。
    await materializeHome(host, host.joinPath(profilesRoot, '..'), entries, profileName, log);

    let installed = false;
    let reconcile = null;
    const mounted = [];
    if (!opts.noInstall) {
      installed = true;
      progress('install', '运行 pnpm install（依赖重建，可能较慢）');
      await pnpmInstall(host, target, opts, !!entries['pnpm-lock.yaml'], vendorArgs(vendoredPlan, !!entries['pnpm-lock.yaml']));
      // DSHL 方言依赖：pnpm 之后直挂进 node_modules（须在层栈对账之前）
      mounted.push(...await mountDialectDeps(host, target, manifest.dependencies ?? {}, vendoredPlan, log));
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
      vendored: summarizeVendored(vendoredPlan, manifest.dependencies ?? {}, mounted),
      launchers: launchersResult,
    };
  } catch (e) {
    await host.rm(target, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
}

/** dshhome（v5）安装：整个 DSH_HOME 快照，顺序「先装 DSH → 建 home → 逐 profile → home 级资源 → 指针下载」。 */
async function installDshHome(host, manifest, entries, opts, progress, vendoredPlan, launchersResult) {
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
      vendored: summarizeVendored(vendoredPlan, aggregateDeps(manifest)),
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
    const mountedAll = [];
    for (const [name, unit] of Object.entries(manifest.profiles)) {
      const profileDir = host.joinPath(homeRoot, 'profiles', name);
      progress('extract', `写入 profile「${name}」`);
      await materializeProfile(host, profileDir, name, unit, entries, log, vendoredPlan);

      if (!opts.noInstall) {
        progress('install', `运行 pnpm install（${name}，可能较慢）`);
        await pnpmInstall(host, profileDir, opts, !!entries['pnpm-lock.yaml'], vendorArgs(vendoredPlan, !!entries['pnpm-lock.yaml']));
        mountedAll.push(...await mountDialectDeps(host, profileDir, unit.dependencies ?? {}, vendoredPlan, log));
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
      vendored: summarizeVendored(vendoredPlan, aggregateDeps(manifest), mountedAll),
      launchers: launchersResult,
    };
  } catch (e) {
    await host.rm(homeRoot, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
}

/** dshhome 各 profile 依赖坐标并集（vendored 摘要用）。 */
function aggregateDeps(manifest) {
  const out = {};
  for (const u of Object.values(manifest.profiles ?? {})) Object.assign(out, u?.dependencies ?? {});
  return out;
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

/** vendored 摘要（安装结果 / dry-run 计划展示用）。 */
function summarizeVendored(plan, deps, mounted = []) {
  if (!plan?.active) return { active: false, used: [], mounted: [], offline: false };
  const used = [];
  for (const coord of Object.keys(deps ?? {})) {
    const e = plan.byCoord.get(coord);
    if (e && !e.dialect) used.push(coord);
  }
  return { active: true, used, mounted, offline: plan.offline === true };
}

/** DSHL 方言依赖直挂（v3 §8.3 direct-mount）：pnpm install 之后、层栈对账之前执行。 */
async function mountDialectDeps(host, target, deps, plan, log) {
  if (!plan?.active) return [];
  const mounted = [];
  for (const [name, spec] of Object.entries(deps ?? {})) {
    if (!isDialectSpec(spec)) continue;
    const entry = plan.byCoord.get(name);
    if (!entry) {
      // 该包已被显式 `vendor:<名>` 条目接管（v3 §8.5 显式优先）→ 方言条目已从计划里丢弃，不再直挂
      if (plan.byCoord.has(`${VENDOR_KEY_PREFIX}${name}`)) continue;
      throw new Error(`方言依赖「${name}」在 vendor/vendor.json 中无对应条目（拒装）`);
    }
    await directMount(host, target, name, entry, log);
    mounted.push(name);
  }
  return mounted;
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

/** 单 profile：overrides/* 落盘 + 重建 package.json + 快照机器文件 + vendored tarball 落盘（r2）。 */
async function materializePackage(host, dir, manifest, entries, log, plan) {
  // 0) vendored tarball → vendor-blobs/（file: 引用的实体；manifest 不动，改写只发生在重建的 package.json）。
  //    取**全部**计划条目：闭包条目不在 dependencies 里，也必须落盘——本地化时改的
  //    resolution.tarball 指的就是这里的实体。
  if (plan?.active) await materializeVendorBlobs(host, dir, plan, [...plan.byCoord.keys()], log);

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
  applyVendoredSpecs(pkg.dependencies, manifest.dependencies ?? {}, plan);
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

  // 3.5) lockfile 本地化（v3 §8.3 两支 + 闭包条目）——必须在 pnpm install 之前，
  //      且改的是**落盘副本**，包内字节一个字不动（§8.6 第 6 条）。
  await localizeTargetLockfile(host, dir, plan, log);

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
async function materializeProfile(host, profileDir, name, unit, entries, log, plan) {
  await host.mkdir(profileDir);
  log(`创建 profile 目录：${profileDir}`);

  // 0) vendored tarball → vendor-blobs/（vendor/ 是包级的，各 profile 各放一份 file: 引用实体）
  if (plan?.active) await materializeVendorBlobs(host, profileDir, plan, [...plan.byCoord.keys()], log);

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
  applyVendoredSpecs(pkg.dependencies, unit.dependencies ?? {}, plan);
  const pkgPath = host.joinPath(profileDir, 'package.json');
  await host.writeTextFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  log(`重建 package.json → ${pkgPath}`);

  // 3) cordis.patch.yml：overrides 优先；缺则回退 unit.patch
  const patchPath = host.joinPath(profileDir, 'cordis.patch.yml');
  if ((await host.stat(patchPath)) == null && typeof unit.patch === 'string') {
    await host.writeTextFile(patchPath, unit.patch);
    log(`回退 unit.patch → ${patchPath}`);
  }

  // 4) lockfile 本地化：dshhome 的每个 profile 各自一份 lockfile（各跑一次 pnpm install）
  await localizeTargetLockfile(host, profileDir, plan, log);
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
 * vendored 依赖在**重建的 package.json** 上的 spec 决策（v3 §8.3 统一算法）：
 * - `vendor:<包名>` 条目 → package.json 里落**包名**，值改写为 `file:vendor-blobs/...`；
 * - DSHL 方言 spec（`vendor:<file>.tgz`）→ 从依赖中剔除（tarball 直挂，不传给 pnpm）；
 * - 非 vendored 坐标 → 原样。manifest 不动（规范禁止安装端改写包内字节，改写仅发生在重建产物上）。
 */
function applyVendoredSpecs(pkgDeps, manifestDeps, plan) {
  if (!plan?.active) return;
  for (const [coord, spec] of Object.entries(manifestDeps ?? {})) {
    const entry = plan.byCoord.get(coord);
    // v5 r3 §2：`vendor:<包名>` 的包名 = 剥去一次前缀；裸坐标仍按 git 折算 / 原名（§2 转换表）
    const vendoredName = vendorKeyToName(coord);
    const git = parseGitCoord(coord);
    const pkgName = vendoredName ?? (git ? git.name : coord);
    if (isDialectSpec(spec)) {
      delete pkgDeps[pkgName]; // 方言：直挂，不传给 pnpm（v3 §8.5）
      continue;
    }
    if (entry && !entry.dialect) {
      pkgDeps[pkgName] = `file:${blobRelPath(coord, entry)}`;
    }
  }
}

/**
 * 把落盘副本 `pnpm-lock.yaml` 按 v3 r3 §8.3 本地化（支 A / 支 B / 闭包条目）。
 *
 * 为什么必须在安装前做、且只改副本：
 *   - pnpm 拒绝把 `file:` 只写在 package.json（`ERR_PNPM_OUTDATED_LOCKFILE`），四处/取件地址
 *     必须同步；r3 的结论是「改取件地址，而不是填 store 缓存」（`ERR_PNPM_NO_OFFLINE_TARBALL`）。
 *   - 包内快照必须保持来源风格（§8.1），否则不识 `vendor/` 的老启动器会因为路径缺失全盘失败。
 *
 * 组装规则（实测 pnpm 11.7.0）：
 *   - 直接依赖：npm 节点走支 A（importer specifier/version、packages 键、resolution、snapshots 键
 *     四处同步，并在节点里补 version 字段）；git 节点走支 B（只改 `resolution.tarball`）。
 *   - 闭包条目：只改该节点的 `resolution.tarball`（闭包没有 importer 段可改）。
 *   - 定位只能靠**包名**：git 节点的键版本段是 codeload URL，不是版本。
 */
async function localizeTargetLockfile(host, targetDir, plan, log) {
  if (!plan?.active) return { localized: false, changes: [] };
  const lockPath = host.joinPath(targetDir, 'pnpm-lock.yaml');
  const original = await host.readTextFile(lockPath);
  const localizable = [...plan.byCoord.values()].filter((e) => !e.dialect);
  if (!original) {
    // 方言条目不需要 lockfile（它们走直挂 + 从依赖里剔除）。但**非方言**条目的本地化必须靠
    // lockfile 认节点（git 节点的键版本段是 codeload URL，没法凭键猜），缺它就退回 file: spec
    // 直接安装——规范要求带 vendor/ 的包必须带 lockfile，这里是宽进并留痕。
    if (localizable.length) {
      log('警告：包内带 vendor/ 但缺 pnpm-lock.yaml → 无法按 v3 §8.3 本地化（改取件地址），退化为 file: spec 直接安装');
    }
    return { localized: false, changes: [] };
  }
  let text = original;
  const changes = [];
  for (const [key, e] of plan.byCoord) {
    if (e.dialect) continue; // 方言走直挂（v3 §8.5），不进 lockfile
    const blobRel = blobRelPath(key, e);
    if (e.kind === 'closure') {
      const nodes = findPackageNodes(text, e.pkgName);
      const node = nodes.find((n) => n.version === e.version) ?? (nodes.length === 1 ? nodes[0] : null);
      if (!node) throw new Error(`闭包条目「${key}」在 lockfile 里找不到对应节点（无法本地化）`);
      const r = localizeClosureNode(text, { key: node.key, blobRel });
      text = r.text;
      changes.push(...r.changes);
      continue;
    }
    const nodes = findPackageNodes(text, e.pkgName);
    if (nodes.some((n) => n.gitHosted)) {
      // 支 B：git 来源（codeload 归档非 npm 布局，改 file: 装不了）
      const r = localizeDirectGit(text, { name: e.pkgName, blobRel });
      text = r.text;
      changes.push(...r.changes);
    } else {
      // 支 A：npm 来源。integrity 用**现算 sha512** 覆盖（包里可能是本地重打包后的值）
      const integrity = `sha512-${await host.sha512(e.bytes)}`;
      const r = localizeDirectNpm(text, { name: e.pkgName, version: e.version, blobRel, integrity });
      text = r.text;
      changes.push(...r.changes);
    }
  }
  await host.writeTextFile(lockPath, text);
  const head = changes.slice(0, 4).join(' / ');
  log(`lockfile 本地化：${changes.length} 处（${head}${changes.length > 4 ? ' …' : ''}）`);
  return { localized: true, changes };
}

/**
 * vendored 安装参数（v3 r3 §8.3 执行段）：本地化之后 lockfile 与 package.json 已一致，按规范走
 * `pnpm install --frozen-lockfile --trust-lockfile`；全部依赖都被包内副本覆盖（coverage complete）
 * 时再加 `--offline` 作零网络断言。**不用 `--prefer-offline`**——它表达「本地优先、否则联网」，
 * 与「来源由键唯一确定」矛盾（r2 的做法已被规范否决）。
 * @returns {string[]|null} null = 无 vendored 内容（走原有纯网络路径）
 */
function vendorArgs(plan, hasLockfile) {
  if (!plan?.active) return null;
  const args = [];
  // 本地化只在有 lockfile 时发生（§8.3 改的是 lockfile 里的取件地址）；无 lockfile 就没法 frozen。
  if (hasLockfile) args.push('--frozen-lockfile');
  // `--trust-lockfile`：pnpm 11 的供应链复检（发布冷静期）豁免，等价于包内写 minimumReleaseAge: 0
  // ——规范 §8.6.8 给的正是这两个二选一。
  args.push('--trust-lockfile');
  if (plan.offline) args.push('--offline');
  return args;
}

async function pnpmInstall(host, target, opts, frozen, vArgs = null) {
  // 依赖重建可能较慢（尤其 git 依赖走 git clone），给足超时但绝不无限卡死。
  const timeoutMs = opts.timeoutMs > 0 ? opts.timeoutMs : 10 * 60 * 1000;
  // 优先走 host.pnpm（桌面端复用 DSH 自带 node+pnpm，不依赖用户 PATH 上的 node/pnpm）；无此能力则回退 PATH 上的 pnpm。
  const runPnpm = typeof host.pnpm === 'function'
    ? (args, o) => host.pnpm(args, o)
    : (args, o) => host.exec('pnpm', args, o);
  const warn = typeof opts.onOutput === 'function' ? opts.onOutput : () => {};
  const base = ['install', ...(opts.registry ? ['--registry', opts.registry] : [])];

  if (vArgs) {
    // 本地化后的 vendored 安装：规范要求 frozen（可复现）。失败时退一步让 pnpm 重写 lockfile
    // ——典型成因是包内 lockfile 的 settings 与本机 pnpm 配置不一致
    // （专测：ERR_PNPM_LOCKFILE_CONFIG_MISMATCH，pnpm 11）——并把偏差记进日志。
    let r = await runPnpm([...base, ...vArgs], { cwd: target, timeoutMs, onOutput: opts.onOutput });
    if (r.status !== 0) {
      warn('vendored 安装未通过 --frozen-lockfile 校验 → 退一步用 --no-frozen-lockfile 重试（偏差留痕）');
      r = await runPnpm(
        [...base, '--no-frozen-lockfile', '--trust-lockfile', ...(vArgs.includes('--offline') ? ['--offline'] : [])],
        { cwd: target, timeoutMs, onOutput: opts.onOutput },
      );
    }
    if (r.error) throw new Error(`pnpm install 执行失败：${r.error}`);
    if (r.status !== 0) throw new Error(`pnpm install 失败（退出码 ${r.status ?? '未知'}）`);
    return;
  }

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
