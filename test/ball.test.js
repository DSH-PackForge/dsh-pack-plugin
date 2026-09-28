// 悬浮球测试：纯几何 + 持久化解析 + 注入行去重 + 路由下发 + 幂等挂载（假 DOM）。
//
// 球是「整合包把侧边栏/设置页搞坏时的救命入口」，所以这里重点钉三件事：
//   ① 吸附/锚点数学不能漂（resize 后仍贴边、脏数据不会把球算到视口外）；
//   ② 注入必须幂等（结构化行 + tapIndex 两条通道并存，重复注入会让页面挂两个球）；
//   ③ 脚本必须能真下发（路由分支 + 产物存在）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp, decideSnap, anchorFrom, positionFrom, defaultAnchor,
  normalizeStored, serializeAnchor, viewportOf, mountBall,
  BALL_SIZE, DEFAULT_OFFSET, STORE_KEY,
} from '../src/ball.js';
import {
  ensureBallRow, injectBallIntoHtml, readBallAsset, registerBall, BALL_INLINE_LOADER, BALL_SCRIPT_PATH,
} from '../src/ball-host.js';
import { registerRpc } from '../src/rpc.js';
import { CHANNEL } from '../src/channel.js';

/* ------------------- 假 DOM（只覆盖 mountBall 用到的面） ------------------- */

function fakeEl(tag) {
  const el = {
    tagName: tag,
    parentNode: null,
    children: [],
    style: {},
    attrs: {},
    textContent: '',
    _html: '',
    _cls: new Set(),
    _ev: {},
  };
  el.classList = {
    add: (c) => el._cls.add(c),
    remove: (c) => el._cls.delete(c),
    contains: (c) => el._cls.has(c),
    toggle: (c, on) => {
      if (on === undefined) { if (el._cls.has(c)) el._cls.delete(c); else el._cls.add(c); }
      else if (on) el._cls.add(c);
      else el._cls.delete(c);
    },
  };
  el.setAttribute = (k, v) => { el.attrs[k] = v; };
  el.appendChild = (c) => { el.children.push(c); c.parentNode = el; return c; };
  el.addEventListener = (t, fn) => { (el._ev[t] ??= []).push(fn); };
  el.removeEventListener = (t, fn) => { el._ev[t] = (el._ev[t] ?? []).filter((f) => f !== fn); };
  el.remove = () => {
    if (el.parentNode) el.parentNode.children = el.parentNode.children.filter((x) => x !== el);
  };
  Object.defineProperty(el, 'innerHTML', {
    get: () => el._html,
    set: (v) => { el._html = v; },
  });
  return el;
}

function fakeWin({ width = 1280, height = 800, stored = null } = {}) {
  const doc = {
    head: fakeEl('head'),
    body: fakeEl('body'),
    documentElement: fakeEl('html'),
    createElement: (tag) => fakeEl(tag),
    _ev: {},
    addEventListener(t, fn) { (doc._ev[t] ??= []).push(fn); },
    removeEventListener(t, fn) { doc._ev[t] = (doc._ev[t] ?? []).filter((f) => f !== fn); },
  };
  const store = {};
  if (stored !== null) store[STORE_KEY] = stored;
  const win = {
    document: doc,
    innerWidth: width,
    innerHeight: height,
    _store: store,
    _winEv: {},
    setTimeout: () => 1,
    clearTimeout: () => {},
    addEventListener(t, fn) { (win._winEv[t] ??= []).push(fn); },
    removeEventListener(t, fn) { win._winEv[t] = (win._winEv[t] ?? []).filter((f) => f !== fn); },
    CustomEvent: class { constructor(type, opts) { this.type = type; this.detail = opts?.detail; } },
    dispatchEvent: () => true,
  };
  Object.defineProperty(win, 'localStorage', {
    value: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    },
  });
  return win;
}

/* ------------------- 纯几何 ------------------- */

test('clamp：区间内原样，越界夹到端点，非数值回落下界', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-3, 0, 10), 0);
  assert.equal(clamp(99, 0, 10), 10);
  assert.equal(clamp(NaN, 7, 10), 7);
  assert.equal(clamp('abc', 7, 10), 7);
  assert.equal(clamp(Infinity, 0, 10), 0); // 非有限值按「坏数据」处理
});

