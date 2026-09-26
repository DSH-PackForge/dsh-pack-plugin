// 多 profile 目录管理（方案 B 的「安装进兄弟 profile」）。
//
// profile 目录是 DSH 布局的一部分，由本插件拥有；纯 node:fs，不依赖 core。
// 关键约定：
//   - 真实 profile 各自占用 profiles/<name>/ 一个目录；
//   - profiles/desktop 是官方硬编码的激活指针：切换后它永远是一个 junction，
//     指向「当前激活」的真实 profile 目录（见 junction.js）。
import fsp from 'node:fs/promises';
import path from 'node:path';
import { PROFILES_DIR, ACTIVE_NAME } from './runtime.js';
import { RESERVED_PROFILE_NAMES } from './channel.js';
import { HOME_ARTIFACT_STORE } from './core/home-store.js';

// home 级换指 slot 的 stash 根目录（与 home-store.js 里 storeHomeRel 的 .dsh-pack 前缀一致）。
const HOME_STASH = '.dsh-pack';

const STATE_FILE = 'dsh-packforge.json';

export function statePath(home) {
  return path.join(home, STATE_FILE);
}

/** 读插件持久状态；不存在/损坏 → 空对象。 */
export async function readState(home) {
  try {
    const raw = await fsp.readFile(statePath(home), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function writeState(home, state) {
  await fsp.mkdir(home, { recursive: true });
  await fsp.writeFile(statePath(home), JSON.stringify(state, null, 2), 'utf8');
}

async function lstat(p) {
  try {
    return await fsp.lstat(p);
  } catch {
    return null;
  }
}

/** 当前激活的 profile 逻辑名：desktop 是 junction → 目标目录名；真实目录 → 'default'。 */
export async function resolveActiveName(runtime) {
  const desktop = path.join(runtime.profilesDir, ACTIVE_NAME);
  const st = await lstat(desktop);
  if (!st) return null;
  if (st.isSymbolicLink()) {
    const target = await fsp.readlink(desktop);
    return path.basename(path.resolve(runtime.profilesDir, target));
  }
  return 'default';
}

/** 列出 profiles/<name>/ 下全部逻辑 profile（去重，desktop 指针本身不算一个 profile）。 */
export async function listProfiles(runtime) {
  const { profilesDir } = runtime;
  const activeName = await resolveActiveName(runtime);
  const entries = [];
  try {
    for (const d of await fsp.readdir(profilesDir, { withFileTypes: true })) {
      if (d.name === ACTIVE_NAME) continue; // 指针占位，不单独列出
      if (!d.isDirectory()) continue;
      const abs = path.join(profilesDir, d.name);
      entries.push({ name: d.name, dir: abs, active: d.name === activeName, junction: false });
    }
  } catch {
    // profiles 目录尚未存在 → 空列表
  }
  // 首次切换前 desktop 仍是真实目录：补一条「default」逻辑 profile。
  const desktop = path.join(profilesDir, ACTIVE_NAME);
  const st = await lstat(desktop);
  if (st && st.isDirectory() && !st.isSymbolicLink()) {
    entries.unshift({ name: 'default', dir: desktop, active: activeName === 'default', junction: false });
  }
  return entries;
}

export async function createProfile(home, name) {
  if (RESERVED_PROFILE_NAMES.includes(name)) {
    throw new Error(`「${name}」是保留名，不能作为 profile 名`);
  }
  const dir = path.join(home, PROFILES_DIR, name);
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

export async function deleteProfile(home, name) {
  // desktop 指针、default 存档、以及当前激活的真实 profile 都不可删，
  // 否则 desktop / skills / .agent-presets 会成悬空指针。
  const active = await resolveActiveName({ profilesDir: path.join(home, PROFILES_DIR) });
  if (name === ACTIVE_NAME || name === 'default' || name === active) {
    throw new Error(`「${name}」是当前激活的 profile，不能删除`);
  }
  await fsp.rm(path.join(home, PROFILES_DIR, name), { recursive: true, force: true });
  // skills / .agent-presets 的真实数据在 .dsh-pack/<store>/<name>/（换指 slot），删 profile 时一并清除，
  // 否则留在 home 里成孤儿（desktop 指针已指向别的 profile，谁也读不到它们）。
  for (const store of Object.values(HOME_ARTIFACT_STORE)) {
    await fsp.rm(path.join(home, HOME_STASH, store, name), { recursive: true, force: true });
  }
}
