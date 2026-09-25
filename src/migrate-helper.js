// 脱管迁移进程（机制 B 执行体）。
//
// 由 migrate.js 用 `ELECTRON_RUN_AS_NODE=1 process.execPath 本文件` 派生，与宿主进程树脱钩。
// 流程：留出响应 flush 宽限 → 杀 electron 主进程树 → 轮询 rename(desktop→default) 直到锁释放 →
//       switchProfile 完成建 junction + 落 state → 重启桌面 → 退出。
import fsp from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { switchProfile } from './junction.js';
import { setStep, setPhase } from './progress.js';

// —— 参数解析（--key=value，值由 spawn 原样传入，无 shell 拆词）——
const argv = {};
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)=(.*)$/.exec(a);
  if (m) argv[m[1]] = m[2];
}
const electronPid = Number(argv['electron-pid']) || 0;
const profilesDir = argv['profiles-dir'];
const home = argv['home'];
const target = argv['target'];
const relaunchCmd = argv['relaunch-cmd'] ?? '';
const relaunchCwd = argv['relaunch-cwd'] ?? '';
const progressPid = Number(argv['progress-pid']) || 0;

const LOG = path.join(home, '.dsh-pack', 'migrate.log');
async function log(msg) {
  try {
    await fsp.mkdir(path.dirname(LOG), { recursive: true });
    await fsp.appendFile(LOG, `[${new Date().toISOString()}] ${msg}\n`);
  } catch { /* 日志失败不影响迁移 */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOCK_CODES = ['EBUSY', 'EPERM', 'EACCES'];

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, ...opts }, (err, stdout, stderr) => {
      resolve({ err, stdout: (stdout || '').trim(), stderr: (stderr || '').trim() });
    });
  });
}

async function captureCommandLine(pid) {
  if (process.platform !== 'win32' || !pid) return null;
  const script = `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object -ExpandProperty CommandLine`;
  const r = await run('powershell', ['-NoProfile', '-Command', script]);
  return r.err ? null : (r.stdout || null);
}

// 杀整条桌面启动链。绝不能用 taskkill /T（会连 helper 自己一起杀）；也不能只杀 electron
// 主进程后代——锁其实被启动器 tsx scripts/dev.ts（electron 主进程的父）握着，它要慢慢退出
// 才释放锁。正确做法：从主进程沿父链上溯到启动器链顶端（node/electron/cmd），杀整条链的树，
// 仍排除 helper 自身与运行本脚本的 powershell，并停在 bash（调用方的 shell）之前。
function killScript(mainPid, selfPid, progressPid) {
  return `
$main = ${mainPid}
$self = ${selfPid}
$progress = ${progressPid}
$all = @(Get-CimInstance Win32_Process)
$parent = @{}; $name = @{}
foreach ($p in $all) { $parent[$p.ProcessId] = $p.ParentProcessId; $name[$p.ProcessId] = $p.Name }
$root = $main
$cur = $main
while ($true) {
  $par = $parent[$cur]
  if (-not $par) { break }
  if ($name[$par] -notmatch '^(node|electron|cmd|conhost)') { break }
  $root = $par
  $cur = $par
}
# 进度窗口是 electron GUI，会派生子进程（renderer/GPU/utility）；只排除它的主 pid 不够，
# 那些子进程会被当桌面后代一起杀掉、窗口随之消失。这里算出 $progress 整棵子树一并跳过。
$skip = New-Object 'System.Collections.Generic.HashSet[int]'
[void]$skip.Add($progress)
$pq = New-Object 'System.Collections.Generic.List[int]'
$pq.Add($progress)
while ($pq.Count -gt 0) {
  $n = $pq[0]; $pq.RemoveAt(0)
  foreach ($p in $all) {
    if ($parent[$p.ProcessId] -eq $n -and -not $skip.Contains($p.ProcessId)) {
      [void]$skip.Add($p.ProcessId); $pq.Add($p.ProcessId)
    }
  }
}
$desc = New-Object 'System.Collections.Generic.List[int]'
$q = New-Object 'System.Collections.Generic.List[int]'
$q.Add($root)
while ($q.Count -gt 0) {
  $n = $q[0]; $q.RemoveAt(0)
  foreach ($p in $all) {
    if ($parent[$p.ProcessId] -eq $n) { $desc.Add($p.ProcessId); $q.Add($p.ProcessId) }
  }
}
foreach ($p in $desc) {
  if ($p -eq $self -or $p -eq $PID -or $skip.Contains($p)) { continue }
  Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
}
Stop-Process -Id $root -Force -ErrorAction SilentlyContinue
`;
}

async function killElectronTree(mainPid) {
  if (process.platform === 'win32' && mainPid) {
    await run('powershell', ['-NoProfile', '-Command', killScript(mainPid, process.pid, progressPid)]);
    return;
  }
  if (mainPid) { try { process.kill(mainPid, 'SIGTERM'); } catch { /* 已退出 */ } }
}