test('decideSnap：四边四角 + 中心自由，判定点用球心', () => {
  const vp = viewportOf(1000, 600); // 1/4 区：x<250 / x>750，y<150 / y>450
  const at = (left, top) => decideSnap({ left, top, w: BALL_SIZE, h: BALL_SIZE }, vp);
  assert.deepEqual(at(0, 0), { h: 'left', v: 'top' });       // 左上角
  assert.deepEqual(at(1000, 600), { h: 'right', v: 'bottom' }); // 右下角（越界也按中心判）
  assert.deepEqual(at(400, 0), { h: null, v: 'top' });       // 只贴上边
  assert.deepEqual(at(0, 260), { h: 'left', v: null });      // 只贴左边
  assert.deepEqual(at(470, 270), { h: null, v: null });      // 正中间：两轴都自由
  // 边界：中心正好落在 1/4 线上 → 不算吸附（严格小于 / 大于）
  const edge = decideSnap({ left: 250 - BALL_SIZE / 2, top: 270, w: BALL_SIZE, h: BALL_SIZE }, vp);
  assert.equal(edge.h, null);
});

test('锚点往返：任意位置 → 锚点 → 回算位置，吸附边一致且不漂', () => {
  const vp = viewportOf(1000, 600);
  for (const [left, top] of [[0, 0], [952, 552], [0, 552], [952, 0], [400, 300]]) {
    const rect = { left, top, w: BALL_SIZE, h: BALL_SIZE };
    const snap = decideSnap(rect, vp);
    const anchor = anchorFrom(rect, vp, snap);
    const pos = positionFrom(anchor, { w: BALL_SIZE, h: BALL_SIZE }, vp);
    assert.equal(pos.left, left, `left 漂了：${left} → ${pos.left}`);
    assert.equal(pos.top, top, `top 漂了：${top} → ${pos.top}`);
    // 再吸附一次必须还是同一边（否则松手会来回抖）
    assert.deepEqual(decideSnap({ left: pos.left, top: pos.top, w: BALL_SIZE, h: BALL_SIZE }, vp), snap);
  }
});

test('positionFrom：贴边轴随视口重算仍贴边，自由轴只钳制', () => {
  const anchor = { h: 'right', v: 'bottom', hOff: 24, vOff: 24 };
  const big = positionFrom(anchor, { w: BALL_SIZE, h: BALL_SIZE }, viewportOf(1000, 600));
  assert.deepEqual([big.left, big.top], [1000 - 48 - 24, 600 - 48 - 24]);
  // 视口缩到比球还小 → 夹到 0，不出现负坐标
  const tiny = positionFrom(anchor, { w: BALL_SIZE, h: BALL_SIZE }, viewportOf(20, 20));
  assert.deepEqual([tiny.left, tiny.top], [0, 0]);
  // 自由轴：存的就是左上偏移，视口变大后不跟着跑
  const free = positionFrom({ h: null, v: null, hOff: 100, vOff: 80 }, { w: BALL_SIZE, h: BALL_SIZE }, viewportOf(2000, 1200));
  assert.deepEqual([free.left, free.top], [100, 80]);
});

test('normalizeStored：坏 JSON / 结构非法 / 脏数据一律回落或夹正', () => {
  assert.deepEqual(normalizeStored('not json'), defaultAnchor());
  assert.deepEqual(normalizeStored(null), defaultAnchor());
  assert.deepEqual(normalizeStored('[]'), defaultAnchor());
  assert.deepEqual(normalizeStored('{"h":"weird","v":"bottom","hOff":-50,"vOff":"x"}'),
    { h: null, v: 'bottom', hOff: 0, vOff: DEFAULT_OFFSET });
  // 带视口：旧偏移超出了缩小后的视口 → 夹回可视区（对应「启动闪一下 → 滑出屏幕 → 消失」）
  const fixed = normalizeStored(JSON.stringify({ h: 'left', v: 'top', hOff: 5000, vOff: 4000 }), viewportOf(400, 300));
  const pos = positionFrom(fixed, { w: BALL_SIZE, h: BALL_SIZE }, viewportOf(400, 300));
  assert.equal(pos.left, 400 - BALL_SIZE);
  assert.equal(pos.top, 300 - BALL_SIZE);
  assert.equal(fixed.h, 'left');
  assert.equal(fixed.v, 'top');
});

