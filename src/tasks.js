// 任务中心：host 端「安装 / 导出」任务的运行期注册表 + 串行队列 + 日志缓冲 + 快照镜像。
//
// 数据仅存内存（重启即失）。快照文件只是跨进程管道：独立任务窗口（task-center-main.cjs）
// 读不到 host 内存，每次更新把 Map 镜像到系统临时目录 JSON，窗口轮询渲染。
// 不读回、不恢复 → 语义仍是「仅运行期内存」。
//
// 日志上限 1000 行 / 256KB（先到先丢最旧，置 logTruncated）；100ms 尾沿节流 + 完成时强刷。
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MAIN = fileURLToPath(new URL('./task-center-main.cjs', import.meta.url));

const MAX_LOG_LINES = 1000;
const MAX_LOG_BYTES = 256 * 1024;
const THROTTLE_MS = 100;

// 阶段顺序即窗口时间线顺序；label 为默认中文（独立进程拿不到客户端 locale，与 progress.js 同理）。
const STAGE_DEFS = {
  install: [
    ['download', '下载整合包'],
    ['extract', '解析并写入'],
    ['install', 'pnpm install'],
    ['files', '下载 files[]'],
  ],
  export: [
    ['scan', '扫描文件'],
    ['manifest', '生成 manifest'],
    ['collect', '收集内容'],
    ['pack', '打包'],
    ['write', '写盘'],
  ],
  create: [
    ['init', '初始化 profile'],
    ['manager', '迁装管理器（基本插件）'],
  ],
};

const tasks = new Map();
let seq = 0;
let currentHome = null;
let mirrorTimer = null;
let mirrorDirty = false;

// 快照文件名按 home 稳定派生：同一 host 进程内重开窗口用同一条路径，且不落用户目录（临时管道而已）。
function snapshotPath(home) {
  const key = String(home).replace(/[\\/:]/g, '_').replace(/[^a-zA-Z0-9_-]/g, '').slice(-60) || 'default';
  return path.join(os.tmpdir(), `dsh-pack-tasks-${key}.json`);
}

function markerPath(home) {
  return snapshotPath(home).replace(/\.json$/, '.pid');
}

export function createTask({ kind, title, home }) {
  const id = 't_' + Date.now().toString(36) + '_' + (++seq).toString(36);
  const def = STAGE_DEFS[kind] ?? STAGE_DEFS.install;
  const task = {
    id,
    kind: STAGE_DEFS[kind] ? kind : 'install',
    title: title || (kind === 'export' ? '导出' : '安装'),
    status: 'queued',
    stages: def.map(([sid, label]) => ({ id: sid, label, status: 'pending' })),
    current: null,
    log: [],
    logTruncated: false,
    logBytes: 0,
    _pending: '',
    startedAt: Date.now(),
    finishedAt: null,
    result: null,
    error: null,
  };
  tasks.set(id, task);
  if (home) currentHome = home;
  mirror();
  return id;
}

export function get(id) {
  return tasks.get(id) ?? null;
}

export function list() {
  return [...tasks.values()].map(publicView);
}

export function setTitle(id, title) {
  const t = tasks.get(id);
  if (t) {
    t.title = title;
    mirror();
  }
}

/** onProgress 桥：install/export 的 stage 回调 → 时间线推进。不回退已完成阶段（容忍 dshhome/repo 的重复阶段）。 */
export function progressBridge(id) {
  return (stage, detail) => {
    const t = tasks.get(id);
    if (!t) return;
    const s = t.stages.find((x) => x.id === stage);
    if (!s) return; // 未知阶段（含 install 的 'done'）静默跳过
    if (s.status === 'done') return;
    if (s.status !== 'running') {
      s.status = 'running';
      s.startedAt = s.startedAt ?? Date.now();
    }
    if (detail) s.label = detail;
    t.current = stage;
    mirror();
  };
}

