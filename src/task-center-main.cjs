// 任务中心窗口（独立 Electron 进程）。
//
// 由 tasks.js 用 process.execPath 直接派生、不带 ELECTRON_RUN_AS_NODE，走 GUI：
// frameless + always-on-top 可关小窗；renderer 直读快照 JSON（nodeIntegration，无远程内容、无 IPC）。
// 小窗只是查看器：关掉不影响 host 继续跑任务；下次由 tasks/ensureWindow 重新派生。
// marker 记录自身 pid（host 据此判「窗口已开」）；快照里的 hostPid 反向判「host 还活着」，
// host 一死本窗口自动关（host 是任务执行体，死了任务也没了）。
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

function arg(name) {
  const prefix = `--${name}=`;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith(prefix)) return a.slice(prefix.length);
  }
  return null;
}

const tasksFile = arg('tasks-file');
const markerFile = arg('window-marker');

let win = null;

function writeMarker() {
  if (!markerFile) return;
  try { fs.writeFileSync(markerFile, String(process.pid)); } catch { /* 忽略 */ }
}

function clearMarker() {
  if (!markerFile) return;
  try { fs.unlinkSync(markerFile); } catch { /* 忽略 */ }
}

if (!tasksFile) {
  app.whenReady().then(() => app.quit());
} else {
  app.whenReady().then(() => {
    win = new BrowserWindow({
      width: 560,
      height: 480,
      minWidth: 420,
      minHeight: 320,
      frame: false,
      resizable: true,
      alwaysOnTop: true,
      skipTaskbar: false,
      show: false,
      backgroundColor: '#1e1f24',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
      },
    });
    win.loadFile(path.join(__dirname, 'task-center.html'), { query: { file: tasksFile } });
    win.once('ready-to-show', () => {
      if (win && !win.isDestroyed()) {
        win.show();
        writeMarker();
      }
    });
    win.on('closed', () => {
      clearMarker();
      win = null;
    });
  });
}

app.on('window-all-closed', () => app.quit());