test('serializeAnchor ↔ normalizeStored 往返稳定（只存四个字段）', () => {
  const a = { h: 'left', v: 'bottom', hOff: 33, vOff: 44, left: 999, top: 999 };
  assert.equal(serializeAnchor(a), '{"h":"left","v":"bottom","hOff":33,"vOff":44}');
  assert.deepEqual(normalizeStored(serializeAnchor(a)), { h: 'left', v: 'bottom', hOff: 33, vOff: 44 });
});

/* ------------------- 挂载（假 DOM） ------------------- */

test('mountBall：幂等（重复挂载只有一个球）+ 恢复记忆位置 + 贴边类', () => {
  const win = fakeWin({ stored: JSON.stringify({ h: 'left', v: 'top', hOff: 40, vOff: 60 }) });
  const first = mountBall({ win });
  assert.ok(first, '首次应挂载成功');
  const second = mountBall({ win });
  assert.equal(second, first, '重复挂载应返回同一句柄');
  const roots = win.document.body.children.filter((el) => el.id === 'dspack-ball');
  assert.equal(roots.length, 1, '页面上只能有一个球');
  assert.equal(win.document.head.children.filter((el) => el.id === 'dspack-ball-style').length, 1);
  // 记忆位置：贴左上、离边 40/60
  assert.equal(first.state.left, 40);
  assert.equal(first.state.top, 60);
  assert.equal(first.state.h, 'left');
  // 贴左 → 镜像类（图标再反镜像一次）
  assert.ok(roots[0].classList.contains('dspack-ball-left'));
  // 刻意不依赖 DOM 测量：位置纯由尺寸算出
  assert.equal(BALL_SIZE, 48);
});

test('mountBall：默认贴右下角；视口变小后 settle 仍在可视区内', () => {
  const win = fakeWin();
  const api = mountBall({ win });
  assert.equal(api.state.left, 1280 - BALL_SIZE - DEFAULT_OFFSET);
  assert.equal(api.state.top, 800 - BALL_SIZE - DEFAULT_OFFSET);
  win.innerWidth = 300;
  win.innerHeight = 200;
  api.settle();
  assert.ok(api.state.left >= 0 && api.state.left <= 300 - BALL_SIZE);
  assert.ok(api.state.top >= 0 && api.state.top <= 200 - BALL_SIZE);
  // 位置已落盘（只存锚点四字段）
  const saved = JSON.parse(win._store[STORE_KEY]);
  assert.deepEqual(Object.keys(saved).sort(), ['h', 'hOff', 'v', 'vOff']);
});

test('mountBall：destroy 后句柄释放，可再次挂载', () => {
  const win = fakeWin();
  const api = mountBall({ win });
  api.destroy();
  assert.equal(win.document.body.children.filter((el) => el.id === 'dspack-ball').length, 0);
  assert.equal(win.__dspackBall, null);
  const again = mountBall({ win });
  assert.ok(again && again !== api);
});

/* ------------------- 注入（宿主侧） ------------------- */

test('ensureBallRow：推一次，之后去重；script-src 行也算已注入', () => {
  const table = [];
  assert.equal(ensureBallRow(table), true);
  assert.equal(table.length, 1);
  assert.equal(table[0].kind, 'script');
  assert.equal(table[0].placement, 'body');
  assert.ok(table[0].text.includes(BALL_SCRIPT_PATH));
  // 第二次不重复推
  assert.equal(ensureBallRow(table), false);
  assert.equal(table.length, 1);
  // 别的插件推过等价 script-src 行 → 也不重复
  const other = [{ kind: 'script-src', src: BALL_SCRIPT_PATH }];
  assert.equal(ensureBallRow(other), false);
  // 无关行不影响
  assert.equal(ensureBallRow([{ kind: 'script', text: 'void 0' }]), true);
  assert.equal(ensureBallRow(null), false);
});

