// 宿主 endpoint 层：UI（rpc.call）与 AI 工具（薄壳）共用的唯一业务入口。
//
// 每个 handler 收 { ctx, runtime, payload, signal, peer }，返回纯值；
// 抛错由 rpc.js 统一转成 { ok:false, error }。core 的 .dspack 格式逻辑经 Host 注入调用。
import {
  resolveProfileInput,
  exportFromWorkspace,
  loadWorkspaceConfig,
  saveWorkspaceConfig,
  inspectPack,
  installPack,
  resolvePackSource,
  readMarketIndex,
  fetchMarketPackDetail,
  normalizeLaunchers,
  judgeLaunchers,
  listInstalledDshVersions,
  DEFAULT_MARKET_INDEX,
} from './core/index.js';
import path from 'node:path';
import os from 'node:os';
import fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import { getHost } from './host.js';
// r2Badges / pickR2Fields 是市场 r2 透传新导出（core/index.js 桶文件未列，直连模块导入）
import { r2Badges, fetchLaunchersRegistry } from './core/market.js';

// launchers/registry 端点缓存（{at, value}；TTL 1h，进程内共享）
let launchersRegistryCache = null;
import { listProfiles, createProfile, deleteProfile, readState, writeState, resolveActiveName } from './profiles.js';
import { switchProfile } from './junction.js';
import { CHANNEL, PROFILE_NAME_RE } from './channel.js';
import { ACTIVE_NAME } from './runtime.js';
import { checkManagerInProfile, ensureManagerInProfile } from './ensure-manager.js';
import * as tasks from './tasks.js';

const need = (v, msg) => {
  if (v == null || v === '') throw new Error(msg);
  return String(v).trim();
};

// 插件自身元数据：作者/仓库/首页/版本号等，供 About 页与检查更新使用。
const require = createRequire(import.meta.url);
const MANAGER = '@dsh-packforge/dsh-pack-plugin';
const PACKAGE_VERSION = require('../package.json').version;
const NPM_REGISTRY = 'https://registry.npmjs.org';
const NPM_URL = `https://www.npmjs.com/package/${MANAGER}`;

// 新建 profile 的官方基线 bundle（web 模板）。这是「模板型 bundle」：只进 dsh.profile.bundles、
// 不进 dependencies —— boot 时由 DSH 安装目录（installAnchor）fallback 兜底解析（见 core/install.js
// reconcileProfile 的「模板型 bundle」注释）。来源：@deepseek-ai/dsh-app-boot 的 PROFILE_TEMPLATES.web
// = base + web-app；缺了 web-app，切过去就没有 UI。
const BASELINE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'];

