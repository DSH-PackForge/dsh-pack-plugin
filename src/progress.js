// 切换进度通道：host/helper 写 <home>/.dsh-pack/progress.json，进度窗口轮询渲染时间线。
//
// 时间线步骤顺序即显示顺序；firstTime 时在「杀进程」之后多一步「移动默认目录」。
// 步骤 label 直接写中文：进度窗口是独立进程、拿不到客户端 locale，且目标用户是中文场景。
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FILE = 'progress.json';
const MAIN = fileURLToPath(new URL('./progress-main.cjs', import.meta.url));

const LABELS = {
  install: '安装整合包插件',
  kill: '杀掉原来的进程',
  move: '移动默认目录',
  link: '重新创建链接',
  launch: '正在拉起客户端',
};

export function progressPath(home) {
  return path.join(home, '.dsh-pack', FILE);
}

export async function readProgress(home) {
  try {
    return JSON.parse(await fsp.readFile(progressPath(home), 'utf8'));
  } catch {
    return null;
  }
}

// —— 写串行化 ——
// progress.json 是读-改-写（read-modify-write），多个调用方（onProgress 的 fire-and-forget setStep、
// main 的 await setStep/setPhase）并发时会产生竞态：后读到的旧快照覆盖先写的更新，导致「重新创建链接」
// 已 done 又被 running 覆盖、与「拉起」一起转圈。这里把所有写操作放进同一条 promise 链，读-改-写整体串行。
let chain = Promise.resolve();
function withLock(fn) {
  const run = chain.then(fn, fn);
  chain = run.then(() => {}, () => {});
  return run;
}

async function commit(home, next) {
  const file = progressPath(home);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(next));
  try {
    await fsp.rename(tmp, file);
  } catch {
    // 窗口正读时 rename 可能 EPERM/EBUSY，回退直写（读端有 parse 容错，最多丢一帧）。
    await fsp.writeFile(file, JSON.stringify(next));
  }
  return next;
}

export function writeProgress(home, patch) {
  return withLock(async () => {
    const cur = (await readProgress(home)) ?? {};
    return commit(home, { ...cur, ...patch, updatedAt: Date.now() });
  });
}

/** 时间线步骤（每次返回全新对象数组）。firstTime 时插入「移动默认目录」。 */
export function buildSteps(firstTime) {
  const ids = ['install', 'kill'];
  if (firstTime) ids.push('move');
  ids.push('link', 'launch');
  return ids.map((id) => ({ id, label: LABELS[id], status: 'pending' }));
}

/** 按 id 改一步状态；不存在的 id（如非首切的 move）静默跳过。读写全程在锁内，保证顺序。
 *  注意：不能在锁内再调 writeProgress（它会再次 withLock 造成嵌套死锁），故直接 commit。 */
export function setStep(home, id, status) {
  return withLock(async () => {
    const p = await readProgress(home);
    if (!p || !Array.isArray(p.steps)) return null;
    let changed = false;
    for (const s of p.steps) {
      if (s.id === id && s.status !== status) {
        s.status = status;
        changed = true;
      }
    }
    if (!changed) return p;
    return commit(home, { ...p, updatedAt: Date.now() });
  });
}

/** 收尾：phase 到 done/failed；failed 附 error 供窗口显示。 */
export async function setPhase(home, phase, error = null) {
  return writeProgress(home, { phase, error });
}

/**
 * 派生进度窗口（electron GUI，不带 ELECTRON_RUN_AS_NODE）。返回 pid 供 helper 的杀树脚本排除。
 *
 * 两个实测结论（Windows + electron@44）：
 * 1. 必须 detached:true —— 否则 host 被 helper 的 TerminateProcess 杀掉时，窗口作为 host 的
 *    子进程会被 Windows 连带杀死（父进程一死窗口立即消失，杀树脚本排除再彻底也没用）。
 * 2. 绝不能 windowsHide:true —— CREATE_NO_WINDOW 会让窗口进程活着但 GUI 不显示。
 * 杀树脚本仍按 pid 排除本窗口整棵子树（见 migrate-helper.js 的 $skip），防止直接 Stop-Process 它。
 */
export function spawnProgressWindow(home) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // 防御：绝不把 RUN_AS_NODE 漏给 GUI 进程
  const child = spawn(process.execPath, [MAIN, `--progress-file=${progressPath(home)}`], {
    detached: true,
    stdio: 'ignore',
    env,
  });
  child.on('error', () => {});
  child.unref();
  return child.pid;
}
