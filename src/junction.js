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
import { spawnProgressWindow, writeProgress, buildSteps, setStep, setPhase, HINT } from './progress.js';
import { HOME_ARTIFACT_STORE } from './core/home-store.js';

const JUNCTION_KIND = process.platform === 'win32' ? 'junction' : 'dir';
const STASH_DIR = '.dsh-pack';

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
export async function switchProfile(runtime, target, { swapSkills = true, allowDelegate = true, onProgress, managerSource = 'copy' } = {}) {
  const { profilesDir, home } = runtime;
  const desktop = path.join(profilesDir, ACTIVE_NAME);
  const targetDir = path.join(profilesDir, target);

  if (target === ACTIVE_NAME) {
    throw new Error(`「${ACTIVE_NAME}」是官方硬编码的激活指针名，不能作为 profile 名`);
  }
  if (!(await isDir(targetDir))) {
    throw new Error(`profile「${target}」不存在（${targetDir}）`);
  }

  const previous = (await resolveActiveName(runtime)) ?? 'default';

  // 1) 每次切换都走脱管 helper：杀桌面 → 换指 → 自动重启（体验一致，不只首次迁移）。
  //    先派进度窗口 + 落初始进度，再迁装管理器（带进度），最后派生 helper。
  //    helper 自身（allowDelegate=false）或非 win32 走下面的原地换指。
  if (allowDelegate && process.platform === 'win32') {
    const st = await lstat(desktop);
    const firstTime = !(st && st.isSymbolicLink()); // 还是真实目录 → 首次切换
    const progressPid = spawnProgressWindow(home);
    await writeProgress(home, { from: previous, to: target, firstTime, phase: 'running', steps: buildSteps(firstTime), hint: HINT });
    try {
      await setStep(home, 'install', 'running');
      await ensureManagerInProfile(runtime, target, { source: managerSource });
      await setStep(home, 'install', 'done');
    } catch (err) {
      await setPhase(home, 'failed', err?.message ?? String(err));
      throw err;
    }
    spawnMigrationHelper(runtime, target, { progressPid });
    return { active: target, method: 'junction', requiresRestart: true, previous, restarting: true };
  }

  // 2) 原地换指（非 win32 / helper 自身）：先迁装管理器，首次把 desktop 存档为 default，再建指针。
  //    helper 已在杀桌面后调用，rename 即便 EBUSY 也会被其轮询重试（LOCK_CODES 见 migrate-helper.js）。
  await ensureManagerInProfile(runtime, target, { source: managerSource });
  let st = await lstat(desktop);
  if (st && !st.isSymbolicLink()) {
    const defaultDir = path.join(profilesDir, 'default');
    if (await exists(defaultDir)) {
      throw new Error('profiles/default 已存在，无法把 desktop 存档为 default');
    }
    onProgress?.('move', 'running');
    await fsp.rename(desktop, defaultDir);
    onProgress?.('move', 'done');
    st = null;
  }

  // 3) 删旧指针 → 建新指针（junction 用绝对目标）。
  onProgress?.('link', 'running');
  if (st && st.isSymbolicLink()) {
    await fsp.unlink(desktop); // 红线：unlink，不是 rm -r
  }
  await fsp.symlink(targetDir, desktop, JUNCTION_KIND);
  onProgress?.('link', 'done');

  // 3) home 级 skills / .agent-presets 换指（各 artifact 独立判断首次迁移，与 desktop 解耦）。
  if (swapSkills) {
    for (const artifact of Object.keys(HOME_ARTIFACT_STORE)) {
      await repointHomeArtifact(home, artifact, previous, target);
    }
  }

  // 4) 落 state。
  const state = await readState(home);
  state.activeProfile = target;
  state.desktopIsJunction = true;
  await writeState(home, state);

  return { active: target, method: 'junction', requiresRestart: true, previous };
}

// skills / .agent-presets 是 home 级（$DSH_HOME/<artifact>），不在 profile 目录里（官方源码确证）。
// 切换 = 把 <artifact> 这个 junction 指到 .dsh-pack/<store>/<target>；首次切换时若它还是真实目录，
// 先存档到 .dsh-pack/<store>/<previous>（活目录优先：rm -r 掉旧 stash/同名 slot 再 rename）。
// 每个 artifact 各自 lstat 判断，与 desktop 的 firstTime 解耦——desktop 已迁、skills 未迁也能各迁各的。
async function repointHomeArtifact(home, artifact, previousName, targetName) {
  const store = HOME_ARTIFACT_STORE[artifact];
  const link = path.join(home, artifact);
  const storeDir = path.join(home, STASH_DIR, store);
  const target = path.join(storeDir, targetName);

  const st = await lstat(link);
  if (st && !st.isSymbolicLink()) {
    // 首次迁移：真实目录存档到「上一个 profile」名下。
    const prev = path.join(storeDir, previousName || 'default');
    await fsp.mkdir(storeDir, { recursive: true });
    await fsp.rm(prev, { recursive: true, force: true });
    await fsp.rename(link, prev);
  }

  // 换指：删旧指针（红线 unlink，不是 rm -r）→ 保证目标 slot 存在 → 建 junction（绝对目标）。
  if (st && st.isSymbolicLink()) {
    await fsp.unlink(link);
  }
  await fsp.mkdir(target, { recursive: true });
  await fsp.symlink(target, link, JUNCTION_KIND);
}

/** 机制 B（兜底）：junction 不可用时的脱管切换器。先走机制 A，此路径后续接线。 */
export async function switchProfileViaHelper(_runtime, _target) {
  throw new Error('机制 B（脱管切换器）尚未接线，请先用 junction（机制 A）');
}
