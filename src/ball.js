// 悬浮球：绕过设置页 / 侧边栏的**独立入口**。
//
// 为什么要有它：整合包会装进各种 client 插件，有的会把侧边栏或设置页搞坏，于是
// 用户根本进不去我们的设置界面 —— 连卸载/换包都做不到。所以入口不能再挂在 DSH
// 的 slot / React 树里（球由宿主注入 index.html，见 ball-host.js），必须是页面里
// 一块自己说了算的 DOM。
//
// 设计约束（前四条来自 DeepSeek-Balance-Whale-Widget 的实战结论）：
//   1) 不碰 slot / React：document.createElement + position:fixed 直接挂 body；
//   2) 定位一律用 left/top 像素 —— 写 right/bottom 时 auto 与数值之间 CSS 过渡无法插值，
//      贴边瞬间会闪现跳变；
//   3) 拖拽挂 document 级 pointer 监听（down 时挂、up/cancel 时摘），位移平方 ≥ 9（>3px）
//      才算拖动，否则当点击；
//   4) 松手只存「吸附边 + 离边偏移」，不存绝对坐标 —— 窗口 resize / 改尺寸时按锚点重算
//      仍贴边，未锚定轴才做视口钳制；
//   5) 对宿主皮肤按几何特征（position:fixed + 高 z-index）的拦截做 !important 外层防御，
//      并且 z-index 取得比生态里常见遮罩（2 万级）更高。
//
// 本文件上半部分是**纯函数**（导给 test/ball.test.js），下半部分 mountBall() 才碰 DOM。
// lib/ball.js 由 scripts/bundle-ball.mjs 打成浏览器 iife 供宿主路由下发。
// 注意：这里不 import 任何宿主侧东西（含 channel.js）—— 宿主模块 ball-host.js 也不需要
// import 本文件，否则整段 DOM 代码会被拖进 lib/host.js。
import { openSettingsPage, describeSettingsNav } from './ball-settings.js';

/** 球的边长（正方形，纯尺寸驱动 → 不需要量 DOM，无测量竞态）。 */
export const BALL_SIZE = 48;
/** 吸附区比例：中心落在 1/4 区内即贴该边（横纵两轴独立判定，可组合出四角）。 */
export const SNAP_RATIO = 0.25;
/** 点击阈值：位移平方 < 9（即 >3px 才算拖动）。 */
export const CLICK_SQ = 9;
/** 位置持久化键。 */
export const STORE_KEY = 'dspack-ball-pos';
/** 默认贴右下角时的离边距离。 */
export const DEFAULT_OFFSET = 24;

/* ------------------- 纯几何 ------------------- */

export function clamp(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return n < min ? min : n > max ? max : n;
}

/** 视口尺寸（纯函数形态便于测试；调用方传 win.innerWidth 之类）。 */
export function viewportOf(w, h) {
  return { w: Math.max(0, Number(w) || 0), h: Math.max(0, Number(h) || 0) };
}

/**
 * 吸附判定：判定点是**球心**。落在视口 1/4 区内 → 贴该边，否则该轴自由。
 * @returns {{h: 'left'|'right'|null, v: 'top'|'bottom'|null}}
 */
export function decideSnap(rect, vp) {
  const cx = (Number(rect?.left) || 0) + (Number(rect?.w) || 0) / 2;
  const cy = (Number(rect?.top) || 0) + (Number(rect?.h) || 0) / 2;
  let h = null;
  let v = null;
  if (cx < vp.w * SNAP_RATIO) h = 'left';
  else if (cx > vp.w * (1 - SNAP_RATIO)) h = 'right';
  if (cy < vp.h * SNAP_RATIO) v = 'top';
  else if (cy > vp.h * (1 - SNAP_RATIO)) v = 'bottom';
  return { h, v };
}

/**
 * 吸附结果 → 持久化锚点：贴边轴存「离该边距离」，自由轴存「离左/上边距离」。
 * 这样窗口尺寸变化时贴边轴仍贴边，自由轴只做钳制。
 */
