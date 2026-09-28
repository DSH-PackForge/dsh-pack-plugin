// 「打开原来的设置页」：悬浮球点击后要干的事。
//
// 为什么不自己画一个页面：DSH 的设置界面本身就是一个完整的弹窗（`role="dialog"`
// aria-modal，800×800，内含全部 settings.section + 我们的分区），整合包的诉求只是
// 「进不去」，不是「没有这个页面」。官方 `SettingsRoot`（dsh-client-ui-settings-general）
// 用组件内部 state 管开合：`const [open, setOpen] = useState(false)`，只有它自己注册到
// `settings.trigger` 的按钮能 `setOpen(true)`。**官方没有对外 API**（`ctx.remote.settings
// .openSettingsDocument()` 是另一回事：那是「在本地打开设置文档」的动作，不是打开这个弹窗）。
//
// 所以唯一的路就是点那个按钮。好在它的属性是语义化的、不带构建哈希：
//   <button type="button" aria-haspopup="dialog" aria-expanded={open} aria-label={t('trigger')}>
// 而且**合成 click() 不要求元素可见**——侧边栏被主题藏起来、被别的插件挤扁、宽窄模式
// 变轨道态，只要 SettingsRoot 还挂着，这按钮就在 DOM 里，点得动。这正是「绕行入口」要的效果。
//
// 已知边界（不粉饰）：若是某个整合包让侧边栏那棵 slot 子树整个崩掉（React 抛错），
// SettingsRoot 连同这颗按钮都不存在，此时谁也开不了官方设置页 —— findSettingsTrigger
// 返回 null，球会如实提示，而不是假装成功。那种场景需要的是「急救」（禁用坏插件）或
// 自建面板，本轮按用户要求都不做。

/** 官方设置触发按钮：语义属性，无哈希类名。 */
export const SETTINGS_TRIGGER_SELECTOR = 'button[aria-haspopup="dialog"][aria-expanded]';
/** 退一步：任何可展开按钮（轨道态等变体）。 */
export const SETTINGS_TRIGGER_FALLBACK = 'button[aria-expanded]';
/** 设置弹窗本体。 */
export const SETTINGS_DIALOG_SELECTOR = '[role="dialog"][aria-modal="true"]';
/** 本插件分区在弹窗导航里的标记（由 settings-nav-icon.js 打上）。 */
export const OWN_SECTION_SELECTOR = '[data-dspack-nav-icon]';
/** 触发按钮 aria-label 的兜底特征（多语言）。 */
const TRIGGER_LABEL_RE = /settings?|preferences|设置|偏好/i;

/** 设置弹窗当前是否开着。 */
export function isSettingsDialogOpen(doc) {
  return Boolean(doc?.querySelector?.(SETTINGS_DIALOG_SELECTOR));
}

/**
 * 找官方设置入口按钮；找不到返回 null（= 侧边栏真的没了）。
 * @returns {Element|null}
 */
export function findSettingsTrigger(doc) {
  if (!doc?.querySelector) return null;
  const bySemantics = doc.querySelector(SETTINGS_TRIGGER_SELECTOR);
  if (bySemantics) return bySemantics;
  const byExpand = doc.querySelector(SETTINGS_TRIGGER_FALLBACK);
  if (byExpand) return byExpand;
  // 最后一招：按 aria-label 文本认（属性被皮肤改过时）
  const all = doc.querySelectorAll ? doc.querySelectorAll('button') : [];
  for (const btn of all) {
    const label = btn?.getAttribute?.('aria-label') ?? '';
    if (TRIGGER_LABEL_RE.test(label)) return btn;
  }
  return null;
}

/** 点我们自己的分区行（弹窗已开时才有效）；成功返回 true。 */
export function focusOwnSection(doc) {
  const row = doc?.querySelector?.(OWN_SECTION_SELECTOR);
  if (!row) return false;
  try {
    row.click();
    return true;
  } catch {
    return false;
  }
}

/**
 * 打开官方设置页。
 *
 * 弹窗已开 → 只切到我们的分区；未开 → 点官方触发按钮，然后在随后的若干帧里等 React 提交，
 * 再把导航切到本插件分区（我们那行有 data-dspack-nav-icon 标记，靠它认，不依赖文案）。
 *
 * @param {Document} doc
 * @param {object} [opts]
 * @param {Window} [opts.win] 定时器来源（测试可注入）
 * @param {boolean} [opts.focusOwnSection=true] 是否顺带切到本插件分区
 * @param {number} [opts.attempts=6] 找分区行的重试次数
 * @param {number} [opts.intervalMs=50] 重试间隔
 * @returns {'already-open'|'clicked'|'no-trigger'}
 */
export function openSettingsPage(doc, opts = {}) {
  if (!doc?.querySelector) return 'no-trigger';
  const win = opts.win || doc.defaultView || null;
  const focusOwn = opts.focusOwnSection !== false;

  if (isSettingsDialogOpen(doc)) {
    if (focusOwn) focusOwnSection(doc);
    return 'already-open';
  }

  const trigger = findSettingsTrigger(doc);
  if (!trigger) return 'no-trigger';
  try {
    trigger.click();
  } catch {
    return 'no-trigger';
  }

  if (focusOwn && win && typeof win.setTimeout === 'function' && typeof doc.querySelector === 'function') {
    let left = Number(opts.attempts) > 0 ? Number(opts.attempts) : 6;
    const interval = Number(opts.intervalMs) > 0 ? Number(opts.intervalMs) : 50;
    // 幂等：点过一次就收手（弹窗里我们那行点完会把 activeId 切过来）
    let done = false;
    const tick = () => {
      if (done) return;
      if (focusOwnSection(doc)) { done = true; return; }
      if (--left > 0) win.setTimeout(tick, interval);
    };
    try {
      win.setTimeout(tick, 0);
    } catch {
      /* 定时器不可用就只打开弹窗，不切分区 */
    }
  }
  return 'clicked';
}
