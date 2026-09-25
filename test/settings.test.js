import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { Fragment } from 'react';
import { registerSettingsSection, DspackSection } from '../src/settings.js';
import { PROFILE_NAME_RE, RESERVED_PROFILE_NAMES } from '../src/channel.js';

/** mock DSH client slots 服务。 */
function makeSlots() {
  const injected = {};
  return {
    injected,
    inject(name, factory) { injected[name] = factory; },
    register(options, Component) { return { options, Component }; },
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

  const { options, Component } = factory();
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
});

/** 最小 hooks 派发器：直接渲染函数组件（不引入 react-dom / test-renderer）。
 *  组件只用 useState / useEffect；useEffect 置空以跳过异步 RPC 副作用。 */
function renderFunctionComponent(Component, props) {
  const dispatcher = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?.ReactCurrentDispatcher;
  const prev = dispatcher?.current;
  const states = [];
  let idx = 0;
  dispatcher.current = {
    useState(init) {
      const i = idx++;
      if (states[i] === undefined) states[i] = typeof init === 'function' ? init() : init;
      return [states[i], (v) => { states[i] = v; }];
    },
    useEffect() {},
  };
  try {
    return Component(props);
  } finally {
    dispatcher.current = prev;
  }
}

test('DspackSection 是 React 组件函数（可渲染出元素树）', () => {
  const el = renderFunctionComponent(DspackSection, { t: (k) => k, packforge: { api: { shell: () => {} } } });
  assert.ok(el);
  assert.equal(el.type, Fragment); // 顶层是 Fragment
  const children = el.props.children.filter(Boolean);
  assert.equal(children.length, 1);
  assert.equal(children[0].type, 'div'); // 主面板 section div
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