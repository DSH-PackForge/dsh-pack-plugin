// 「打开官方设置页」的测试。
//
// 这里自带一个**只为本模块用到的选择器**服务的迷你 DOM（不引 jsdom）：模块实际只用
// 标签 + 属性选择器（`button[aria-haspopup="dialog"][aria-expanded]` 之类），
// 所以假 DOM 只实现 tag 与 [attr] / [attr="v"] / [attr*="v"] 的匹配，够用且不会假装
// 支持完整 CSS。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findSettingsTrigger, isSettingsDialogOpen, focusOwnSection, openSettingsPage,
  SETTINGS_TRIGGER_SELECTOR, SETTINGS_DIALOG_SELECTOR, OWN_SECTION_SELECTOR,
} from '../src/ball-settings.js';

/* ------------------- 迷你 DOM ------------------- */

function makeEl(tag, attrs = {}) {
  const el = {
    tagName: tag.toUpperCase(),
    attrs: { ...attrs },
    clicks: 0,
    onClick: null,
    getAttribute: (k) => (k in el.attrs ? el.attrs[k] : null),
    hasAttribute: (k) => k in el.attrs,
    setAttribute: (k, v) => { el.attrs[k] = v; },
    click() { el.clicks += 1; el.onClick?.(); },
  };
  return el;
}

/** 选择器匹配：`tag` + 任意个 [attr] / [attr="v"] / [attr*="v"]。 */
function matches(el, selector) {
  const m = /^([A-Za-z]*)((?:\[[^\]]*\])*)$/.exec(selector.trim());
  if (!m) throw new Error(`迷你 DOM 不支持这个选择器：${selector}`);
  const [, tag, attrsRaw] = m;
  if (tag && el.tagName !== tag.toUpperCase()) return false;
  const tokens = attrsRaw ? attrsRaw.match(/\[[^\]]*\]/g) ?? [] : [];
  for (const token of tokens) {
    const body = token.slice(1, -1);
    const eq = /^([\w-]+)="([^"]*)"$/.exec(body);
    const star = /^([\w-]+)\*="([^"]*)"$/.exec(body);
    if (star) {
      if (!String(el.attrs[star[1]] ?? '').includes(star[2])) return false;
    } else if (eq) {
      if (el.attrs[eq[1]] !== eq[2]) return false;
    } else if (!(body in el.attrs)) {
      return false;
    }
  }
  return true;
}

function makeDoc() {
  const nodes = [];
  const doc = {
    _nodes: nodes,
    add(...els) { nodes.push(...els); return els[0]; },
    createElement(tag) { const el = makeEl(tag); nodes.push(el); return el; },
    querySelector: (sel) => nodes.find((n) => matches(n, sel)) ?? null,
    querySelectorAll: (sel) => nodes.filter((n) => matches(n, sel)),
  };
  return doc;
}

function makeWin() {
  const timers = [];
  return {
    setTimeout(fn) { timers.push(fn); return timers.length; },
    clearTimeout() {},
    runTimers(limit = 50) {
      let n = 0;
      while (timers.length && n++ < limit) timers.shift()();
      return n;
    },
  };
}

/** 官方触发按钮（属性取自 dsh-client-ui-settings-general 的 SettingsRoot）。 */
function officialTrigger({ label = '设置', expanded = 'false', extra = {} } = {}) {
  return makeEl('button', {
    'aria-haspopup': 'dialog', 'aria-expanded': expanded, 'aria-label': label, ...extra,
  });
}

/** 设置弹窗（已开）。 */
function openDialog() {
  return makeEl('div', { role: 'dialog', 'aria-modal': 'true' });
}

/* ------------------- 找入口 ------------------- */

test('findSettingsTrigger：语义属性优先，无哈希类名依赖', () => {
  const doc = makeDoc();
  const other = makeEl('button', { 'aria-expanded': 'false' });   // 先出现的干扰项
  const trigger = officialTrigger();
  doc.add(other, trigger);
  assert.equal(findSettingsTrigger(doc), trigger);
  assert.equal(SETTINGS_TRIGGER_SELECTOR, 'button[aria-haspopup="dialog"][aria-expanded]');
});