/** 命令输出汇入 log（按行切分；进程输出可能不是行缓冲，末尾半行留待 finish 强刷）。 */
export function logSink(id) {
  return (chunk) => {
    const t = tasks.get(id);
    if (!t) return;
    t._pending += String(chunk);
    let nl;
    while ((nl = t._pending.indexOf('\n')) >= 0) {
      pushLine(t, t._pending.slice(0, nl));
      t._pending = t._pending.slice(nl + 1);
    }
    mirror();
  };
}

function pushLine(t, line) {
  t.log.push(line.replace(/\r$/, '')); // 去 Windows \r 残留
  t.logBytes += line.length + 1;
  while (t.log.length > MAX_LOG_LINES || t.logBytes > MAX_LOG_BYTES) {
    const dropped = t.log.shift();
    t.logBytes -= dropped.length + 1;
    t.logTruncated = true;
  }
}

export function finish(id, { ok, result, error, title }) {
  const t = tasks.get(id);
  if (!t) return;
  if (t._pending) {
    pushLine(t, t._pending);
    t._pending = '';
  }
  t.status = ok ? 'done' : 'failed';
  t.result = result ?? null;
  t.error = error ?? null;
  t.finishedAt = Date.now();
  if (title) t.title = title;
  for (const s of t.stages) {
    if (ok) {
      s.status = 'done';
      s.finishedAt = s.finishedAt ?? Date.now();
    } else if (s.status === 'running') {
      s.status = s.id === t.current ? 'failed' : 'done';
    }
  }
  t.current = null;
  mirror(true);
}

/** 串行队列：安装/导出共用一个 Promise 链（上一个 settle 后再跑下一个，失败不阻断后续）。 */
let queueTail = Promise.resolve();
export function enqueue(job) {
  const run = queueTail.then(job);
  queueTail = run.catch(() => {});
  return run;
}

/** 确保任务窗口已开：marker 记录窗口 pid，进程活着即复用，否则派生。并发调用合并成一次打开流程。 */
let opening = null;
export async function ensureWindow(home) {
  if (!home) return;
  if (opening) return opening;
  opening = (async () => {
    const marker = markerPath(home);
    try {
      const pid = parseInt(await fsp.readFile(marker, 'utf8'), 10);
      if (pid && isAlive(pid)) return;
    } catch { /* 无 marker → 派生 */ }
    spawnWindow(home);
  })().finally(() => { opening = null; });
  return opening;
}

export function spawnWindow(home) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // 防御：绝不把 RUN_AS_NODE 漏给 GUI 进程
  const child = spawn(process.execPath,
    [MAIN, `--tasks-file=${snapshotPath(home)}`, `--window-marker=${markerPath(home)}`],
    { stdio: 'ignore', env });
  child.on('error', () => {});
  child.unref();
  return child.pid;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function publicView(t) {
  const { _pending, logBytes, ...rest } = t;
  return rest;
}

function mirror(force = false) {
  mirrorDirty = true;
  if (force) {
    if (mirrorTimer) {
      clearTimeout(mirrorTimer);
      mirrorTimer = null;
    }
    void writeSnapshot();
    return;
  }
  if (mirrorTimer) return;
  mirrorTimer = setTimeout(() => {
    mirrorTimer = null;
    void writeSnapshot();
  }, THROTTLE_MS);
}

async function writeSnapshot() {
  if (!mirrorDirty) return;
  mirrorDirty = false;
  if (!currentHome) return;
  const file = snapshotPath(currentHome);
  const data = JSON.stringify({ hostPid: process.pid, tasks: [...tasks.values()].map(publicView) });
  try {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await fsp.writeFile(tmp, data);
    try {
      await fsp.rename(tmp, file);
    } catch {
      // 窗口正读时 rename 可能 EPERM/EBUSY，回退直写（读端有 parse 容错，最多丢一帧）。
      await fsp.writeFile(file, data);
    }
  } catch { /* 写盘失败忽略 */ }
}