export function anchorFrom(rect, vp, snap) {
  const left = Number(rect?.left) || 0;
  const top = Number(rect?.top) || 0;
  const w = Number(rect?.w) || 0;
  const h = Number(rect?.h) || 0;
  return {
    h: snap?.h ?? null,
    v: snap?.v ?? null,
    hOff: Math.max(0, snap?.h === 'right' ? vp.w - (left + w) : left),
    vOff: Math.max(0, snap?.v === 'bottom' ? vp.h - (top + h) : top),
  };
}

/** 锚点 → 绝对 left/top（按当前视口重算 + 钳制进可视区）。 */
export function positionFrom(anchor, size, vp) {
  const sw = Number(size?.w) || 0;
  const sh = Number(size?.h) || 0;
  const maxL = Math.max(0, vp.w - sw);
  const maxT = Math.max(0, vp.h - sh);
  const hOff = Math.max(0, Number(anchor?.hOff) || 0);
  const vOff = Math.max(0, Number(anchor?.vOff) || 0);
  const rawLeft = anchor?.h === 'right' ? vp.w - sw - hOff : hOff;
  const rawTop = anchor?.v === 'bottom' ? vp.h - sh - vOff : vOff;
  return {
    left: clamp(rawLeft, 0, maxL),
    top: clamp(rawTop, 0, maxT),
    hOff,
    vOff,
  };
}

/** 默认锚点：贴右下角，离边 DEFAULT_OFFSET。 */
export function defaultAnchor() {
  return { h: 'right', v: 'bottom', hOff: DEFAULT_OFFSET, vOff: DEFAULT_OFFSET };
}

const H_VALUES = new Set(['left', 'right']);
const V_VALUES = new Set(['top', 'bottom']);

/**
 * 解析持久化文本 → 锚点；坏 JSON / 结构非法 / 脏数据一律回落默认锚点。
 * 脏数据（负数、NaN、越界）在这里被夹成合法值 —— 对应坑：脏锚点会让球被算到视口外，
 * 「启动闪一下 → 滑出屏幕 → 消失」，且写回 localStorage 后刷新也恢复不了。
 */
export function normalizeStored(raw, vp = null) {
  let parsed = null;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return defaultAnchor();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaultAnchor();
  // 认不出任何字段（空对象 / 别的东西塞进同一个 key）也当没存过 —— 否则球会落到左上角
  if (!('h' in parsed) && !('v' in parsed) && !('hOff' in parsed) && !('vOff' in parsed)) return defaultAnchor();
  const h = H_VALUES.has(parsed.h) ? parsed.h : null;
  const v = V_VALUES.has(parsed.v) ? parsed.v : null;
  const hOff = Number.isFinite(Number(parsed.hOff)) ? Math.max(0, Number(parsed.hOff)) : DEFAULT_OFFSET;
  const vOff = Number.isFinite(Number(parsed.vOff)) ? Math.max(0, Number(parsed.vOff)) : DEFAULT_OFFSET;
  const anchor = { h, v, hOff, vOff };
  if (vp && vp.w > 0 && vp.h > 0) {
    // 视口变小后旧偏移可能把球推到界外：直接用 positionFrom 夹一次再折回锚点
    const pos = positionFrom(anchor, { w: BALL_SIZE, h: BALL_SIZE }, vp);
    return anchorFrom({ left: pos.left, top: pos.top, w: BALL_SIZE, h: BALL_SIZE }, vp, { h, v });
  }
  return anchor;
}

/** 锚点 → 持久化文本（只存四个字段，不存视口/尺寸）。 */
export function serializeAnchor(anchor) {
  return JSON.stringify({
    h: anchor?.h ?? null,
    v: anchor?.v ?? null,
    hOff: Math.max(0, Number(anchor?.hOff) || 0),
    vOff: Math.max(0, Number(anchor?.vOff) || 0),
  });
}