// 简版 semver 比较（去 prerelease 后缀，逐段比数值）：>0 表示 a 更新。
function cmpVersion(a, b) {
  const nums = (v) => String(v).split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const A = nums(a);
  const B = nums(b);
  for (let i = 0; i < Math.max(A.length, B.length); i += 1) {
    const d = (A[i] || 0) - (B[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

// 导出/工作区配置共用的目标解析：默认当前激活 profile；名字优先在桌面 home（与切换列表同一套）里匹配，
// 匹配不到再当路径/全局名兜底（CLI / AI 工具导出任意目录用）。
async function resolveExportProfile(runtime, host, want) {
  const profiles = await listProfiles(runtime);
  const active = profiles.find((p) => p.active) ?? profiles[0] ?? null;
  let profile = null;
  if (want) {
    profile = profiles.find((p) => p.name === want) ?? (await resolveProfileInput(host, want));
  } else {
    profile = active;
  }
  if (!profile) {
    const names = profiles.map((p) => p.name).join(', ');
    throw new Error(`找不到 profile「${want ?? ''}」。可用：${names || '（无）'}`);
  }
  return profile;
}

export const ENDPOINTS = {
  'runtime/get': async ({ runtime }) => ({
    ...runtime,
    platform: process.platform,
    node: process.version,
    dshVersion: process.env.DSH_VERSION ?? null,
    // 本机已装 DSH 版本（dshVersions 多选建议来源，workspace-config v1 r2）
    installedDshVersions: await listInstalledDshVersions(getHost()),
    rpc: CHANNEL,
  }),

  'config/get': async ({ runtime }) => (await readState(runtime.home)).config ?? {},

  'config/set': async ({ runtime, payload }) => {
    const s = await readState(runtime.home);
    s.config = { ...(s.config ?? {}), ...(payload ?? {}) };
    await writeState(runtime.home, s);
    getHost().setProxy(s.config.proxy); // 代理立即生效，无需重启
    return s.config;
  },

  'profile/list': async ({ runtime }) => ({ profiles: await listProfiles(runtime) }),

  'profile/create': async ({ runtime, payload }) => {
    const name = need(payload?.name, '缺少 profile 名');
    if (!PROFILE_NAME_RE.test(name)) throw new Error('profile 名只能含小写字母、数字、连字符，如 aaa-bb-c');
    // 同步预检重名（真正写盘/迁装放进任务里异步跑）。
    const dir = path.join(runtime.profilesDir, name);
    if (await fsp.stat(dir).then(() => true, () => false)) {
      throw new Error(`profile「${name}」已存在`);
    }

    // 空整合包也要有官方基线 bundle（base + web-app，缺了就没 UI）+ 迁装管理器（+fflate），
    // 否则切过去就是单程票、且 switch 会因缺 package.json 抛错。与 install/export 一致走任务中心，
    // 关面板不丢进度。
    const id = tasks.createTask({ kind: 'create', title: `创建 ${name}`, home: runtime?.home });
    tasks.enqueue(async () => {
      const progress = tasks.progressBridge(id);
      try {
        progress('init', '创建目录与 package.json（含官方基线 bundle）');
        const target = await createProfile(runtime.home, name);
        await fsp.writeFile(path.join(target, 'package.json'), `${JSON.stringify({
          name: `dsh-profile-${name}`,
          private: true,
          dependencies: {},
          dsh: { profile: { bundles: [...BASELINE_BUNDLES] } },
        }, null, 2)}\n`);
        progress('manager', '迁装管理器（基本插件）');
        await ensureManagerInProfile(runtime, name);
        tasks.finish(id, { ok: true, title: `创建 ${name}`, result: { name, dir: target, managerInstalled: true } });
      } catch (e) {
        // 建到一半失败：清掉目录，不留残废 profile。
        await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
        tasks.finish(id, { ok: false, error: String(e?.message ?? e) });
      }
    }).catch(() => {});
    return { taskId: id };
  },

  'profile/delete': async ({ runtime, payload }) => {
    const name = need(payload?.name, '缺少 profile 名');
    await deleteProfile(runtime.home, name);
    return { name };
  },

  'profile/switch': async ({ runtime, payload }) => {
    const name = need(payload?.name, '缺少 profile 名');
    return await switchProfile(runtime, name, {
      swapSkills: payload?.swapSkills !== false,
      managerSource: payload?.managerSource === 'copy' ? 'copy' : 'npm',
    });
  },

  // 切换前的只读预检：确认弹窗要显示的 from/to、目标是否已装管理器、是否首次切换。
  // 不安装、不改状态 —— 真正的安装/换指由 profile/switch 在用户确认后执行。
  'profile/switch-check': async ({ runtime, payload }) => {
    const name = need(payload?.name, '缺少 profile 名');
    const profiles = await listProfiles(runtime);
    if (!profiles.some((p) => p.name === name)) throw new Error(`profile「${name}」不存在`);
    const hasManager = await checkManagerInProfile(runtime, name);
    const activeName = await resolveActiveName(runtime);
    const desktop = path.join(runtime.profilesDir, ACTIVE_NAME);
    let firstTime = true;
    try {
      const st = await fsp.lstat(desktop);
      firstTime = !st.isSymbolicLink(); // 还是真实目录 → 首次切换（要移动默认目录）
    } catch { /* desktop 不存在 → 视为首次 */ }
    return { from: activeName ?? 'default', to: name, hasManager, firstTime };
  },

  'profile/open-dir': async ({ runtime, payload }) => {
    const host = getHost();
    const profiles = await listProfiles(runtime);
    const name = payload?.name;
    const target = name
      ? profiles.find((p) => p.name === name)
      : (profiles.find((p) => p.active) ?? profiles[0]);
    if (!target) throw new Error(`找不到 profile「${name ?? ''}」`);
    const cmd = process.platform === 'win32' ? 'explorer'
      : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const r = await host.exec(cmd, [target.dir]);
    if (r.error) throw new Error(`打开目录失败：${r.error}`);
    return { name: target.name, dir: target.dir };
  },

  'pack/export': async ({ runtime, payload }) => {
    const host = getHost();
    // 输入校验（profile 解析）在此同步做，出错立即返回；真正的导出进任务中心异步跑。
    const profile = await resolveExportProfile(runtime, host, payload?.profile ?? null);

    const id = tasks.createTask({ kind: 'export', title: `导出 ${profile.name}`, home: runtime?.home });
    const overrides = {
      out: payload?.out,
      name: payload?.name,
      version: payload?.version,
      displayName: payload?.displayName,
      description: payload?.description,
      author: payload?.author,
      icon: payload?.icon,
      dshVersion: payload?.dshVersion,
      profileName: payload?.profileName,
      exportContent: payload?.exportContent,
      // v5 r2 兼容性字段（UI「兼容性」组）：dshVersions 枚举集 + launchers 兼容声明（透传 buildManifest）
      dshVersions:
        Array.isArray(payload?.dshVersions) && payload.dshVersions.length ? payload.dshVersions : undefined,
      launchers:
        payload?.launchers && typeof payload.launchers === 'object' && !Array.isArray(payload.launchers) && Object.keys(payload.launchers).length
          ? payload.launchers
          : undefined,
      force: payload?.force === true,
      mode: payload?.mode,
      content: payload?.content,
      onProgress: tasks.progressBridge(id),
      onOutput: tasks.logSink(id),
    };
    tasks.enqueue(async () => {
      try {
        const r = await exportFromWorkspace(host, profile, overrides);        tasks.finish(id, {
          ok: true,
          title: `导出 ${r.manifest?.name ?? profile.name}`,
          result: r.output
            ? { mode: 'dspack', output: r.output, sha256: r.sha256, size: r.size, name: r.manifest?.name, version: r.manifest?.version }
            : { mode: 'repo', dir: r.dir, name: r.manifest?.name, version: r.manifest?.version },
        });
      } catch (e) {
        tasks.finish(id, { ok: false, error: String(e?.message ?? e) });
      }
    }).catch(() => {});
    return { taskId: id };
  },

  // 读取某个 profile 的工作区配置（.dshpkcfg）；不存在/非法 → config: null。
  'pack/config-load': async ({ runtime, payload }) => {
    const host = getHost();
    const profile = await resolveExportProfile(runtime, host, payload?.profile ?? null);
    const config = await loadWorkspaceConfig(host, profile.dir);
    return { profile: profile.name, dir: profile.dir, config };
  },

  // 保存某个 profile 的工作区配置（.dshpkcfg）；只落白名单字段、去 null/undefined。
  'pack/config-save': async ({ runtime, payload }) => {
    const host = getHost();
    const profile = await resolveExportProfile(runtime, host, payload?.profile ?? null);
    const path = await saveWorkspaceConfig(host, profile.dir, payload ?? {});
    return { profile: profile.name, dir: profile.dir, path };
  },

  'pack/view': async ({ payload }) => {
    const host = getHost();
    const src = need(payload?.source, '缺少 .dspack 路径或 URL');
    const { path: p, tempDir } = await resolvePackSource(host, src);
    try {
      const r = await inspectPack(host, p);
      return {
        valid: r.valid,
        name: r.manifest?.name ?? '',
        version: r.manifest?.version ?? '',
        sha256: r.sha256,
        size: r.size,
        totalEntries: r.totalEntries,
        validation: r.validation ?? [],
        // v5 r2（v3 §8.4 判定表）：安装前 launchers 判定——警告放行、不硬拒。UI 据 warn 级
        // （supported:false）弹确认对话框、info 级（版本不足 / 白名单未含本启动器）轻提示。
        // 本插件注入官方桌面端（selfId=official-desktop）；版本自报取 DSH_VERSION，
        // 缺省按「版本未知」轻提示放行（与 pack/install 的判定参数一致，所见即所装）。
        launchersWarnings: judgeLaunchers(
          normalizeLaunchers(r.manifest?.launchers),
          'official-desktop',
          process.env.DSH_VERSION ?? null,
        ),
      };
    } finally {
      if (tempDir) await host.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  },

  'pack/install': async ({ runtime, payload }) => {
    const host = getHost();
    const source = need(payload?.source, '缺少 .dspack 路径或 URL');

    const id = tasks.createTask({ kind: 'install', title: '安装整合包', home: runtime?.home });
    tasks.enqueue(async () => {
      try {
        const r = await installPack(host, {
          source,
          name: payload?.name,
          profilesRoot: payload?.profilesRoot ?? runtime?.profilesDir,
          force: payload?.force === true,
          dryRun: payload?.dryRun === true,
          noInstall: payload?.noInstall === true,
          // 市场安装时透传索引里的 sha256/size，交给 installPack 做完整性校验（防篡改/坏档）。
          expectedSha256: payload?.expectedSha256 || undefined,
          expectedSize: payload?.expectedSize,
          // v5 r2 launchers 判定：本插件运行在官方桌面端内，版本取 DSH_VERSION（无则按「版本未知」
          // 轻提示放行）；launcherId 默认不传（core 缺省 'official-desktop'），预留 payload 覆盖口。
          launcherId: payload?.launcherId || undefined,
          launcherVersion: process.env.DSH_VERSION ?? null,
          onProgress: tasks.progressBridge(id),
          onOutput: tasks.logSink(id),
        });
        tasks.finish(id, {
          ok: true,
          title: `安装 ${r.profileName}`,
          result: { profileName: r.profileName, dir: r.dir, dryRun: r.dryRun === true, installed: r.installed === true, filesDownloaded: r.filesDownloaded ?? 0, launchers: r.launchers ?? null },
        });
      } catch (e) {
        tasks.finish(id, { ok: false, error: String(e?.message ?? e) });
      }
    }).catch(() => {});
    return { taskId: id };
  },

  'pack/market': async ({ payload }) => {
    const host = getHost();
    const index = await readMarketIndex(host, payload?.indexPath ?? DEFAULT_MARKET_INDEX);
    return { packs: index?.packs ?? [], error: index?.error ?? null };
  },

  // 市场详情（v5 r2）：懒加载 packs/<id>/manifest.json + README（fetchMarketPackDetail）。
  // 中心索引不平铺 launchers / dshVersions（index 契约 §6.5），完整内容只有懒加载
  // manifest 里有——r2 = pickR2Fields(manifest) 原文透传，badges = r2Badges(manifest) 结构化
  // 徽标（文案由 UI 层按 kind 做 i18n），UI 详情弹窗直接渲染。
  'pack/market-detail': async ({ payload }) => {
    const host = getHost();
    const entry = payload?.pack;
    if (!entry || typeof entry !== 'object') throw new Error('缺少市场条目');
    const d = await fetchMarketPackDetail(host, payload?.indexPath ?? DEFAULT_MARKET_INDEX, entry);
    return { manifest: d.manifest, readme: d.readme, dir: d.dir, r2: d.r2, badges: r2Badges(d.manifest) };
  },

  'task/list': async () => ({ tasks: tasks.list() }),

  // 启动器注册表（机器可读版，specs/launcher-registry.md 头部）：「兼容性」编辑器渲染认领 ID +
  // 显示名。带 1h 内存缓存；拉取失败 / 结构非法回落内置清单（fetchLaunchersRegistry 内置纪律）。
  'launchers/registry': async () => {
    const now = Date.now();
    if (launchersRegistryCache && now - launchersRegistryCache.at < 60 * 60 * 1000) {
      return launchersRegistryCache.value;
    }
    const value = await fetchLaunchersRegistry(getHost());
    launchersRegistryCache = { at: now, value };
    return value;
  },

  // About 页「检查更新」：拉 registry 最新版本并与本地比较（网络 I/O 走 host，与 ensure-manager 同款）。
  'plugin/check-update': async () => {
    const host = getHost();
    const esc = MANAGER.replace('/', '%2F');
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-update-'));
    try {
      const metaPath = path.join(tmp, 'meta.json');
      await host.download(`${NPM_REGISTRY}/${esc}/latest`, metaPath);
      const text = await host.readTextFile(metaPath);
      if (!text) throw new Error(`无法读取 ${MANAGER} 的 NPM 元数据`);
      const latest = JSON.parse(text)?.version;
      if (!latest) throw new Error(`${MANAGER} 尚未发布到 NPM`);
      return {
        current: PACKAGE_VERSION,
        latest,
        outdated: cmpVersion(latest, PACKAGE_VERSION) > 0,
        npmUrl: NPM_URL,
      };
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  },

  // About 页链接（作者/仓库/求 Star）：用系统默认浏览器打开 http/https 链接。
  'plugin/open-url': async ({ payload }) => {
    const url = need(payload?.url, '缺少 URL');
    if (!/^https?:\/\//i.test(url)) throw new Error('仅支持 http/https 链接');
    const host = getHost();
    const cmd = process.platform === 'win32' ? 'explorer'
      : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const r = await host.exec(cmd, [url]);
    if (r.error) throw new Error(`打开链接失败：${r.error}`);
    return { opened: true };
  },

  'task/get': async ({ payload }) => tasks.get(payload?.id),
};