test('findSettingsTrigger：退到任意可展开按钮 → 再退到 aria-label 文本', () => {
  const onlyExpand = makeDoc();
  const btn = makeEl('button', { 'aria-expanded': 'false' });
  onlyExpand.add(btn);
  assert.equal(findSettingsTrigger(onlyExpand), btn);

  const byLabel = makeDoc();
  const labeled = makeEl('button', { 'aria-label': 'Settings' });
  byLabel.add(makeEl('div'), labeled);
  assert.equal(findSettingsTrigger(byLabel), labeled);

  // 认中文标签
  const zh = makeDoc();
  const zhBtn = makeEl('button', { 'aria-label': '打开设置' });
  zh.add(zhBtn);
  assert.equal(findSettingsTrigger(zh), zhBtn);

  assert.equal(findSettingsTrigger(makeDoc()), null, '什么都没有时应返回 null');
  assert.equal(findSettingsTrigger(null), null);
});

/* ------------------- 打开 ------------------- */

test('openSettingsPage：点官方触发按钮，返回 clicked 且只点一次', () => {
  const doc = makeDoc();
  const win = makeWin();
  const trigger = officialTrigger();
  doc.add(trigger);
  assert.equal(openSettingsPage(doc, { win }), 'clicked');
  assert.equal(trigger.clicks, 1);
  // 没有分区标记 → 定时器重试几轮后放弃，不报错
  win.runTimers();
  assert.equal(trigger.clicks, 1, '不应重复点触发按钮');
});

test('openSettingsPage：弹窗已开 → already-open，不重复点触发按钮，并切到本插件分区', () => {
  const doc = makeDoc();
  const win = makeWin();
  const trigger = officialTrigger();
  const dialog = openDialog();
  const ownRow = makeEl('button', { 'data-dspack-nav-icon': '' });
  doc.add(trigger, dialog, ownRow);
  assert.equal(isSettingsDialogOpen(doc), true);
  assert.equal(openSettingsPage(doc, { win }), 'already-open');
  assert.equal(trigger.clicks, 0);
  assert.equal(ownRow.clicks, 1);
  assert.equal(SETTINGS_DIALOG_SELECTOR, '[role="dialog"][aria-modal="true"]');
  assert.equal(OWN_SECTION_SELECTOR, '[data-dspack-nav-icon]');
});

test('openSettingsPage：弹窗打开后（React 异步提交）把导航切到本插件分区', () => {
  const doc = makeDoc();
  const win = makeWin();
  const trigger = officialTrigger();
  // 模拟 React 提交：点完触发按钮之后，弹窗与我们的导航行才出现
  trigger.onClick = () => {
    doc.add(openDialog());
    doc.add(makeEl('button', { 'data-dspack-nav-icon': '' }));
  };
  doc.add(trigger);
  assert.equal(openSettingsPage(doc, { win }), 'clicked');
  assert.equal(doc.querySelector(OWN_SECTION_SELECTOR).clicks, 0, '提交前还没点');
  win.runTimers();
  assert.equal(doc.querySelector(OWN_SECTION_SELECTOR).clicks, 1, '提交后应切到本插件分区');
});

test('openSettingsPage：没有官方入口（侧边栏那棵真没了）→ no-trigger，不假装成功', () => {
  const doc = makeDoc();
  doc.add(makeEl('div'), makeEl('a', { href: '#' }));
  assert.equal(openSettingsPage(doc, { win: makeWin() }), 'no-trigger');
  assert.equal(openSettingsPage(null, {}), 'no-trigger');
});

test('focusOwnSection：没有标记行时返回 false（客户端插件没加载的情形）', () => {
  const doc = makeDoc();
  assert.equal(focusOwnSection(doc), false);
  const row = doc.add(makeEl('button', { 'data-dspack-nav-icon': '' }));
  assert.equal(focusOwnSection(doc), true);
  assert.equal(row.clicks, 1);
});
