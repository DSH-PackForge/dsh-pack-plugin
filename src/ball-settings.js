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
// 变轨道态，只要 SettingsRoot 还挂着，这按钮就在 DOM 里，点得动。
//
// ── 0.3.2 实测踩到的坑（这段逻辑因此重写，别再退回「取第一个匹配」）────────────────
// `aria-haspopup="dialog"` + `aria-expanded` **不是设置入口独有的**：同类插件（如
// dsh-whale-girl-pet 的费用气泡 `.dsh-cost-pill`、`.dsh-cost-turn-trigger`）也这么写，
// 而且用 createPortal 挂到 document.body。第一版按文档顺序取第一个匹配 —— 一旦设置
// 触发按钮当时不在 DOM 里（侧边栏那棵还没挂 / 已崩），就会点开别人的费用面板。
// 现在的规矩：**只认正向信号，拿不到就报「找不到」，绝不点一个不确定的按钮**；
// 点完还要校验设置弹窗真的开出来了，没开就把误点的开关收回去。
//
// 已知边界（不粉饰）：若某个整合包让侧边栏那棵 slot 子树整个崩掉（React 抛错），
// SettingsRoot 连同触发按钮一起消失，此时谁也开不了官方设置页 —— findSettingsTrigger
// 返回 null，球如实提示，而不是假装成功。那种场景需要的是「急救」（禁用坏插件）或
// 自建面板。

/** 客户端插件提供的「切到本插件分区」钩子（它认识本插件的分区标签，不依赖标记时机）。 */
export const SECTION_FOCUS_HOOK = '__dspackFocusSection';

/** 官方设置触发按钮：语义属性，无哈希类名。 */
export const SETTINGS_TRIGGER_SELECTOR = 'button[aria-haspopup="dialog"][aria-expanded]';
/** 设置弹窗本体。 */
export const SETTINGS_DIALOG_SELECTOR = '[role="dialog"][aria-modal="true"]';
/** 本插件分区在弹窗导航里的标记（由 settings-nav-icon.js 打上）。 */
export const OWN_SECTION_SELECTOR = '[data-dspack-nav-icon]';
/** 标记属性名（hasAttribute 用）。 */
export const OWN_SECTION_ATTR = 'data-dspack-nav-icon';
/** 客户端插件公布本插件分区标签的通道（球只有 DOM 可用时的退路）。 */
export const SECTION_LABEL_HOOK = '__dspackSectionLabel';
/** 球点开设置前立起的旗标：客户端插件看到它就把导航切到本插件分区（比球自己轮询更早）。 */
export const SECTION_WANT_FLAG = '__dspackWantSection';
/** 设置弹窗导航行（shell 把每个 settings.section 渲染成 nav 里一个 button）。 */
export const NAV_ROW_SELECTOR = '[role="dialog"] nav button';
/** 当前选中的导航行（shell 用 aria-current 标记 activeId）。 */
export const ACTIVE_ROW_SELECTOR = '[role="dialog"] nav button[aria-current="true"]';
/** 侧边栏「设置区」容器的类名后缀（CSS 模块本地名，跨构建稳定）。 */
export const SETTINGS_AREA_HINT = '_settingsArea';
/** 触发按钮自身的类名后缀（SettingsRoot.module.css 的 .trigger）。 */
export const SETTINGS_TRIGGER_CLASS_HINT = '_trigger';
/** 正向信号阈值：低于它就当没找到（宁可不开，也不点错）。 */
export const SETTINGS_TRIGGER_MIN_SCORE = 4;
/** 触发按钮 aria-label 的兜底特征（多语言）。 */
const TRIGGER_LABEL_RE = /settings?|preferences|设置|偏好/i;
/** 别人的挂件特征（费用/用量/宠物类），命中直接出局。 */
const FOREIGN_WIDGET_RE = /(^|[-_\s])(cost|usage|billing|pet|whale|meter|stats?)([-_\s]|$)/i;

/** 设置弹窗当前是否开着。 */
export function isSettingsDialogOpen(doc) {
  return Boolean(doc?.querySelector?.(SETTINGS_DIALOG_SELECTOR));
}