/** 轮询 switchProfile 直到锁释放（桌面被 kill 后 rename 才不再 EBUSY）。 */
async function waitForLockRelease() {
  const runtime = { profilesDir, home };
  const deadline = Date.now() + 60000;
  let attempts = 0;
  for (;;) {
    try {
      return await switchProfile(runtime, target, {
        swapSkills: true,
        allowDelegate: false,
        onProgress: (id, status) => { void setStep(home, id, status); },
      });
    } catch (err) {
      attempts++;
      if (attempts === 1 || attempts % 10 === 0) {
        await log(`retry #${attempts} code=${err?.code} msg=${err?.message}`);
      }
      if (!LOCK_CODES.includes(err?.code)) throw err;
      if (Date.now() > deadline) throw err;
      await sleep(300);
    }
  }
}

async function relaunch() {
  if (process.platform !== 'win32') return false;
  // 关键：不能把派生本 helper 的 ELECTRON_RUN_AS_NODE 漏给重新拉起的桌面，
  // 否则 electron 会被当成纯 node 跑、窗口起不来。
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  // 重启进程是 helper 的普通子进程（helper 自身已 detach 脱离 electron 树），Windows 下父进程
  // 正常退出不会杀子进程，所以绝不能再加 detached:true——它会打断 cmd.exe→pnpm.cmd→node 的
  // stdio 句柄继承，导致 pnpm 输出/执行丢失、桌面起不来。输出重定向到 relaunch.log 便于排查。
  async function launch(cmd, args, opts = {}) {
    const logPath = path.join(home, '.dsh-pack', 'relaunch.log');
    await fsp.mkdir(path.dirname(logPath), { recursive: true });
    const logFd = await fsp.open(logPath, 'a');
    const child = spawn(cmd, args, {
      ...opts,
      stdio: ['ignore', logFd.fd, logFd.fd],
      windowsHide: true,
      env,
    });
    child.unref();
    // 宽限 3s：cmd.exe→pnpm.cmd→tsx→electron 链需要时间真正建立；父进程此刻退出不杀子进程，
    // 但链尚未建立就退出会让重启中断，且 logFd 需等子进程继承完成后再关。
    await sleep(3000);
    await logFd.close().catch(() => {});
    return true;
  }

  if (relaunchCmd) {
    return await launch('cmd.exe', ['/d', '/s', '/c', relaunchCmd], { cwd: relaunchCwd || undefined });
  }
  const cmdline = await captureCommandLine(electronPid);
  if (cmdline) {
    return await launch(cmdline, [], { shell: true });
  }
  return false;
}

// relaunch 的 pnpm→tsx→electron 链要 ~15s 才真正把桌面拉起来；若只按 relaunch 的 3s 宽限就
// 标「完成」，进度窗口关了桌面却还没起来，用户得干等十几秒。这里轮询等客户端真正可用。
//
// 判据：探测 web-app 的 HTTP 端口（127.0.0.1:19387，harness desktop-host 写死 --port 19387）。
// 只判断「electron 主进程存在」是不够的——主进程 1~3s 就 spawn 出来，但此刻窗口还是白屏、
// web-app 还没监听端口，标 done 仍偏早。端口能连上才说明 host 已就绪、窗口开始渲染。
const CLIENT_PORT = 19387;
async function checkClientUp() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: CLIENT_PORT, path: '/', timeout: 1500 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function waitForDesktopReady() {
  if (process.platform !== 'win32') return;
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (await checkClientUp()) return;
    await sleep(500);
  }
}

async function main() {
  await log(`migrate start: target=${target} profiles=${profilesDir} electronPid=${electronPid} progressPid=${progressPid} relaunchCmd=${relaunchCmd} relaunchCwd=${relaunchCwd}`);
  await sleep(2000); // 宽限：让宿主把「migrating」响应 flush 给 UI，再动手杀
  await setStep(home, 'kill', 'running');
  await killElectronTree(electronPid);
  await setStep(home, 'kill', 'done');
  await log('electron tree killed, waiting for lock release');
  await sleep(300); // 让进度窗口看清「杀进程」完成
  const r = await waitForLockRelease(); // 内部 onProgress 写 move/link
  await log(`switch done: active=${r.active} method=${r.method}`);
  await setStep(home, 'launch', 'running');
  const ok = await relaunch();
  if (ok) await waitForDesktopReady();
  await setStep(home, 'launch', 'done');
  await setPhase(home, 'done');
  await log(`relaunch: ${ok ? 'spawned' : 'skipped'}`);
  process.exit(0);
}

main().catch(async (err) => {
  await setPhase(home, 'failed', err?.message ?? String(err));
  await log(`migrate FAILED: ${err?.stack ?? err}`);
  process.exit(1);
});
