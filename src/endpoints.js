// 宿主 endpoint 层：UI（rpc.call）与 AI 工具（薄壳）共用的唯一业务入口。
//
// 每个 handler 收 { ctx, runtime, payload, signal, peer }，返回纯值；
// 抛错由 rpc.js 统一转成 { ok:false, error }。core 的 .dspack 格式逻辑经 Host 注入调用。
import {
  resolveProfileInput,
  exportFromWorkspace,
  inspectPack,
  installPack,
  resolvePackSource,
  readMarketIndex,
  DEFAULT_MARKET_INDEX,
} from './core/index.js';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { getHost } from './host.js';
import { listProfiles, createProfile, deleteProfile, readState, writeState, resolveActiveName } from './profiles.js';
import { switchProfile } from './junction.js';
import { CHANNEL } from './channel.js';
import { ACTIVE_NAME } from './runtime.js';
import { checkManagerInProfile } from './ensure-manager.js';

const need = (v, msg) => {
  if (v == null || v === '') throw new Error(msg);
  return String(v).trim();
};

const PROFILE_NAME_RE = /^[\w.-]+$/;

export const ENDPOINTS = {
  'runtime/get': async ({ runtime }) => ({
    ...runtime,
    platform: process.platform,
    node: process.version,
    dshVersion: process.env.DSH_VERSION ?? null,
    rpc: CHANNEL,
  }),

  'config/get': async ({ runtime }) => (await readState(runtime.home)).config ?? {},

  'config/set': async ({ runtime, payload }) => {
    const s = await readState(runtime.home);
    s.config = { ...(s.config ?? {}), ...(payload ?? {}) };
    await writeState(runtime.home, s);
    return s.config;
  },

  'profile/list': async ({ runtime }) => ({ profiles: await listProfiles(runtime) }),

  'profile/create': async ({ runtime, payload }) => {
    const name = need(payload?.name, '缺少 profile 名');
    if (!PROFILE_NAME_RE.test(name)) throw new Error('profile 名只能含字母数字、下划线、点、连字符');
    const dir = await createProfile(runtime.home, name);
    return { name, dir };
  },

  'profile/delete': async ({ runtime, payload }) => {
    const name = need(payload?.name, '缺少 profile 名');
    await deleteProfile(runtime.home, name);
    return { name };
  },

  'profile/switch': async ({ runtime, payload }) => {
    const name = need(payload?.name, '缺少 profile 名');
    return await switchProfile(runtime, name, { swapSkills: payload?.swapSkills !== false });
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
    const profiles = await listProfiles(runtime);
    const active = profiles.find((p) => p.active) ?? profiles[0] ?? null;
    const want = payload?.profile ?? null;

    // 导出目标：默认当前激活 profile；名字优先在桌面 home（与切换列表同一套）里匹配，
    // 匹配不到再当路径/全局名兜底（CLI / AI 工具导出任意目录用）。
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

    const r = await exportFromWorkspace(host, profile, {
      out: payload?.out,
      name: payload?.name,
      version: payload?.version,
      dshVersion: payload?.dshVersion,
      force: payload?.force === true,
      mode: payload?.mode,
      content: payload?.content,
    });
    return r.output
      ? {
          mode: 'dspack',
          output: r.output,
          sha256: r.sha256,
          size: r.size,
          name: r.manifest.name,
          version: r.manifest.version,
        }
      : { mode: 'repo', dir: r.dir, name: r.manifest.name, version: r.manifest.version, content: r.content };
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
      };
    } finally {
      if (tempDir) await host.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  },

  'pack/install': async ({ runtime, payload }) => {
    const host = getHost();
    const r = await installPack(host, {
      source: need(payload?.source, '缺少 .dspack 路径或 URL'),
      name: payload?.name,
      profilesRoot: payload?.profilesRoot ?? runtime?.profilesDir,
      force: payload?.force === true,
      dryRun: payload?.dryRun === true,
      noInstall: payload?.noInstall === true,
    });
    return {
      profileName: r.profileName,
      dir: r.dir,
      dryRun: r.dryRun === true,
      installed: r.installed === true,
      filesDownloaded: r.filesDownloaded ?? 0,
    };
  },

  'pack/market': async ({ payload }) => {
    const host = getHost();
    const index = await readMarketIndex(host, payload?.indexPath ?? DEFAULT_MARKET_INDEX);
    return { packs: index?.packs ?? [], error: index?.error ?? null };
  },
};