/**
 * 给一个候选按钮打分（纯函数，便于测试）。
 *
 * 正向：在侧边栏设置区里 +5；aria-label 提到设置/偏好 +4；自身类名是 _trigger +2；
 *       带 aria-haspopup=dialog +1。
 * 出局（-100）：类名命中别人的挂件特征；或本身就在某个已打开的弹窗里。
 *
 * @returns {number} 分数，负值代表出局
 */
export function scoreSettingsTrigger(signals = {}) {
  const own = String(signals.className ?? '');
  const ancestors = Array.isArray(signals.ancestorClasses) ? signals.ancestorClasses.join(' ') : '';
  if (FOREIGN_WIDGET_RE.test(own) || FOREIGN_WIDGET_RE.test(ancestors)) return -100;
  if (signals.inDialog) return -100;
  let score = 0;
  if (ancestors.includes(SETTINGS_AREA_HINT)) score += 5;
  if (TRIGGER_LABEL_RE.test(String(signals.ariaLabel ?? ''))) score += 4;
  if (own.includes(SETTINGS_TRIGGER_CLASS_HINT)) score += 2;
  if (signals.hasPopup) score += 1;
  return score;
}

/** 采集候选按钮的信号（DOM 侧薄封装）。 */
function signalsOf(el) {
  const chain = [];
  let node = el?.parentElement ?? null;
  for (let i = 0; node && i < 8; i += 1) {
    chain.push(String(node.className ?? ''));
    node = node.parentElement ?? null;
  }
  return {
    ariaLabel: el?.getAttribute?.('aria-label') ?? '',
    className: String(el?.className ?? el?.getAttribute?.('class') ?? ''),
    ancestorClasses: chain,
    inDialog: typeof el?.closest === 'function' ? Boolean(el.closest('[role="dialog"]')) : false,
    hasPopup: el?.getAttribute?.('aria-haspopup') === 'dialog',
  };
}

/** 收集候选按钮：带 aria-haspopup=dialog 的，以及所有可展开按钮（去重）。 */
function candidatesOf(doc) {
  const out = [];
  const seen = new Set();
  for (const selector of ['button[aria-haspopup="dialog"]', 'button[aria-expanded]']) {
    let list = [];
    try {
      list = Array.from(doc.querySelectorAll(selector) ?? []);
    } catch {
      list = [];
    }
    for (const el of list) {
      if (seen.has(el)) continue;
      seen.add(el);
      out.push({ el, score: scoreSettingsTrigger(signalsOf(el)) });
    }
  }
  return out;
}

/**
 * 找官方设置入口按钮；找不到（或没有把握）返回 null —— 调用方必须如实报告，不许退而点别的。
 * @returns {Element|null}
 */
export function findSettingsTrigger(doc) {
  if (!doc?.querySelector) return null;
  let best = null;
  for (const candidate of candidatesOf(doc)) {
    if (candidate.score < SETTINGS_TRIGGER_MIN_SCORE) continue;
    if (!best || candidate.score > best.score) best = candidate;
  }
  return best?.el ?? null;
}

/**
 * 点我们自己的分区行：优先用客户端插件给的钩子（认识分区标签），退到导航图标标记。
 * 成功返回 true。
 */
export function focusOwnSection(doc, win) {
  const view = win || doc?.defaultView || (typeof window === 'undefined' ? null : window);
  const hook = view?.[SECTION_FOCUS_HOOK];
  if (typeof hook === 'function') {
    try {
      if (hook()) return isOwnRowActive(doc, view) ? 'active' : 'clicked';
    } catch {
      /* 钩子坏了就走 DOM */
    }
  }
  const row = ownRowOf(doc, view);
  if (!row) return 'none';
  if (String(row.getAttribute?.('aria-current')) === 'true') return 'active';
  try {
    row.click();
  } catch {
    return 'none';
  }
  return isOwnRowActive(doc, view) ? 'active' : 'clicked';
}

