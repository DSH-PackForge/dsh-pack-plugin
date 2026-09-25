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

export async function writeProgress(home, patch) {
  const file = progressPath(home);
  const cur = (await readProgress(home)) ?? {};
  const next = { ...cur, ...patch, updatedAt: Date.now() };
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

/** 时间线步骤（每次返回全新对象数组）。firstTime 时插入「移动默认目录」。 */
export function buildSteps(firstTime) {
  const ids = ['install', 'kill'];
  if (firstTime) ids.push('move');
  ids.push('link', 'launch');
  return ids.map((id) => ({ id, label: LABELS[id], status: 'pending' }));
}

/** 按 id 改一步状态；不存在的 id（如非首切的 move）静默跳过。 */
export async function setStep(home, id, status) {
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
  return writeProgress(home, { steps: p.steps });
}

/** 收尾：phase 到 done/failed；failed 附 error 供窗口显示。 */
export async function setPhase(home, phase, error = null) {
  return writeProgress(home, { phase, error });
}

/**
 * 派生进度窗口（electron GUI，不带 ELECTRON_RUN_AS_NODE）。返回 pid 供 helper 的杀树脚本排除，
 * 否则杀桌面整棵树时会连窗口一起杀掉。
 */
export function spawnProgressWindow(home) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // 防御：绝不把 RUN_AS_NODE 漏给 GUI 进程
  const child = spawn(process.execPath, [MAIN, `--progress-file=${progressPath(home)}`], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env,
  });
  child.on('error', () => {});
  child.unref();
  return child.pid;
}
