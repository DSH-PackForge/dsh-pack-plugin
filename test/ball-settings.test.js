// 「打开官方设置页」的测试。
//
// 这里自带一个**只为本模块用到的选择器**服务的迷你 DOM（不引 jsdom）：模块实际只用
// 标签 + 属性 + 后代组合（`[role="dialog"] nav button`）这几类选择器，所以假 DOM 只实现
// 这些 + parentElement/closest，够用且不会假装支持完整 CSS。
//
// 重点是几件事故性的事：
//   ① 0.3.2 实测：点球后设置弹窗开出来了，却停在「费用估算」那一节 —— 别的插件的 section
//      order 更小占了 rows[0]，而我们的「切分区」只认导航图标标记、只轮询 300ms。
//   ② 同类插件的费用气泡（aria-haspopup=dialog + aria-expanded）也会被选择器匹配到，
//      所以找入口改成正向打分：拿不到把握就报「找不到」，绝不点一个不确定的按钮。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findSettingsTrigger, isSettingsDialogOpen, focusOwnSection, isOwnRowActive, openSettingsPage,
  scoreSettingsTrigger, SECTION_FOCUS_HOOK, SECTION_LABEL_HOOK, SECTION_WANT_FLAG,
  SETTINGS_DIALOG_SELECTOR, OWN_SECTION_SELECTOR, SETTINGS_TRIGGER_MIN_SCORE,
} from '../src/ball-settings.js';

/* ------------------- 迷你 DOM ------------------- */

