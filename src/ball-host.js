// 宿主的悬浮球接线：①把球脚本注入页面 ②给路由模块提供脚本字节。
//
// 为什么球必须由**宿主**注入，而不是挂在我们的 client 插件里：
//   整合包会装进一堆 client 插件，有的会把侧边栏/设置页搞坏 —— 那时用户进不去设置界面，
//   连换包、卸载都做不到。宿主活在 Node 进程里，注入 index.html 这条路不经过 DSH 的任何
//   前端插件，所以「别人把 UI 拆了，球还在」。这也正是鲸鱼挂件（DeepSeek-Balance-Whale-Widget）
//   的结论：动态 cordis 插件页面一刷新就没了，要常驻自启必须静态挂进组合。
//
// 注入走两条通道，靠 BALL_INJECT_MARK 互相去重：
//   ① 结构化行 `webserver/index-inject`：web 形态由 renderIndexInjections 渲染进 index.html；
//      桌面壳 index.html 从静态 dist 直出、函数变换过不去，靠 IPC 把这张行表交给页面解释器
//      —— 所以它是**桌面端唯一生效**的通道，且必须在宿主启动收集那次就注册上。
//   ② `webServer.tapIndex` 函数变换：web 形态兜底。
//
// 行内容用内联 script（而不是 kind:'script-src'）：官方页面解释器对两类行处理不对称 ——
//   kind:'script'     → createElement + textContent + append，没有 await，不可能"加载失败"；
//   kind:'script-src' → await loadScript(src)，失败即 reject，会炸成致命错误
//                       「failed to load /dsh-pack/ball.js」把整个页面带下水。
// 所以自己建 <script src> 并吞掉 onerror：路由在就正常加载，不在也只是没有球，页面无恙。
import { readFile } from 'node:fs/promises';
import { CHANNEL } from './channel.js';

/** 球脚本的下载路径（同 prefix 路由下发，见 rpc.js 的 GET 分支）。 */
export const BALL_SCRIPT_PATH = `${CHANNEL}/ball.js`;
/** 注入标记：用路径判断「是否已注入过」，让结构化行与 tapIndex 两条通道互相去重。 */
export const BALL_INJECT_MARK = BALL_SCRIPT_PATH;

/** 内联 loader（一行，注入进 index.html）。 */
export const BALL_INLINE_LOADER = [
  '(function(){try{',
  'if(window.__dspackBall)return;',
  'var s=document.createElement("script");',
  `s.src=${JSON.stringify(BALL_SCRIPT_PATH)};`,
  's.async=true;s.onerror=function(){};',
  '(document.body||document.documentElement).appendChild(s);',
  '}catch(e){}})();',
].join('');

/** 结构化注入行：已存在等价行 / 已注入标记则不动（返回是否真的推了）。 */
export function ensureBallRow(table) {
  if (!Array.isArray(table)) return false;
  const exists = table.some((row) => {
    if (!row || typeof row !== 'object') return false;
    if (row.kind === 'script' && typeof row.text === 'string' && row.text.includes(BALL_INJECT_MARK)) return true;
    if (row.kind === 'script-src' && row.src === BALL_SCRIPT_PATH) return true;
    return false;
  });
  if (exists) return false;
  table.push({ kind: 'script', placement: 'body', text: BALL_INLINE_LOADER });
  return true;
}

/** tapIndex 变换：把 script 标签插到 </body> 前；已有标记则原样返回（幂等）。 */
export function injectBallIntoHtml(html) {
  if (typeof html !== 'string' || html.includes(BALL_INJECT_MARK)) return html;
  const tag = `<script defer src="${BALL_SCRIPT_PATH}"></script>`;
  const at = html.lastIndexOf('</body>');
  return at < 0 ? `${html}${tag}` : `${html.slice(0, at)}${tag}${html.slice(at)}`;
}

/** 球脚本产物路径：dev（src/）与打包态（lib/host.js）都解析到 <包根>/lib/ball.js。 */
const BALL_LIB_URL = new URL('../lib/ball.js', import.meta.url);

/**
 * 读球脚本字节。未构建（无 lib/ball.js）时返回 null，由路由层回 404 —— 不能让缺文件
 * 变成抛错（路由 handler 抛错会变成 400 空响应，页面侧完全没法诊断）。
 */
export async function readBallAsset() {
  try {
    const bytes = await readFile(BALL_LIB_URL);
    return bytes?.length ? { bytes } : null;
  } catch {
    return null;
  }
}

/**
 * 接线：注册注入通道。ctx.effect 收尾，HMR 重载时自动摘干净（否则重复注入）。
 * @returns {boolean} 是否挂上（webServer 不可用时 false）
 */
export function registerBall(ctx, { log } = {}) {
  const ws = ctx?.webServer;
  if (!ws) return false;
  const say = typeof log === 'function' ? log : () => {};

  // ① 结构化行：桌面端唯一生效通道 —— 监听器要在宿主启动收集前就在位。
  ctx.effect(() => {
    const off = ctx.on('webserver/index-inject', (table) => {
      if (ensureBallRow(table)) say(`悬浮球：已推注入行（${BALL_SCRIPT_PATH}）`);
    });
    return () => { try { off?.(); } catch { /* 忽略 */ } };
  }, 'dspack: ball index-inject');

  // ② tapIndex：web 形态兜底（按标记去重，与 ① 不冲突）。
  if (typeof ws.tapIndex === 'function') {
    ctx.effect(() => ws.tapIndex((html) => injectBallIntoHtml(html)), 'dspack: ball tapIndex');
  }
  return true;
}
