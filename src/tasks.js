// 任务中心：host 端「安装 / 导出 / 创建」任务的运行期注册表 + 串行队列 + 日志缓冲。
//
// 数据仅存内存（重启即失）。任务中心是设置面板里的内嵌视图（见 settings.js），
// 通过 task/list、task/get 两个 RPC 直读这里的内存数据，不再有独立窗口 / 快照文件。
//
// 日志上限 1000 行 / 256KB（先到先丢最旧，置 logTruncated）。
const MAX_LOG_LINES = 1000;
const MAX_LOG_BYTES = 256 * 1024;

// 阶段顺序即面板时间线顺序；label 为默认中文（与旧独立窗口一致，目标用户是中文场景）。
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

export function createTask({ kind, title }) {
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
  if (t) t.title = title;
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
}

/** 串行队列：安装/导出共用一个 Promise 链（上一个 settle 后再跑下一个，失败不阻断后续）。 */
let queueTail = Promise.resolve();
export function enqueue(job) {
  const run = queueTail.then(job);
  queueTail = run.catch(() => {});
  return run;
}

function publicView(t) {
  const { _pending, logBytes, ...rest } = t;
  return rest;
}
