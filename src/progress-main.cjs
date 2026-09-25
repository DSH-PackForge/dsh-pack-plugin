// 切换进度窗口（方案 A 执行体）。
//
// 由 progress.js 用 process.execPath 直接派生、不带 ELECTRON_RUN_AS_NODE，走 GUI：
// frameless + always-on-top 小窗，主进程轮询 progress.json，phase=done/failed 时自动关闭。
// 渲染在 progress.html（renderer 直读 progress.json，走 nodeIntegration，无远程内容、无需 IPC）。
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const progressFile = (() => {
  for (const a of process.argv.slice(2)) {
    const m = /^--progress-file=(.*)$/.exec(a);
    if (m) return m[1];
  }
  return null;
})();

let win = null;
let closed = false;

function closeAfter(ms) {
  if (closed) return;
  closed = true;
  setTimeout(() => {
    if (win && !win.isDestroyed()) win.close();
  }, ms);
}

function tick() {
  if (!win || win.isDestroyed()) return;
  let raw = null;
  try {
    raw = fs.readFileSync(progressFile, 'utf8');
  } catch { /* 尚未写入 */ }
  if (!raw) return;
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch { return; /* 半截写，等下一帧 */ }
  if (data.phase === 'done') closeAfter(1200);
  else if (data.phase === 'failed') closeAfter(2500);
}

if (!progressFile) {
  app.whenReady().then(() => app.quit());
} else {
  app.whenReady().then(() => {
    win = new BrowserWindow({
      width: 420,
      height: 380,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      backgroundColor: '#1e1f24',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
      },
    });
    win.loadFile(path.join(__dirname, 'progress.html'), { query: { file: progressFile } });
    win.once('ready-to-show', () => {
      if (win && !win.isDestroyed()) win.show();
    });
    const timer = setInterval(tick, 200);
    win.on('closed', () => {
      clearInterval(timer);
      win = null;
    });
    // 兜底：60s 无论如何都关（helper 若中途崩掉，窗口不能赖在屏幕上）。
    setTimeout(() => {
      if (win && !win.isDestroyed()) win.close();
    }, 60000);
  });
}

app.on('window-all-closed', () => app.quit());
