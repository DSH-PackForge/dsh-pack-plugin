// 脱管迁移进程的宿主侧入口（机制 B 的「派生」半步）。
//
// 运行中的桌面持有 profiles/desktop 内句柄，首次切换要 rename(desktop→default) 必 EBUSY。
// 所以派生一个与宿主进程树脱钩的进程：杀 electron 释放锁 → 改名 → 建 junction → 重启桌面。
//
// 派生技巧：用 process.execPath（= electron.exe）+ ELECTRON_RUN_AS_NODE=1 当纯 node 跑 helper，
// 不依赖 PATH 上的 node（安装环境里 node 不一定在 PATH，但 electron 一定在）。
// detached:true 让 helper 挂在独立进程组，taskkill /T 杀 electron 树时杀不到它。
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HELPER = fileURLToPath(new URL('./migrate-helper.js', import.meta.url));

/** dev 沙盒路径 <repo>/apps/desktop/.desktop-build/... → 反推仓库根；非 dev 返回 null。 */
function detectDevRepoRoot(profilesDir) {
  const parts = profilesDir.split(path.sep);
  const i = parts.indexOf('.desktop-build');
  if (i < 2) return null;
  const root = parts.slice(0, i - 2).join(path.sep);
  return root || null;
}

/**
 * 派生脱管迁移进程。宿主应立即把返回值（migrating）回给 UI，然后等待桌面被 helper 杀掉重启。
 * @returns {Promise<number|undefined>} helper 的 pid
 */
export function spawnMigrationHelper(runtime, target) {
  const electronPid = process.ppid; // 宿主进程的父 = electron 主进程（进程树已确证）
  const args = [
    HELPER,
    `--electron-pid=${electronPid}`,
    `--profiles-dir=${runtime.profilesDir}`,
    `--home=${runtime.home}`,
    `--target=${target}`,
  ];
  const repoRoot = detectDevRepoRoot(runtime.profilesDir);
  if (repoRoot) {
    args.push(`--relaunch-cwd=${repoRoot}`);
    args.push('--relaunch-cmd=pnpm start:desktop');
  }
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    // 关键：不能用宿主进程的 cwd（可能是 profiles/desktop）——Windows 里进程 CWD 是打开句柄，
    // 会让 helper 自己占着正要 rename 的目录，导致永远 EBUSY。放用户主目录，完全脱离 DSH 树。
    cwd: os.homedir(),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    windowsHide: true,
  });
  child.on('error', () => {}); // 派生失败不炸宿主（由日志兜底）
  child.unref();
  return child.pid;
}