/** 本插件那一行是否已被 shell 选中（aria-current 是 shell 自己打的，可作为验收信号）。 */
export function isOwnRowActive(doc, win) {
  const active = doc?.querySelector?.(ACTIVE_ROW_SELECTOR);
  if (!active) return false;
  if (active.hasAttribute?.(OWN_SECTION_ATTR)) return true;
  const label = normalizeLabel(readOwnLabel(win));
  return label.length > 0 && normalizeLabel(active.textContent) === label;
}

/** 文案归一：折叠空白（导航行的 textContent 就是图标 + label span 的文本）。 */
export function normalizeLabel(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** 从客户端插件那儿读本插件的分区标签（钩子或值，读不到返回空串）。 */
function readOwnLabel(win) {
  const view = win || (typeof window === 'undefined' ? null : window);
  const source = view?.[SECTION_LABEL_HOOK];
  if (typeof source === 'function') {
    try {
      return source();
    } catch {
      return '';
    }
  }
  return source ?? '';
}

/**
 * 找本插件那一行导航：优先标记，其次按标签文案比对（归一化 + 容忍包含关系）。
 * 导航行没有 section id 属性（只有 className / aria-current / 一个 label span），所以只能这么认。
 */
function ownRowOf(doc, win) {
  const marked = doc?.querySelector?.(OWN_SECTION_SELECTOR);
  if (marked) return marked;
  if (typeof doc?.querySelectorAll !== 'function') return null;
  const label = normalizeLabel(readOwnLabel(win));
  if (label.length === 0) return null;
  for (const row of doc.querySelectorAll(NAV_ROW_SELECTOR)) {
    const text = normalizeLabel(row?.textContent);
    if (text === label || (text.length > 0 && (text.includes(label) || label.includes(text)))) return row;
  }
  return null;
}

/**
 * 诊断快照：切分区失败时把「我到底看到了什么」讲清楚，省得靠猜。
 * 也挂在球上（api.diag），用户/开发者一眼就能看出是缺钩子、缺标记，还是标签对不上。
 */
export function describeSettingsNav(doc, win) {
  const view = win || (typeof window === 'undefined' ? null : window);
  const rows = [];
  try {
    for (const row of doc?.querySelectorAll?.(NAV_ROW_SELECTOR) ?? []) {
      const text = normalizeLabel(row?.textContent);
      if (text.length > 0) rows.push(text);
    }
  } catch {
    /* 读不到就算了 */
  }
  return {
    dialogOpen: isSettingsDialogOpen(doc),
    ownLabel: normalizeLabel(readOwnLabel(view)),
    hasFocusHook: typeof view?.[SECTION_FOCUS_HOOK] === 'function',
    hasLabelHook: view?.[SECTION_LABEL_HOOK] != null,
    marked: Boolean(doc?.querySelector?.(OWN_SECTION_SELECTOR)),
    activeLabel: normalizeLabel(doc?.querySelector?.(ACTIVE_ROW_SELECTOR)?.textContent),
    rows,
  };
}

/** 误点之后把对方收回去：这类挂件多半是 aria-expanded 开关，再点一下就关。 */
function undoMisclick(trigger) {
  try {
    if (String(trigger?.getAttribute?.('aria-expanded')) !== 'true') return;
    // 设置区里的按钮就是官方入口：它 expanded 说明设置弹窗正在开（只是我们还没认出来），
    // 绝不能反手把它关掉 —— 宁可不收回。
    let node = trigger;
    for (let i = 0; node && i < 8; i += 1) {
      if (String(node.className ?? '').includes(SETTINGS_AREA_HINT)) return;
      node = node.parentElement ?? null;
    }
    trigger.click();
  } catch {
    /* 忽略 */
  }
}

/**
 * 打开官方设置页。
 *
 * 弹窗已开 → 只切到我们的分区；未开 → 点官方触发按钮，随后轮询校验「设置弹窗真的出现了」，
 * 并在这期间把导航切到本插件分区。校验失败（点错 / 被拦 / 根本没弹窗）就把误点的开关收回，
 * 并回调 onFail —— 宁可报失败，也不留下一地鸡毛。
 *
 * @param {Document} doc
 * @param {object} [opts]
 * @param {Window} [opts.win] 定时器来源（测试可注入）
 * @param {boolean} [opts.focusOwnSection=true] 是否顺带切到本插件分区
 * @param {number} [opts.attempts=40] 校验轮询次数（40 × 50ms ≈ 2s）
 * @param {number} [opts.intervalMs=50] 轮询间隔
 * @param {() => void} [opts.onFail] 校验失败回调（设置弹窗根本没开出来）
 * @param {() => void} [opts.onFocusFail] 弹窗开了但没能切到本插件分区的回调
 * @returns {'already-open'|'clicked'|'no-trigger'}
 */
export function openSettingsPage(doc, opts = {}) {
  if (!doc?.querySelector) return 'no-trigger';
  const win = opts.win || doc.defaultView || null;
  const focusOwn = opts.focusOwnSection !== false;
  const onFail = typeof opts.onFail === 'function' ? opts.onFail : null;

  // 弹窗已经开着也走同一条验收循环：同样可能被 rows 竞态甩回 rows[0]，
  // 同样需要「点 → 看 aria-current → 没落上再点」。
  const alreadyOpen = isSettingsDialogOpen(doc);
  let trigger = null;
  if (!alreadyOpen) {
    trigger = findSettingsTrigger(doc);
    if (!trigger) return 'no-trigger';
    // 先立旗标：客户端插件（认识自己的分区标签，且有 MutationObserver）看到它会在弹窗挂上
    // 的第一时间把导航切过来 —— 比球自己轮询更早、更准，两边谁先成都算。
    try {
      if (focusOwn && win) win[SECTION_WANT_FLAG] = true;
    } catch {
      /* 忽略 */
    }
    try {
      trigger.click();
    } catch {
      return 'no-trigger';
    }
  }

  const result = alreadyOpen ? 'already-open' : 'clicked';
  if (!win || typeof win.setTimeout !== 'function') {
    if (focusOwn) focusOwnSection(doc, win);
    return result;
  }

  const attempts = Number(opts.attempts) > 0 ? Number(opts.attempts) : 40;
  const interval = Number(opts.intervalMs) > 0 ? Number(opts.intervalMs) : 50;
  const maxClicks = Number(opts.maxClicks) > 0 ? Number(opts.maxClicks) : 3;
  let left = attempts;
  let clicks = 0;
  let focused = false;
  const tick = () => {
    const open = isSettingsDialogOpen(doc);
    if (open && focusOwn && !focused) {
      const info = describeSettingsNav(doc, win);
      // shell 用 aria-current 表态「现在选中的是谁」——这就是我们的验收信号。
      const verdict = info.activeLabel.length > 0;
      if (verdict && info.ownLabel.length > 0 && info.activeLabel === info.ownLabel) {
        focused = true;
      } else {
        // 没选中我们（或还没表态）→ 点我们那一行。注意：点击后 shell 的 activeId 虽然立刻设了，
        // 但 rows 里若暂时还没有我们这一节，它会回退到 rows[0]（用户实测就是停在那里），
        // 所以必须隔一拍再看 aria-current，没落上就再点，最多 maxClicks 次。
        if (clicks < maxClicks) {
          const state = focusOwnSection(doc, win);
          if (state !== 'none') clicks += 1;
          if (state === 'active') focused = true;
        }
        // 宿主不打 aria-current（拿不到验收信号）时，点过一次就当作完成，别死缠。
        if (!verdict && clicks > 0) focused = true;
      }
    }
    // 切过去了、或不需要切 → 收工；否则继续观察，直到窗口用完（期间最多点 maxClicks 次）
    if (open && (!focusOwn || focused)) return;
    if (--left > 0) {
      win.setTimeout(tick, interval);
      return;
    }
    if (open) {
      // 弹窗开了，但 2s 内 aria-current 始终不在我们这一行（或压根没认出我们这一行）：
      // 如实指路 + 把看到的导航一并说出来，不把用户晾在别人的分区上。
      try {
        win[SECTION_WANT_FLAG] = false;
      } catch {
        /* 忽略 */
      }
      opts.onFocusFail?.();
      return;
    }
    if (trigger) undoMisclick(trigger);
    onFail?.();
  };
  try {
    win.setTimeout(tick, 0);
  } catch {
    /* 定时器不可用就只发出点击，不校验 */
  }
  return result;
}
