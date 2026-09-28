// 「打开官方设置页」的测试。
//
// 这里自带一个**只为本模块用到的选择器**服务的迷你 DOM（不引 jsdom）：模块实际只用
// 标签 + 属性选择器（`button[aria-haspopup="dialog"]` 之类），所以假 DOM 只实现 tag 与
// [attr] / [attr="v"] / [attr*="v"] 的匹配 + parentElement/closest，够用且不会假装支持
// 完整 CSS。
//
// 重点是两件事故性的事：
//   ① 0.3.2 实测：同类插件的费用气泡（aria-haspopup=dialog + aria-expanded）也会被匹配到，
//      第一版按文档顺序取第一个 → 点开了费用面板。所以这里钉住「宁可不点，也不乱点」。
//   ② 点完要校验设置弹窗真开出来了；没开就把误点的开关收回去，并如实回调失败。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findSettingsTrigger, isSettingsDialogOpen, focusOwnSection, openSettingsPage,
  scoreSettingsTrigger, SECTION_FOCUS_HOOK, SETTINGS_DIALOG_SELECTOR, OWN_SECTION_SELECTOR,
  SETTINGS_TRIGGER_MIN_SCORE,
} from '../src/ball-settings.js';

/* ------------------- 迷你 DOM ------------------- */

function makeEl(tag, attrs = {}) {
  const el = {
    tagName: tag.toUpperCase(),
    attrs: { ...attrs },
    parentElement: null,
    clicks: 0,
    onClick: null,
    get className() { return String(el.attrs.class ?? ''); },
    getAttribute: (k) => (k in el.attrs ? el.attrs[k] : null),
    hasAttribute: (k) => k in el.attrs,
    setAttribute: (k, v) => { el.attrs[k] = v; },
    click() { el.clicks += 1; el.onClick?.(); },
    closest(selector) {
      let node = el;
      while (node) {
        if (matches(node, selector)) return node;
        node = node.parentElement;
      }
      return null;
    },
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
    /** 按文档顺序落一个节点，可指定父节点（模拟真实层级）。 */
    add(el, parent = null) {
      nodes.push(el);
      if (parent) { el.parentElement = parent; parent.childNodes = (parent.childNodes ?? []).concat(el); }
      return el;
    },
    createElement(tag) { return doc.add(makeEl(tag)); },
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
    runTimers(limit = 200) {
      let n = 0;
      while (timers.length && n++ < limit) timers.shift()();
      return n;
    },
  };
}

/** 官方触发按钮（属性取自 dsh-client-ui-settings-general 的 SettingsRoot）。 */
function officialTrigger({ label = '设置', expanded = 'false', cls = 'VOzbGW_trigger' } = {}) {
  return makeEl('button', {
    'aria-haspopup': 'dialog', 'aria-expanded': expanded, 'aria-label': label, class: cls,
  });
}

/** 同类插件的费用气泡（dsh-whale-girl-pet 的 .dsh-cost-pill，同样 aria-haspopup=dialog）。 */
function costPill({ expanded = 'false' } = {}) {
  return makeEl('button', {
    'aria-haspopup': 'dialog', 'aria-expanded': expanded, class: 'dsh-cost-pill',
    'aria-label': '费用估算 ¥3.95 高峰时段',
  });
}

function openDialog() {
  return makeEl('div', { role: 'dialog', 'aria-modal': 'true' });
}

/* ------------------- 打分（纯函数） ------------------- */