test('内联 loader：自带 src、吞掉 onerror、重复加载有守卫', () => {
  assert.ok(BALL_INLINE_LOADER.includes(JSON.stringify(BALL_SCRIPT_PATH)));
  assert.ok(BALL_INLINE_LOADER.includes('onerror'));
  assert.ok(BALL_INLINE_LOADER.includes('__dspackBall'));
  assert.ok(!BALL_INLINE_LOADER.includes('import '), '注入的是内联脚本，不能带 ESM import');
});

test('injectBallIntoHtml：插到 </body> 前且幂等', () => {
  const html = '<html><body><div>x</div></body></html>';
  const out = injectBallIntoHtml(html);
  assert.ok(out.indexOf(BALL_SCRIPT_PATH) > 0);
  assert.ok(out.indexOf(BALL_SCRIPT_PATH) < out.indexOf('</body>'));
  assert.equal(injectBallIntoHtml(out), out, '已注入的 HTML 不应二次注入');
  // 没有 </body> 时追加在后
  const noBody = injectBallIntoHtml('<div>x</div>');
  assert.ok(noBody.endsWith('</script>'));
});

test('registerBall：监听注入表并按标记去重（web 形态两条通道不打架）', () => {
  const listeners = [];
  const ctx = {
    connection: { requestRejection: () => null },
    webServer: { register: () => () => {}, tapIndex: () => () => {} },
    on: (name, fn) => { listeners.push({ name, fn }); return () => {}; },
    effect: (fn) => { fn?.(); },
  };
  assert.equal(registerBall(ctx), true);
  assert.equal(registerBall({}), false, 'webServer 不可用时应安静返回 false');
  const table = [];
  for (const l of listeners) if (l.name === 'webserver/index-inject') l.fn(table);
  assert.equal(table.length, 1);
  // 再来一轮（HMR / 重复收集）不新增
  for (const l of listeners) if (l.name === 'webserver/index-inject') l.fn(table);
  assert.equal(table.length, 1);
});

/* ------------------- 路由下发 ------------------- */

function fakeRes() {
  const res = {
    status: 0,
    headers: null,
    body: null,
    writeHead(status, headers) { res.status = status; res.headers = headers; },
    end(body) { res.body = body; },
  };
  return res;
}

test('路由：GET /dsh-pack/ball.js 下发脚本；其它 GET 405；POST RPC 不受影响', async () => {
  const asset = await readBallAsset();
  assert.ok(asset?.bytes?.length, 'lib/ball.js 缺失：请先运行 npm run bundle');

  const routes = [];
  const ctx = {
    connection: { requestRejection: () => null },
    webServer: { register: (r) => { routes.push(r); return () => {}; } },
    effect: (fn) => { fn?.(); },
  };
  registerRpc(ctx, { home: '/tmp', profileName: 'web' });
  assert.equal(routes.length, 1);

  const get = (url, method = 'GET') => {
    const res = fakeRes();
    const req = { method, url, on: (t, fn) => { if (t === 'end') fn(); }, destroy: () => {} };
    return routes[0].handler(req, res).then(() => res);
  };

  const ok = await get(BALL_SCRIPT_PATH);
  assert.equal(ok.status, 200);
  assert.match(ok.headers['content-type'], /javascript/);
  assert.equal(ok.headers['cache-control'], 'no-store');
  assert.ok(String(ok.body).includes('dspackBall'), '下发的应该是打包后的球脚本');

  const notFound = await get(`${CHANNEL}/nothing.js`);
  assert.equal(notFound.status, 405);

  // POST 走原有 RPC 分支（未知端点 → ok:false + no-such-endpoint，而不是 405）
  const res = fakeRes();
  const body = JSON.stringify({ type: 'client-request', method: 'nope/nope', rpcId: 'r1', payload: {} });
  const req = {
    method: 'POST',
    url: `${CHANNEL}/nope/nope`,
    on: (t, fn) => { if (t === 'data') fn(Buffer.from(body)); if (t === 'end') fn(); },
    destroy: () => {},
  };
  await routes[0].handler(req, res);
  assert.equal(res.status, 200);
  const parsed = JSON.parse(res.body);
  assert.equal(parsed.result.ok, false);
  assert.equal(parsed.result.error.code, 'no-such-endpoint');
});
