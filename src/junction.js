// 机制 A（推荐）：junction 换指 —— 切换 profile 只改 desktop 这个指针，无 EBUSY、无需退出。
// 机制 B（兜底）：junction 不可用（非 NTFS 等）时，脱管切换进程改名 + 重启（后续接线）。
//
// 安全红线：删除 junction 必须用 unlink（lstat 语义），绝不能用 rm -r ——
// 后者在 Windows 上会递归删掉 junction **目标**目录的内容。
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ACTIVE_NAME } from './runtime.js';
import { readState, writeState, resolveActiveName } from './profiles.js';
import { spawnMigrationHelper } from './migrate.js';
import { ensureManagerInProfile } from './ensure-manager.js';

const JUNCTION_KIND = process.platform === 'win32' ? 'junction' : 'dir';
const HOME_SKILLS = 'skills';
const STASH_DIR = '.dsh-pack';
// Windows 目录被占用时的 rename/symlink 错误码（EBUSY 最常见，EPERM/EACCES 是别名）。
const LOCK_CODES = ['EBUSY', 'EPERM', 'EACCES'];

async function lstat(p) {
  try {
    return await fsp.lstat(p);
  } catch {
    return null;
  }
}

async function isDir(p) {
  const s = await lstat(p);
  return !!s && (s.isDirectory() || s.isSymbolicLink());
}

async function exists(p) {
  return (await lstat(p)) !== null;
}

/**
 * 把激活指针 desktop 换到目标 profile。
 * @returns {Promise<{active:string, method:'junction', requiresRestart:true, previous:string}>}
 */
export async function switchProfile(runtime, target, { swapSkills = true, allowDelegate = true } = {}) {
  const { profilesDir, home } = runtime;
  const desktop = path.join(profilesDir, ACTIVE_NAME);
  const targetDir = path.join(profilesDir, target);

  if (target === ACTIVE_NAME) {
    throw new Error(`「${ACTIVE_NAME}」是官方硬编码的激活指针名，不能作为 profile 名`);
  }
  if (!(await isDir(targetDir))) {
    throw new Error(`profile「${target}」不存在（${targetDir}）`);
  }

  // 0) 迁装管理器：确保目标 profile 也带 @dsh-packforge/dsh-pack-plugin，否则切过去就切不回来。
  //    必须在 rename/unlink 之前做（rename 前 desktop 还是来源本体，之后就读不到了）。
  await ensureManagerInProfile(runtime, target);

  const previous = (await resolveActiveName(runtime)) ?? 'default';

  // 1) 首次切换：desktop 还是真实目录 → 存档为 default，再建指针。
  let st = await lstat(desktop);
  if (st && !st.isSymbolicLink()) {
    const defaultDir = path.join(profilesDir, 'default');
    if (await exists(defaultDir)) {
      throw new Error('profiles/default 已存在，无法把 desktop 存档为 default');
    }
    try {
      await fsp.rename(desktop, defaultDir);
    } catch (err) {
      // Windows：运行中的桌面持有 desktop 内句柄，rename 必 EBUSY。
      // 派生脱管迁移进程在「桌面退出→重启」间隙完成，宿主返回 migrating 提示自动重启。
      if (allowDelegate && process.platform === 'win32' && LOCK_CODES.includes(err?.code)) {
        spawnMigrationHelper(runtime, target);
        return { active: target, method: 'junction', requiresRestart: true, previous, migrating: true };
      }
      throw err;
    }
    st = null;
  }

  // 2) 换指：删旧指针 → 建新指针（junction 用绝对目标）。
  if (st && st.isSymbolicLink()) {
    await fsp.unlink(desktop); // 红线：unlink，不是 rm -r
  }
  await fsp.symlink(targetDir, desktop, JUNCTION_KIND);

  // 3) home 级 skills 解包/回退（目标 profile 带 skills 才动，不轻易碰用户的 home 级 skills）。
  if (swapSkills) {
    await swapHomeSkills(home, previous, targetDir);
  }

  // 4) 落 state。
  const state = await readState(home);
  state.activeProfile = target;
  state.desktopIsJunction = true;
  await writeState(home, state);

  return { active: target, method: 'junction', requiresRestart: true, previous };
}

// skills 是 home 级（$DSH_HOME/skills），不在 profile 目录里（官方源码确证）。
// 切换时把当前 home 级 skills 暂存回「上一个 profile」名下，再把目标 profile 里打包的 skills 解到 home 级，
// 这样切回上一个 profile 时能原样恢复。
async function swapHomeSkills(home, previousName, targetDir) {
  const homeSkills = path.join(home, HOME_SKILLS);
  const targetSkills = path.join(targetDir, HOME_SKILLS);
  if (!(await isDir(targetSkills))) return; // 目标没带 skills → 不动用户 home 级 skills

  const stash = path.join(home, STASH_DIR, 'skills', previousName || 'default');
  if (await isDir(homeSkills)) {
    await fsp.mkdir(path.dirname(stash), { recursive: true });
    await fsp.rm(stash, { recursive: true, force: true });
    await fsp.rename(homeSkills, stash);
  }
  await fsp.rm(homeSkills, { recursive: true, force: true });
  await fsp.cp(targetSkills, homeSkills, { recursive: true });
}

/** 机制 B（兜底）：junction 不可用时的脱管切换器。先走机制 A，此路径后续接线。 */
export async function switchProfileViaHelper(_runtime, _target) {
  throw new Error('机制 B（脱管切换器）尚未接线，请先用 junction（机制 A）');
}