test('scoreSettingsTrigger：设置入口拿正向分，别人的挂件直接出局', () => {
  const settingsInArea = scoreSettingsTrigger({
    className: 'VOzbGW_trigger', ariaLabel: '设置', hasPopup: true,
    ancestorClasses: ['hHd-Xa_settingsArea', 'hHd-Xa_footArea'],
    inDialog: false,
  });
  assert.ok(settingsInArea >= SETTINGS_TRIGGER_MIN_SCORE, `设置入口应达标，实得 ${settingsInArea}`);

  // 费用气泡：类名命中 cost → 出局（哪怕它也 aria-haspopup=dialog）
  assert.ok(scoreSettingsTrigger({
    className: 'dsh-cost-pill', ariaLabel: '费用估算 ¥3.95 高峰时段', hasPopup: true,
    ancestorClasses: ['dsh-cost-root'],
  }) < 0);
  assert.ok(scoreSettingsTrigger({ className: 'dsh-cost-turn-trigger', hasPopup: true }) < 0);

  // 弹窗内部（已开弹窗里的按钮）不算入口
  assert.ok(scoreSettingsTrigger({
    className: 'VOzbGW_trigger', ariaLabel: '设置', hasPopup: true, inDialog: true,
  }) < 0);

  // 裸的可展开按钮（没有设置语义）不该达标 —— 宁可不点
  assert.ok(scoreSettingsTrigger({ className: 'other_trigger', ariaLabel: '选择模型', hasPopup: true }) < SETTINGS_TRIGGER_MIN_SCORE);
});

/* ------------------- 找入口 ------------------- */

test('findSettingsTrigger：认「设置区里的设置按钮」，不认裸可展开按钮', () => {
  const doc = makeDoc();
  const area = doc.add(makeEl('div', { class: 'hHd-Xa_settingsArea' }));
  const trigger = doc.add(officialTrigger(), area);
  doc.add(makeEl('button', { 'aria-expanded': 'false', class: 'other_toggle' }));
  assert.equal(findSettingsTrigger(doc), trigger);
});

test('回归（0.3.2 事故）：费用气泡排在前面时，必须点设置入口，绝不能点气泡', () => {
  // 真实情形：桌宠的费用气泡 createPortal 到 body（文档顺序可能更早），设置入口在侧边栏里
  const doc = makeDoc();
  const pill = doc.add(costPill());
  const sidebar = doc.add(makeEl('aside', { class: 'hHd-Xa_root' }));
  const area = doc.add(makeEl('div', { class: 'hHd-Xa_settingsArea' }), sidebar);
  const trigger = doc.add(officialTrigger(), area);

  assert.equal(findSettingsTrigger(doc), trigger, '应认出侧边栏里的设置入口');

  const win = makeWin();
  assert.equal(openSettingsPage(doc, { win }), 'clicked');
  assert.equal(trigger.clicks, 1);
  assert.equal(pill.clicks, 0, '费用气泡一次都不许点');
});

test('findSettingsTrigger：只有费用气泡时返回 null（宁可不点，也不点错）', () => {
  const doc = makeDoc();
  const pill = doc.add(costPill());
  assert.equal(findSettingsTrigger(doc), null);
  const win = makeWin();
  assert.equal(openSettingsPage(doc, { win }), 'no-trigger');
  assert.equal(pill.clicks, 0);
  win.runTimers();
  assert.equal(pill.clicks, 0);
});

test('findSettingsTrigger：什么都没有 → null；空 document 也不抛', () => {
  assert.equal(findSettingsTrigger(makeDoc()), null);
  assert.equal(findSettingsTrigger(null), null);
  assert.equal(openSettingsPage(null, {}), 'no-trigger');
});

/* ------------------- 打开与校验 ------------------- */

test('openSettingsPage：弹窗已开 → already-open，不重复点触发按钮，并切到本插件分区', () => {
  const doc = makeDoc();
  const win = makeWin();
  const area = doc.add(makeEl('div', { class: '_settingsArea' }));
  const trigger = doc.add(officialTrigger({ expanded: 'true' }), area);
  const dialog = doc.add(openDialog());
  const ownRow = doc.add(makeEl('button', { 'data-dspack-nav-icon': '' }), dialog);

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
  const area = doc.add(makeEl('div', { class: '_settingsArea' }));
  const trigger = doc.add(officialTrigger(), area);
  let ownRow = null;
  trigger.onClick = () => { doc.add(openDialog()); ownRow = doc.add(makeEl('button', { 'data-dspack-nav-icon': '' })); };

  assert.equal(openSettingsPage(doc, { win }), 'clicked');
  assert.ok(ownRow, '点击后 React 已提交弹窗与导航行');
  assert.equal(ownRow.clicks, 0, '还没轮到轮询去点导航行');
  win.runTimers();
  assert.equal(ownRow.clicks, 1, '提交后应切到本插件分区');
  assert.equal(trigger.clicks, 1, '不该重复点触发按钮');
});

