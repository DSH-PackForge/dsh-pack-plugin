import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { Fragment } from 'react';
import { registerSettingsSection, DspackSection } from '../src/settings.js';
import { PROFILE_NAME_RE, RESERVED_PROFILE_NAMES } from '../src/channel.js';

/** mock DSH client slots 服务。
 *  `inject` 模拟 DSH 真实行为：slot 声明就绪时 reconcile 立即执行回调（触发闸门
 *  available → register）。`register` 记录实参并返回 disposer。 */
function makeSlots() {
  const injected = {};
  const registered = [];
  return {
    injected,
    registered,
    inject(name, factory) {
      injected[name] = factory;
      factory();
    },
    register(options, Component) {
      registered.push({ options, Component });
      return () => {};
    },
  };
}

/** mock DSH client locale 服务（bind 按 zh 词典取值）。 */
function makeLocale() {
  const state = { dict: null };
  return {
    state,
    register(ns, dict) { state.dict = dict; return () => {}; },
    bind(ns) { return (key) => state.dict?.zh?.[key] ?? key; },
  };
}

test('registerSettingsSection：注册 settings.section（id/order/label + React 组件）', () => {
  const slots = makeSlots();
  const locale = makeLocale();
  const ctx = { slots, locale, effect: (fn) => fn() };
  const packforge = { api: { shell: () => {} }, capabilities: {}, host: null };

  assert.equal(registerSettingsSection(ctx, packforge), true);

  const factory = slots.injected['settings.section'];
  assert.equal(typeof factory, 'function');

  // 闸门幂等：inject 回调被重复触发（重载时 slot 重新声明）也不应二次 register。
  factory();
  factory();
  assert.equal(slots.registered.length, 1);

  const { options, Component } = slots.registered[0];
  assert.equal(options.name, 'settings.section');
  assert.equal(options.id, 'dspack');
  assert.equal(options.order, 20);
  assert.equal(typeof options.label, 'function');
  assert.equal(options.label(), '整合包');           // zh
  assert.equal(typeof options.inject, 'function');
  const injected = options.inject();
  assert.equal(typeof injected.t, 'function');
  assert.equal(injected.packforge, packforge);
  assert.equal(Component, DspackSection);
  assert.equal(typeof Component, 'function');
});

test('registerSettingsSection：无 slots / locale 时静默降级返回 false', () => {
  assert.equal(registerSettingsSection({}, {}), false);
  assert.equal(registerSettingsSection({ slots: makeSlots() }, {}), false);              // 缺 locale
  assert.equal(registerSettingsSection({ locale: makeLocale() }, {}), false);            // 缺 slots
  assert.doesNotThrow(() => registerSettingsSection({ slots: { inject() {} }, locale: { register() {}, bind() {} } }, {}));
});

test('registerSettingsSection：无 ctx.effect 时仍能注册', () => {
  const slots = makeSlots();
  const locale = makeLocale();
  const ctx = { slots, locale }; // 无 effect
  assert.equal(registerSettingsSection(ctx, { api: {}, capabilities: {}, host: null }), true);
  assert.equal(typeof slots.injected['settings.section'], 'function');
  assert.equal(slots.registered.length, 1);
});

// 基线已取消离线包：原有用例没有覆盖这块文案，这里补上「这些键已不存在」的断言
// （dict 经 locale.register 落进 mock，检查的就是 UI 真正会显示的那份词表）。
test('i18n 字典：基线取消离线包后不再注册内嵌依赖文案，兼容性徽标文案保留', () => {
  const slots = makeSlots();
  const locale = makeLocale();
  registerSettingsSection({ slots, locale, effect: (fn) => fn() }, {});
  const { zh, en } = locale.state.dict;

  for (const [name, d] of [['zh', zh], ['en', en]]) {
    const stale = Object.keys(d).filter((k) => k === 'vendor' || k.startsWith('vendor.'));
    assert.deepEqual(stale, [], `${name} 仍注册了内嵌依赖键：${stale.join(', ')}`);
    assert.equal('market.r2.vendored' in d, false, `${name} 仍保留内嵌依赖徽标文案`);
    assert.equal(typeof d['market.r2.none'], 'string', `${name} 缺徽标兜底文案`);
    assert.equal(/内嵌|vendored/.test(d['market.r2.none']), false, `${name} 徽标兜底文案仍暗示内嵌依赖`);
  }

  // 正向对照：launchers / dshVersions 徽标文案必须原样保留（否则上面的断言可能恒真）
  assert.equal(zh['market.r2.launcherRequire'], '需启动器 {id} ≥ {ver}');
  assert.equal(zh['market.r2.launcherConflict'], '不支持在 {id} 上运行：{reason}');
  assert.equal(en['market.r2.launcherRequire'], 'Requires launcher {id} ≥ {ver}');
  assert.equal(en['market.r2.dshVersions'], 'Compatible DSH versions: {versions}');
});

// 与上面的运行时词表检查互补：源文件里不得再留内嵌依赖的标识/死字符串（注释提到历史允许）。
test('src/settings.js：不再出现内嵌依赖相关标识（vendored / 坐标字段 / 词表前缀）', () => {
  const src = readFileSync(new URL('../src/settings.js', import.meta.url), 'utf8');
  const patterns = [/\bvendored\b/, /vendorCoords/, /vendor\./];
  for (const re of patterns) {
    const hit = src.match(re);
    assert.equal(hit, null, `src/settings.js 仍残留「${hit?.[0]}」`);
  }
});

/** 最小 hooks 派发器 + 重渲染：直接渲染函数组件（不引入 react-dom / test-renderer）。
 *  组件只用 useState / useEffect；useEffect 置空以跳过异步 RPC 副作用。
 *  setState 就地改状态并同步重渲染，模拟 React「点按钮 → 拿到新树」的语义。 */