function makeEl(tag, attrs = {}) {
  const el = {
    tagName: tag.toUpperCase(),
    attrs: { ...attrs },
    parentElement: null,
    textContent: '',
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

/** 单个复合选择器：`tag` + 任意个 [attr] / [attr="v"] / [attr*="v"]。 */
function matchesCompound(el, part) {
  const m = /^([A-Za-z]*)((?:\[[^\]]*\])*)$/.exec(part);
  if (!m) throw new Error(`迷你 DOM 不支持这个选择器片段：${part}`);
  const [, tag, attrsRaw] = m;
  if (tag && el.tagName !== tag.toUpperCase()) return false;
  for (const token of attrsRaw ? attrsRaw.match(/\[[^\]]*\]/g) ?? [] : []) {
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

/** 支持后代组合的选择器匹配（空格分隔，祖先顺序匹配，不要求相邻）。 */
function matches(el, selector) {
  const parts = String(selector).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return false;
  if (!matchesCompound(el, parts[parts.length - 1])) return false;
  let node = el.parentElement;
  for (let i = parts.length - 2; i >= 0; i -= 1) {
    let found = null;
    while (node) {
      if (matchesCompound(node, parts[i])) { found = node; break; }
      node = node.parentElement;
    }
    if (!found) return false;
    node = found.parentElement;
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
      if (parent) el.parentElement = parent;
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

/** 侧边栏里的官方设置区 + 触发按钮。 */
function settingsArea(doc) {
  const area = doc.add(makeEl('div', { class: 'hHd-Xa_settingsArea' }));
  return { area, trigger: doc.add(officialTrigger(), area) };
}

/** 打开着的设置弹窗：`<div role=dialog aria-modal><nav>…</nav></div>`。 */
function openSettingsDialog(doc, labels = []) {
  const dialog = doc.add(makeEl('div', { role: 'dialog', 'aria-modal': 'true' }));
  const nav = doc.add(makeEl('nav'), dialog);
  const rows = labels.map((label) => {
    const row = doc.add(makeEl('button'), nav);
    row.textContent = label;
    return row;
  });
  return { dialog, nav, rows };
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
  assert.ok(scoreSettingsTrigger({
    className: 'other_trigger', ariaLabel: '选择模型', hasPopup: true,
  }) < SETTINGS_TRIGGER_MIN_SCORE);
});

/* ------------------- 找入口 ------------------- */

test('findSettingsTrigger：认「设置区里的设置按钮」，不认裸可展开按钮', () => {
  const doc = makeDoc();
  const { trigger } = settingsArea(doc);
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
  const { trigger } = settingsArea(doc);
  trigger.setAttribute('aria-expanded', 'true');
  const { rows } = openSettingsDialog(doc, ['费用估算', '整合包']);
  win[SECTION_LABEL_HOOK] = () => '整合包';

  assert.equal(isSettingsDialogOpen(doc), true);
  assert.equal(openSettingsPage(doc, { win }), 'already-open');
  assert.equal(trigger.clicks, 0);
  win.runTimers();                                 // 验收循环在下一拍动手（要看 aria-current）
  assert.equal(rows[1].clicks, 1, '应点「整合包」那一行');
  assert.equal(rows[0].clicks, 0, '不该点「费用估算」');
  assert.equal(SETTINGS_DIALOG_SELECTOR, '[role="dialog"][aria-modal="true"]');
  assert.equal(OWN_SECTION_SELECTOR, '[data-dspack-nav-icon]');
});

test('openSettingsPage：弹窗打开后（React 异步提交）把导航切到本插件分区', () => {
  const doc = makeDoc();
  const win = makeWin();
  const { trigger } = settingsArea(doc);
  let ownRow = null;
  trigger.onClick = () => { ownRow = openSettingsDialog(doc, ['费用估算', '整合包']).rows[1]; };
  win[SECTION_LABEL_HOOK] = () => '整合包';

  assert.equal(openSettingsPage(doc, { win }), 'clicked');
  assert.ok(ownRow, '点击后弹窗与导航行才出现');
  assert.equal(ownRow.clicks, 0, '还没轮到轮询去找那一行');
  win.runTimers();
  assert.equal(ownRow.clicks, 1, '提交后应切到本插件分区');
  assert.equal(trigger.clicks, 1, '不该重复点触发按钮');
});

test('openSettingsPage：点开前先立旗标（客户端插件据此在弹窗挂上时立刻切分区）', () => {
  const doc = makeDoc();
  const win = makeWin();
  settingsArea(doc);
  assert.equal(openSettingsPage(doc, { win }), 'clicked');
  assert.equal(win[SECTION_WANT_FLAG], true, '点触发按钮之前就该立好旗标');
});

test('openSettingsPage：已经切到本插件分区（aria-current）就收工，不再重复点', () => {
  const doc = makeDoc();
  const win = makeWin();
  const { trigger } = settingsArea(doc);
  trigger.setAttribute('aria-expanded', 'true');
  const { rows } = openSettingsDialog(doc);
  const own = doc.add(makeEl('button', { 'data-dspack-nav-icon': '' }), doc.querySelector('nav'));
  own.textContent = '整合包';
  own.setAttribute('aria-current', 'true');
  rows.push(own);
  win[SECTION_LABEL_HOOK] = () => '整合包';

  assert.equal(openSettingsPage(doc, { win }), 'already-open');
  assert.equal(own.clicks, 0, '已是选中态就不用再点');
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
  const { trigger } = settingsArea(doc);
  // 点了之后 expanded=true，但由于「慢」，轮询窗口内一直没看到弹窗
  trigger.onClick = () => { trigger.setAttribute('aria-expanded', 'true'); };
  let failed = 0;
  openSettingsPage(doc, { win, attempts: 3, intervalMs: 1, onFail: () => { failed += 1; } });
  win.runTimers();
  assert.equal(failed, 1);
  assert.equal(trigger.clicks, 1, '官方入口不许被我们关掉（弹窗可能只是开得慢）');
});

test('openSettingsPage：弹窗开了但找不到我们那一行 → onFocusFail 指路（0.3.2 停在费用分区那种情形）', () => {
  const doc = makeDoc();
  const win = makeWin();
  const { trigger } = settingsArea(doc);
  trigger.onClick = () => { openSettingsDialog(doc, ['费用估算']); };
  let unfocused = 0;
  assert.equal(openSettingsPage(doc, {
    win, attempts: 3, intervalMs: 1, onFocusFail: () => { unfocused += 1; },
  }), 'clicked');
  win.runTimers();
  assert.equal(unfocused, 1);
  assert.equal(trigger.clicks, 1, '弹窗开着就不该再动触发按钮');
  assert.equal(win[SECTION_WANT_FLAG], false, '认不出来就该把旗标撤掉，别留着');
});

test('openSettingsPage：客户端插件的分区钩子优先于导航标记与文案比对', () => {
  const doc = makeDoc();
  const win = makeWin();
  const { trigger } = settingsArea(doc);
  trigger.setAttribute('aria-expanded', 'true');
  const { rows } = openSettingsDialog(doc, ['整合包']);
  win[SECTION_LABEL_HOOK] = () => '整合包';

  let hooked = 0;
  win[SECTION_FOCUS_HOOK] = () => { hooked += 1; return true; };
  assert.equal(openSettingsPage(doc, { win }), 'already-open');
  win.runTimers();
  assert.equal(hooked, 1, '应优先用钩子（它认识本插件分区标签）');
  assert.equal(rows[0].clicks, 0);
});

test('openSettingsPage：点了却没切过去（shell 停在别人的分区）→ 再点，然后如实报失败', () => {
  // 用户实测那种情形：aria-current 一直在「费用估算」上（rows 里暂时没有我们 → 回退 rows[0]）
  const doc = makeDoc();
  const win = makeWin();
  const { trigger } = settingsArea(doc);
  trigger.setAttribute('aria-expanded', 'true');
  const { rows } = openSettingsDialog(doc, ['费用估算', '整合包']);
  rows[0].setAttribute('aria-current', 'true');
  win[SECTION_LABEL_HOOK] = () => '整合包';

  let unfocused = 0;
  assert.equal(openSettingsPage(doc, {
    win, attempts: 4, intervalMs: 1, maxClicks: 2, onFocusFail: () => { unfocused += 1; },
  }), 'already-open');
  win.runTimers();
  assert.equal(rows[1].clicks, 2, '没落上就再点一次（上限 maxClicks）');
  assert.equal(unfocused, 1, '2s 都没落上，就得如实告诉用户');
});

test('openSettingsPage：点击后 shell 下一拍才表态 → 不重复点，正常收工', () => {
  const doc = makeDoc();
  const win = makeWin();
  const { trigger } = settingsArea(doc);
  trigger.setAttribute('aria-expanded', 'true');
  const { rows } = openSettingsDialog(doc, ['费用估算', '整合包']);
  win[SECTION_LABEL_HOOK] = () => '整合包';
  rows[1].onClick = () => { rows[1].setAttribute('aria-current', 'true'); };

  let unfocused = 0;
  openSettingsPage(doc, { win, attempts: 8, intervalMs: 1, onFocusFail: () => { unfocused += 1; } });
  win.runTimers();
  assert.equal(rows[1].clicks, 1);
  assert.equal(unfocused, 0, '已经切过去了就不该报失败');
});

/* ------------------- 认行与验收 ------------------- */

test('focusOwnSection：没有钩子也没有标记时，按公布的标签文案认行', () => {
  const doc = makeDoc();
  const win = makeWin();
  const { rows } = openSettingsDialog(doc, ['费用估算', '整合包']);
  win[SECTION_LABEL_HOOK] = () => '整合包';

  assert.equal(focusOwnSection(doc, win), 'clicked');
  assert.equal(rows[1].clicks, 1);
  assert.equal(rows[0].clicks, 0, '别的分区一行都不许点');

  // shell 选中后会打 aria-current，我们据此验收（不用瞎猜）
  rows[1].setAttribute('aria-current', 'true');
  assert.equal(isOwnRowActive(doc, win), true);
  assert.equal(focusOwnSection(doc, win), 'active');
  assert.equal(rows[1].clicks, 1, '已经是选中态就不必再点');
});

test('focusOwnSection：标签带空白也能认（导航行 textContent 是图标 + label span）', () => {
  const doc = makeDoc();
  const win = makeWin();
  const { rows } = openSettingsDialog(doc, ['  整 合 包 \n']);
  win[SECTION_LABEL_HOOK] = () => '整 合 包';
  assert.equal(focusOwnSection(doc, win), 'clicked');
  assert.equal(rows[0].clicks, 1);
});

test('focusOwnSection：既没有钩子、没有标记、也没有标签 → none（不点任何一行）', () => {
  const doc = makeDoc();
  const dialog = doc.add(makeEl('div', { role: 'dialog', 'aria-modal': 'true' }));
  const nav = doc.add(makeEl('nav'), dialog);
  const row = doc.add(makeEl('button'), nav);
  row.textContent = '整合包';
  assert.equal(focusOwnSection(doc, makeWin()), 'none');
  assert.equal(row.clicks, 0);

  const marked = doc.add(makeEl('button', { 'data-dspack-nav-icon': '' }), nav);
  assert.equal(focusOwnSection(doc, makeWin()), 'clicked');
  assert.equal(marked.clicks, 1);
});