/* ------------------- DOM 部分 ------------------- */

/** 球的内联 SVG（无外部请求：整合包可能把静态资源路由也搞坏）。 */
const BALL_SVG = [
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"',
  ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">',
  '<path d="M3.5 6.5h17v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  '<path d="M3.5 6.5V5.2a1.7 1.7 0 0 1 1.7-1.7h4.4l1.6 2.2"/>',
  '<path d="M12 9.5v7"/>',
  '<path d="M10.4 11.1h3.2M10.4 13h3.2M10.4 14.9h3.2"/>',
  '</svg>',
].join('');

const BALL_CSS = [
  // 外层防御：宿主皮肤会按几何特征（position:fixed + 高 z-index）给元素套背景/边框/阴影/滤镜，
  // 关键属性全部 !important 顶回去（鲸鱼挂件 issue #133 的同类问题）。
  '#dspack-ball{position:fixed;box-sizing:border-box;width:48px;height:48px;border-radius:50%;',
  'display:flex;align-items:center;justify-content:center;cursor:grab;',
  'user-select:none;-webkit-user-select:none;touch-action:none;z-index:99999;color:#fff;',
  'background:linear-gradient(145deg,#4d6bfe,#203170) !important;',
  'border:2px solid rgba(255,255,255,.86) !important;',
  'box-shadow:0 6px 18px rgba(15,23,42,.34) !important;',
  'backdrop-filter:none !important;-webkit-backdrop-filter:none !important;',
  'transition:left .18s ease,top .18s ease,transform .18s ease}',
  '#dspack-ball::before,#dspack-ball::after{content:none !important}',
  '#dspack-ball.dspack-ball-dragging{cursor:grabbing;transition:none}',
  '#dspack-ball:active{transform:scale(.92)}',
  '#dspack-ball svg{width:26px;height:26px;display:block;pointer-events:none}',
  // 贴左时整体镜像（朝屏幕内），图标再反向镜像一次保持可读
  '#dspack-ball.dspack-ball-left{transform:scaleX(-1)}',
  '#dspack-ball.dspack-ball-left svg{transform:scaleX(-1)}',
  '#dspack-ball-tip{position:fixed;box-sizing:border-box;max-width:min(320px,calc(100vw - 24px));',
  'padding:8px 12px;border-radius:8px;background:rgba(15,23,42,.92);color:#fff;',
  'font:12px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;z-index:100000;pointer-events:none;',
  'box-shadow:0 6px 18px rgba(15,23,42,.3)}',
].join('');

function safeStorage(win, key) {
  try {
    const ls = win?.localStorage;
    if (!ls) return null;
    return {
      get: () => { try { return ls.getItem(key); } catch { return null; } },
      set: (v) => { try { ls.setItem(key, v); } catch { /* 隐私模式等，忽略 */ } },
    };
  } catch {
    return null;
  }
}

/**
 * 挂上悬浮球。幂等：同一 window 只挂一次（window.__dspackBall 同时充当对外 API 句柄）。
 * @param {object} [opts]
 * @param {Window} [opts.win] 注入 window（测试用）
 * @param {Document} [opts.doc]
 * @param {string} [opts.title] 悬停提示
 * @param {(api: object) => void} [opts.onClick] 点击回调（面板未做时默认弹提示）
 * @returns {object|null} API 句柄（root / state / showTip / destroy / click）
 */
