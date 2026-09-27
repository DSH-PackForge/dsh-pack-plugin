// 切换时把管理器 @dsh-packforge/dsh-pack-plugin 迁装进目标 profile。
//
// 管理器是「住在 profile 里的 bundle」，而切换 = 换掉整个 profile，管理器会被一起换走、
// 导致切过去就切不回来（单程票）。按不变量：管理器只在「装了自己的 profile」里运行，
// 所以从当前激活 profile（来源）复制它到目标即可，npm 发布前无需联网。
//
// 安装来源两种：
//   - npm（切换默认）：从 registry 拉最新版 tarball 解包（只落这一个包，不碰目标其它依赖）。
//   - copy：从当前激活 profile 复制管理器本体，离线、快。
// 拉取最新失败（未发布 / 网络不通）时次之回退 copy —— 管理器只在自己 profile 里运行，来源必有，
// 离线也能迁装，不让切换硬失败。
//
// 管理器是自包含 bundle（host 侧已由 scripts/bundle-host.mjs 用 esbuild 内联
// fflate / proxy-agent / proxy-from-env 及其传递依赖），迁装只需搬管理器目录本身，
// 无需再手工同步任何「顶层 node_modules 依赖清单」——那正是 f91f375 引入 proxy-agent 后
// 清单漏更、导致切换后 failed to import 的根因。

import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ACTIVE_NAME } from './runtime.js';
import { getHost } from './host.js';
import { untar } from './core/tar.js';

const MANAGER = '@dsh-packforge/dsh-pack-plugin';
const FALLBACK_SPECS = { [MANAGER]: '^0.2.0' };
const NPM_REGISTRY = 'https://registry.npmjs.org';

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readManifest(profileDir) {
  return JSON.parse(await fsp.readFile(path.join(profileDir, 'package.json'), 'utf8'));
}

async function writeManifest(profileDir, manifest) {
  await fsp.writeFile(path.join(profileDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

function managerDir(profileDir) {
  return path.join(profileDir, 'node_modules', ...MANAGER.split('/'));
}

function hasManagerBundle(manifest) {
  return Array.isArray(manifest?.dsh?.profile?.bundles)
    && manifest.dsh.profile.bundles.includes(MANAGER);
}

/**
 * 把管理器从当前激活 profile 迁装进 target（幂等）。
 * @param {object} runtime { profilesDir, home }
 * @param {string} target 目标 profile 名
 * @param {{source?: 'copy'|'npm'}} [opts] 安装来源；切换走 npm（拉取最新，失败次之回退 copy），
 *        创建空整合包走默认 copy（离线）。
 * @returns {Promise<{installed:boolean, spec:string, source:string}>}
 */
export async function ensureManagerInProfile(runtime, target, { source = 'copy' } = {}) {
  const sourceDir = path.join(runtime.profilesDir, ACTIVE_NAME);
  const targetDir = path.join(runtime.profilesDir, target);

  const targetManifest = await readManifest(targetDir);
  const alreadyInstalled = hasManagerBundle(targetManifest)
    && await exists(path.join(managerDir(targetDir), 'package.json'));
  if (alreadyInstalled) {
    return { installed: false, spec: targetManifest.dependencies?.[MANAGER], source: 'installed' };
  }

  // npm（拉取最新）失败时次之回退 copy（复制当前 profile 的管理器，离线可靠）。
  let spec;
  let used = source;
  if (source === 'npm') {
    try {
      spec = await npmPullManager(runtime, targetDir);
    } catch {
      spec = await copyManager(sourceDir, targetDir, target);
      used = 'copy';
    }
  } else {
    spec = await copyManager(sourceDir, targetDir, target);
  }

  // 登记进目标 package.json：dependencies + bundles。
  targetManifest.dependencies ??= {};
  targetManifest.dependencies[MANAGER] = spec;
  if (!hasManagerBundle(targetManifest)) {
    targetManifest.dsh ??= {};
    targetManifest.dsh.profile ??= {};
    targetManifest.dsh.profile.bundles ??= [];
    targetManifest.dsh.profile.bundles.push(MANAGER);
  }
  await writeManifest(targetDir, targetManifest);

  return { installed: true, spec, source: used };
}

/** 来源 profile 复制（离线）：管理器本体（自包含 bundle，零外部依赖）。 */
async function copyManager(sourceDir, targetDir, target) {
  const sourceManager = managerDir(sourceDir);
  if (!(await exists(path.join(sourceManager, 'package.json')))) {
    throw new Error(`当前 profile 里没有 ${MANAGER}，无法迁装到「${target}」（请先在本 profile 安装管理器）`);
  }
  const sourceManifest = await readManifest(sourceDir);
  const spec = sourceManifest.dependencies?.[MANAGER] ?? FALLBACK_SPECS[MANAGER];

  await fsp.mkdir(path.dirname(managerDir(targetDir)), { recursive: true });
  await fsp.cp(sourceManager, managerDir(targetDir), { recursive: true, force: true });
  return spec;
}

/** 从 NPM registry 拉最新版：解析元数据 → 下载 tarball → 解包到目标（自包含，不读来源 profile）。 */
async function npmPullManager(runtime, targetDir) {
  const host = getHost();
  const esc = MANAGER.replace('/', '%2F');
  const metaUrl = `${NPM_REGISTRY}/${esc}/latest`;
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-npm-'));

  try {
    const metaPath = path.join(tmp, 'meta.json');
    await host.download(metaUrl, metaPath);
    const metaText = await host.readTextFile(metaPath);
    if (!metaText) throw new Error(`无法读取 ${MANAGER} 的 NPM 元数据`);
    const meta = JSON.parse(metaText);
    const version = meta?.version;
    const tarball = meta?.dist?.tarball;
    if (!version || !tarball) {
      throw new Error(`${MANAGER} 尚未发布到 NPM（拉取最新失败）`);
    }

    const tgzPath = path.join(tmp, 'pkg.tgz');
    await host.download(tarball, tgzPath);
    const bytes = await host.readFile(tgzPath);
    if (!bytes) throw new Error(`下载 ${MANAGER} 的 NPM 包失败`);

    const entries = untar(bytes);
    const dest = managerDir(targetDir);
    let written = 0;
    for (const [entryPath, data] of Object.entries(entries)) {
      const rel = entryPath.startsWith('package/') ? entryPath.slice('package/'.length) : null;
      if (!rel || rel === '' || rel.endsWith('/')) continue;
      await fsp.mkdir(path.dirname(path.join(dest, rel)), { recursive: true });
      await fsp.writeFile(path.join(dest, rel), data);
      written += 1;
    }
    if (written === 0) throw new Error(`${MANAGER} 的 NPM 包内容为空`);

    return `^${version}`;
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * 只读检测目标 profile 是否已装管理器（确认弹窗的预检用，不安装）。
 * @returns {Promise<boolean>}
 */
export async function checkManagerInProfile(runtime, target) {
  const targetDir = path.join(runtime.profilesDir, target);
  try {
    const manifest = await readManifest(targetDir);
    return hasManagerBundle(manifest)
      && await exists(path.join(managerDir(targetDir), 'package.json'));
  } catch {
    return false;
  }
}