function mountFunctionComponent(Component, props) {
  const dispatcher = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?.ReactCurrentDispatcher;
  const prev = dispatcher?.current;
  const states = [];
  let tree = null;
  const render = () => {
    const before = dispatcher.current;
    let idx = 0;
    dispatcher.current = {
      useState(init) {
        const i = idx++;
        if (states[i] === undefined) states[i] = typeof init === 'function' ? init() : init;
        return [states[i], (v) => {
          states[i] = typeof v === 'function' ? v(states[i]) : v;
          render();
        }];
      },
      useEffect() {},
    };
    try {
      tree = Component(props);
    } finally {
      dispatcher.current = before;
    }
  };
  try {
    render();
  } finally {
    dispatcher.current = prev;
  }
  return { get tree() { return tree; } };
}

function renderFunctionComponent(Component, props) {
  return mountFunctionComponent(Component, props).tree;
}

/** 元素子节点归一为数组（children 可能是单值 / 数组 / null）。 */
const childrenOf = (node) => {
  const c = node?.props?.children;
  return c == null ? [] : Array.isArray(c) ? c : [c];
};

/** 深度优先遍历元素树（文本节点不是元素，直接跳过）。 */
function walkElements(node, visit) {
  if (!node || typeof node !== 'object' || !node.props) return;
  visit(node);
  for (const child of childrenOf(node)) walkElements(child, visit);
}

/** 树里所有 <button>：按钮纯文案 → 元素。 */
function buttonsByText(tree) {
  const out = new Map();
  walkElements(tree, (el) => {
    if (el.type !== 'button') return;
    const label = childrenOf(el).filter((c) => typeof c === 'string').join('');
    if (label) out.set(label, el);
  });
  return out;
}

/** 按 fieldInput 的标签文案找到对应 <input>（label = span 文案 + input）。 */
function inputByFieldLabel(tree, label) {
  let hit = null;
  walkElements(tree, (el) => {
    if (hit || el.type !== 'label') return;
    const kids = childrenOf(el).filter((k) => k && typeof k === 'object');
    if (childrenOf(kids[0]).join('') !== label) return;
    hit = kids.find((k) => k.type === 'input') ?? null;
  });
  return hit;
}

test('DspackSection 是 React 组件函数（可渲染出元素树）', () => {
  const el = renderFunctionComponent(DspackSection, { t: (k) => k, packforge: { api: { shell: () => {} } } });
  assert.ok(el);
  assert.equal(el.type, Fragment); // 顶层是 Fragment
  const children = el.props.children.filter(Boolean);
  assert.equal(children.length, 1);
  assert.equal(children[0].type, 'div'); // 主面板 section div
});

// 基线取消离线包的核心行为面：导出 payload 不再带内嵌档位/坐标，其余字段一律保留。
// 旧实现里 mode==='dspack' 时必写 vendor 字段，所以下面的「不存在」断言不是恒真。
test('导出 payload：不含内嵌档位/坐标，其余字段（profile/mode/content/兼容性/内容开关）保留', async () => {
  const calls = [];
  const rpc = {
    async call(endpoint, payload) {
      calls.push({ endpoint, payload });
      return { ok: false, error: 'stop' }; // 只需收集 payload：走错误分支，免起任务轮询
    },
  };
  const mount = mountFunctionComponent(DspackSection, { t: (k) => k, packforge: { rpc } });

  buttonsByText(mount.tree).get('tab.export').props.onClick(); // 切到导出 tab
  inputByFieldLabel(mount.tree, 'field.name').props.onInput({ target: { value: 'demo-pack' } });
  inputByFieldLabel(mount.tree, 'compat.dshVersions').props.onChange({ target: { value: '0.1.1-rc.2, 0.1.0' } });
  await buttonsByText(mount.tree).get('action.export').props.onClick();

  assert.equal(calls.length, 1);
  const { endpoint, payload } = calls[0];
  assert.equal(endpoint, 'pack/export');
  assert.equal('vendor' in payload, false);        // 内嵌档位
  assert.equal('vendorCoords' in payload, false);  // 手动勾选的内嵌坐标

  assert.equal(payload.profile, '');
  assert.equal(payload.mode, 'dspack');
  assert.equal(payload.content, 'readme');
  assert.equal(payload.name, 'demo-pack');
  assert.deepEqual(payload.dshVersions, ['0.1.1-rc.2', '0.1.0']);
  assert.equal(payload.dshVersion, '0.1.1-rc.2'); // 未填「DSH 版本」→ 集合首项
  assert.deepEqual(payload.exportContent, { skill: false, preset: false, instruction: false });
});

test('PROFILE_NAME_RE：kebab-case（小写字母数字 + 单连字符，如 aaa-bb-c）', () => {
  const ok = ['aaa', 'aaa-bb-c', 'my-modpack-1', 'a1-b2-c3', 'x'];
  const bad = ['', 'Aaa', 'aaa-bb-C', 'aaa_bb', 'aaa.bb', '-aaa', 'aaa-', 'aaa--bb', 'aaa bb', '中文'];
  for (const n of ok) assert.ok(PROFILE_NAME_RE.test(n), `应通过：${n}`);
  for (const n of bad) assert.ok(!PROFILE_NAME_RE.test(n), `应拒绝：${n}`);
});

test('RESERVED_PROFILE_NAMES：desktop / default 是保留名', () => {
  assert.ok(RESERVED_PROFILE_NAMES.includes('desktop'));
  assert.ok(RESERVED_PROFILE_NAMES.includes('default'));
  assert.ok(!RESERVED_PROFILE_NAMES.includes('aaa-bb-c'));
});