test('openSettingsPage：校验没通过（点了没反应）→ 回调失败，并把误点的开关收回去', () => {
  const doc = makeDoc();
  const win = makeWin();
  // 一个「点了会展开、但开的不是设置弹窗」的开关，且不在官方设置区里（模拟别家挂件）
  const wrong = doc.add(makeEl('button', {
    'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': 'Settings 面板', class: 'other_trigger',
  }));
  wrong.onClick = () => { wrong.setAttribute('aria-expanded', 'true'); };
  let failed = 0;
  assert.equal(openSettingsPage(doc, { win, onFail: () => { failed += 1; } }), 'clicked');
  win.runTimers();
  assert.equal(failed, 1, '应如实回调失败');
  assert.equal(wrong.clicks, 2, '误点开的开关应被再点一次收回');
});

test('openSettingsPage：官方入口 expanded 但弹窗还没被认出来时，不许反手把它关掉', () => {
  const doc = makeDoc();
  const win = makeWin();
  const area = doc.add(makeEl('div', { class: 'hHd-Xa_settingsArea' }));
  const trigger = doc.add(officialTrigger(), area);
  // 点了之后 expanded=true，但由于「慢」，轮询窗口内一直没看到弹窗
  trigger.onClick = () => { trigger.setAttribute('aria-expanded', 'true'); };
  let failed = 0;
  openSettingsPage(doc, { win, attempts: 3, intervalMs: 1, onFail: () => { failed += 1; } });
  win.runTimers();
  assert.equal(failed, 1);
  assert.equal(trigger.clicks, 1, '官方入口不许被我们关掉（弹窗可能只是开得慢）');
});

test('openSettingsPage：弹窗开了但切不过去 → 回调 onFocusFail（0.3.2 停在费用分区那种情形）', () => {
  const doc = makeDoc();
  const win = makeWin();
  const area = doc.add(makeEl('div', { class: 'hHd-Xa_settingsArea' }));
  const trigger = doc.add(officialTrigger(), area);
  trigger.onClick = () => { doc.add(openDialog()); };   // 只开弹窗，没有我们那一行
  let unfocused = 0;
  let opened = false;
  assert.equal(openSettingsPage(doc, {
    win, attempts: 3, intervalMs: 1,
    onFocusFail: () => { unfocused += 1; opened = true; },
  }), 'clicked');
  win.runTimers();
  assert.equal(opened, true);
  assert.equal(unfocused, 1);
  assert.equal(trigger.clicks, 1, '弹窗开着就不该再动触发按钮');
});

test('openSettingsPage：客户端插件的分区钩子优先于导航标记', () => {
  const doc = makeDoc();
  const win = makeWin();
  const area = doc.add(makeEl('div', { class: '_settingsArea' }));
  doc.add(officialTrigger({ expanded: 'true' }), area);
  const dialog = doc.add(openDialog());
  const markedRow = doc.add(makeEl('button', { 'data-dspack-nav-icon': '' }), dialog);

  let hooked = 0;
  win[SECTION_FOCUS_HOOK] = () => { hooked += 1; return true; };
  assert.equal(openSettingsPage(doc, { win }), 'already-open');
  assert.equal(hooked, 1, '应优先用钩子（它认识本插件分区标签）');
  assert.equal(markedRow.clicks, 0);
});

test('focusOwnSection：既没有钩子也没有标记 → false（客户端插件没加载的情形）', () => {
  const doc = makeDoc();
  assert.equal(focusOwnSection(doc, makeWin()), false);
  const row = doc.add(makeEl('button', { 'data-dspack-nav-icon': '' }));
  assert.equal(focusOwnSection(doc, makeWin()), true);
  assert.equal(row.clicks, 1);
});