export function mountBall(opts = {}) {
  const win = opts.win || (typeof window === 'undefined' ? null : window);
  const doc = opts.doc || (win && win.document) || null;
  if (!win || !doc) return null;
  // 幂等：已挂过就把既有句柄还回去（重复调用不该得到 null —— 调用方要拿它做后续接线）
  if (win.__dspackBall) return win.__dspackBall;
  const size = Number(opts.size) || BALL_SIZE;
  const store = safeStorage(win, opts.storeKey || STORE_KEY);
  const mount = () => {
    if (win.__dspackBall) return win.__dspackBall;
    const style = doc.createElement('style');
    style.id = 'dspack-ball-style';
    style.textContent = BALL_CSS;
    (doc.head || doc.documentElement).appendChild(style);

    const root = doc.createElement('div');
    root.id = 'dspack-ball';
    root.setAttribute('role', 'button');
    root.setAttribute('tabindex', '0');
    root.setAttribute('title', opts.title || '打开设置 · DSH PackForge');
    root.innerHTML = BALL_SVG;

    const state = normalizeStored(store ? store.get() : null);
    let drag = null;
    let tip = null;
    let tipTimer = 0;
    /** 可被客户端插件替换的点击动作（默认：打开官方设置页）。 */
    let action = null;

    const viewport = () => viewportOf(win.innerWidth || doc.documentElement.clientWidth, win.innerHeight || doc.documentElement.clientHeight);

    // 先算好首帧位置再入场：避免「先渲染在右下角 → 再跳到记忆位置」的闪动。
    const initial = positionFrom(state, { w: size, h: size }, viewport());
    state.hOff = initial.hOff;
    state.vOff = initial.vOff;
    root.style.left = `${initial.left}px`;
    root.style.top = `${initial.top}px`;

    function express() {
      root.style.left = `${state.left}px`;
      root.style.top = `${state.top}px`;
      root.classList.toggle('dspack-ball-left', state.h === 'left');
    }

    function settle() {
      const vp = viewport();
      const pos = positionFrom(state, { w: size, h: size }, vp);
      state.left = pos.left;
      state.top = pos.top;
      state.hOff = pos.hOff;
      state.vOff = pos.vOff;
      express();
    }

    function save() {
      if (store) store.set(serializeAnchor(state));
    }

    function showTip(text) {
      const vp = viewport();
      if (tip) { try { tip.remove(); } catch { /* 忽略 */ } }
      tip = doc.createElement('div');
      tip.id = 'dspack-ball-tip';
      tip.textContent = text;
      doc.body.appendChild(tip);
      const below = state.top + size + 8 + 40 < vp.h;
      tip.style.left = `${clamp(state.left - 40, 8, Math.max(8, vp.w - 200))}px`;
      tip.style.top = `${below ? state.top + size + 8 : Math.max(8, state.top - 44)}px`;
      if (tipTimer) win.clearTimeout(tipTimer);
      tipTimer = win.setTimeout(() => {
        if (tip) { try { tip.remove(); } catch { /* 忽略 */ } }
        tip = null;
      }, 2600);
    }

    /** 切分区失败时的提示：把「我看到的导航」一并说出来，省得靠猜（截图就能定位）。 */
    function focusFailTip() {
      const info = describeSettingsNav(doc, win);
      try { console.info('[dspack] 悬浮球切分区失败，诊断：', info); } catch { /* 忽略 */ }
      const label = info.ownLabel || '整合包';
      const rows = info.rows.join(' / ') || '（没读到导航）';
      return `设置已打开，请在左侧选「${label}」；我看到的导航：${rows}`;
    }

    /** 默认动作：打开官方设置页（复用原页面，不自己造一个）。 */
    function openSettings() {
      const result = openSettingsPage(doc, {
        win,
        // 轮询校验没通过（没弹出设置弹窗）才提示：点错/被拦/真的没有入口，都算失败。
        onFail: () => showTip(opts.noTriggerTip || '没找到官方设置入口：侧边栏/设置那棵可能已不可用'),
        // 弹窗开了但没切过去：明确指路，别把人晾在别人的分区上。
        onFocusFail: () => showTip(opts.focusFailTip || focusFailTip()),
      });
      if (result === 'no-trigger') {
        showTip(opts.noTriggerTip || '没找到官方设置入口：侧边栏/设置那棵可能已不可用');
      }
      return result;
    }

    function fireClick() {
      try { win.dispatchEvent(new win.CustomEvent('dspack/ball-click', { detail: { api } })); } catch { /* 忽略 */ }
      const run = typeof opts.onClick === 'function' ? opts.onClick : action;
      if (typeof run === 'function') {
        try { run(api); } catch { /* 回调异常不影响球本身 */ }
        return;
      }
      openSettings();
    }

    function onMove(e) {
      if (!drag) return;
      const dx = (Number(e.clientX) || 0) - drag.startX;
      const dy = (Number(e.clientY) || 0) - drag.startY;
      if (dx * dx + dy * dy >= CLICK_SQ) drag.moved = true;
      const vp = viewport();
      state.left = clamp(drag.origLeft + dx, 0, Math.max(0, vp.w - size));
      state.top = clamp(drag.origTop + dy, 0, Math.max(0, vp.h - size));
      express();
    }

    function detach() {
      doc.removeEventListener('pointermove', onMove, true);
      doc.removeEventListener('pointerup', onUp, true);
      doc.removeEventListener('pointercancel', onCancel, true);
    }

    function end(clickable) {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      root.classList.remove('dspack-ball-dragging');
      detach();
      const vp = viewport();
      const rect = { left: state.left, top: state.top, w: size, h: size };
      Object.assign(state, anchorFrom(rect, vp, decideSnap(rect, vp)));
      settle();
      save();
      if (clickable && !moved) fireClick();
    }

    function onUp() { end(true); }
    function onCancel() { end(false); }

    function onDown(e) {
      if (drag) return;
      if (e?.pointerType === 'mouse' && e.button !== 0) return;
      drag = { startX: Number(e.clientX) || 0, startY: Number(e.clientY) || 0, origLeft: state.left, origTop: state.top, moved: false };
      root.classList.add('dspack-ball-dragging');
      try { e.preventDefault(); e.stopPropagation(); } catch { /* 忽略 */ }
      doc.addEventListener('pointermove', onMove, true);
      doc.addEventListener('pointerup', onUp, true);
      doc.addEventListener('pointercancel', onCancel, true);
    }

    function onKeyDown(e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      try { e.preventDefault(); } catch { /* 忽略 */ }
      fireClick();
    }

    const onResize = () => settle();

    root.addEventListener('pointerdown', onDown);
    root.addEventListener('keydown', onKeyDown);
    // 球的 click 不往下穿（整合包里下层元素常挂 click 处理器）
    root.addEventListener('click', (e) => { try { e.stopPropagation(); } catch { /* 忽略 */ } });
    win.addEventListener('resize', onResize);

    doc.body.appendChild(root);
    settle();
    save();

    const api = {
      root,
      state,
      size,
      showTip,
      click: fireClick,
      openSettings,
      setAction(fn) {
        action = typeof fn === 'function' ? fn : null;
        return api;
      },
      settle,
      viewport,
      /** 诊断：设置导航长什么样、钩子/标记在不在（排查「点了没切过去」时用）。 */
      diag: () => describeSettingsNav(doc, win),
      destroy() {
        win.removeEventListener('resize', onResize);
        detach();
        if (tipTimer) win.clearTimeout(tipTimer);
        try { root.remove(); } catch { /* 忽略 */ }
        try { style.remove(); } catch { /* 忽略 */ }
        win.__dspackBall = null;
      },
    };
    return api;
  };

  const body = doc.body;
  if (!body) {
    // 极早期注入（脚本在 head 里）时等 DOM 就绪再挂：先占位防重复接管，挂前必须清掉占位，
    // 否则 mount() 的幂等守卫会把自己挡回去。
    doc.addEventListener('DOMContentLoaded', () => {
      win.__dspackBall = null;
      win.__dspackBall = mount();
    }, { once: true });
    win.__dspackBall = { pending: true };
    return win.__dspackBall;
  }
  const api = mount();
  if (api) win.__dspackBall = api;
  return api;
}
