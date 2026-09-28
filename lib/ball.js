(() => {
  // src/ball-settings.js
  var SECTION_FOCUS_HOOK = "__dspackFocusSection";
  var SETTINGS_DIALOG_SELECTOR = '[role="dialog"][aria-modal="true"]';
  var OWN_SECTION_SELECTOR = "[data-dspack-nav-icon]";
  var OWN_SECTION_ATTR = "data-dspack-nav-icon";
  var SECTION_LABEL_HOOK = "__dspackSectionLabel";
  var SECTION_WANT_FLAG = "__dspackWantSection";
  var NAV_ROW_SELECTOR = '[role="dialog"] nav button';
  var ACTIVE_ROW_SELECTOR = '[role="dialog"] nav button[aria-current="true"]';
  var SETTINGS_AREA_HINT = "_settingsArea";
  var SETTINGS_TRIGGER_CLASS_HINT = "_trigger";
  var SETTINGS_TRIGGER_MIN_SCORE = 4;
  var TRIGGER_LABEL_RE = /settings?|preferences|设置|偏好/i;
  var FOREIGN_WIDGET_RE = /(^|[-_\s])(cost|usage|billing|pet|whale|meter|stats?)([-_\s]|$)/i;
  function isSettingsDialogOpen(doc) {
    return Boolean(doc?.querySelector?.(SETTINGS_DIALOG_SELECTOR));
  }
  function scoreSettingsTrigger(signals = {}) {
    const own = String(signals.className ?? "");
    const ancestors = Array.isArray(signals.ancestorClasses) ? signals.ancestorClasses.join(" ") : "";
    if (FOREIGN_WIDGET_RE.test(own) || FOREIGN_WIDGET_RE.test(ancestors)) return -100;
    if (signals.inDialog) return -100;
    let score = 0;
    if (ancestors.includes(SETTINGS_AREA_HINT)) score += 5;
    if (TRIGGER_LABEL_RE.test(String(signals.ariaLabel ?? ""))) score += 4;
    if (own.includes(SETTINGS_TRIGGER_CLASS_HINT)) score += 2;
    if (signals.hasPopup) score += 1;
    return score;
  }
  function signalsOf(el) {
    const chain = [];
    let node = el?.parentElement ?? null;
    for (let i = 0; node && i < 8; i += 1) {
      chain.push(String(node.className ?? ""));
      node = node.parentElement ?? null;
    }
    return {
      ariaLabel: el?.getAttribute?.("aria-label") ?? "",
      className: String(el?.className ?? el?.getAttribute?.("class") ?? ""),
      ancestorClasses: chain,
      inDialog: typeof el?.closest === "function" ? Boolean(el.closest('[role="dialog"]')) : false,
      hasPopup: el?.getAttribute?.("aria-haspopup") === "dialog"
    };
  }
  function candidatesOf(doc) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const selector of ['button[aria-haspopup="dialog"]', "button[aria-expanded]"]) {
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
  function findSettingsTrigger(doc) {
    if (!doc?.querySelector) return null;
    let best = null;
    for (const candidate of candidatesOf(doc)) {
      if (candidate.score < SETTINGS_TRIGGER_MIN_SCORE) continue;
      if (!best || candidate.score > best.score) best = candidate;
    }
    return best?.el ?? null;
  }
  function focusOwnSection(doc, win) {
    const view = win || doc?.defaultView || (typeof window === "undefined" ? null : window);
    const hook = view?.[SECTION_FOCUS_HOOK];
    if (typeof hook === "function") {
      try {
        if (hook()) return isOwnRowActive(doc, view) ? "active" : "clicked";
      } catch {
      }
    }
    const row = ownRowOf(doc, view);
    if (!row) return "none";
    if (String(row.getAttribute?.("aria-current")) === "true") return "active";
    try {
      row.click();
    } catch {
      return "none";
    }
    return isOwnRowActive(doc, view) ? "active" : "clicked";
  }
  function isOwnRowActive(doc, win) {
    const active = doc?.querySelector?.(ACTIVE_ROW_SELECTOR);
    if (!active) return false;
    if (active.hasAttribute?.(OWN_SECTION_ATTR)) return true;
    const label = normalizeLabel(readOwnLabel(win));
    return label.length > 0 && normalizeLabel(active.textContent) === label;
  }
  function normalizeLabel(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }
  function readOwnLabel(win) {
    const view = win || (typeof window === "undefined" ? null : window);
    const source = view?.[SECTION_LABEL_HOOK];
    if (typeof source === "function") {
      try {
        return source();
      } catch {
        return "";
      }
    }
    return source ?? "";
  }
  function ownRowOf(doc, win) {
    const marked = doc?.querySelector?.(OWN_SECTION_SELECTOR);
    if (marked) return marked;
    if (typeof doc?.querySelectorAll !== "function") return null;
    const label = normalizeLabel(readOwnLabel(win));
    if (label.length === 0) return null;
    for (const row of doc.querySelectorAll(NAV_ROW_SELECTOR)) {
      const text = normalizeLabel(row?.textContent);
      if (text === label || text.length > 0 && (text.includes(label) || label.includes(text))) return row;
    }
    return null;
  }
  function describeSettingsNav(doc, win) {
    const view = win || (typeof window === "undefined" ? null : window);
    const rows = [];
    try {
      for (const row of doc?.querySelectorAll?.(NAV_ROW_SELECTOR) ?? []) {
        const text = normalizeLabel(row?.textContent);
        if (text.length > 0) rows.push(text);
      }
    } catch {
    }
    return {
      dialogOpen: isSettingsDialogOpen(doc),
      ownLabel: normalizeLabel(readOwnLabel(view)),
      hasFocusHook: typeof view?.[SECTION_FOCUS_HOOK] === "function",
      hasLabelHook: view?.[SECTION_LABEL_HOOK] != null,
      marked: Boolean(doc?.querySelector?.(OWN_SECTION_SELECTOR)),
      activeLabel: normalizeLabel(doc?.querySelector?.(ACTIVE_ROW_SELECTOR)?.textContent),
      rows
    };
  }
  function undoMisclick(trigger) {
    try {
      if (String(trigger?.getAttribute?.("aria-expanded")) !== "true") return;
      let node = trigger;
      for (let i = 0; node && i < 8; i += 1) {
        if (String(node.className ?? "").includes(SETTINGS_AREA_HINT)) return;
        node = node.parentElement ?? null;
      }
      trigger.click();
    } catch {
    }
  }
  function openSettingsPage(doc, opts = {}) {
    if (!doc?.querySelector) return "no-trigger";
    const win = opts.win || doc.defaultView || null;
    const focusOwn = opts.focusOwnSection !== false;
    const onFail = typeof opts.onFail === "function" ? opts.onFail : null;
    const alreadyOpen = isSettingsDialogOpen(doc);
    let trigger = null;
    if (!alreadyOpen) {
      trigger = findSettingsTrigger(doc);
      if (!trigger) return "no-trigger";
      try {
        if (focusOwn && win) win[SECTION_WANT_FLAG] = true;
      } catch {
      }
      try {
        trigger.click();
      } catch {
        return "no-trigger";
      }
    }
    const result = alreadyOpen ? "already-open" : "clicked";
    if (!win || typeof win.setTimeout !== "function") {
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
        const verdict = info.activeLabel.length > 0;
        if (verdict && info.ownLabel.length > 0 && info.activeLabel === info.ownLabel) {
          focused = true;
        } else {
          if (clicks < maxClicks) {
            const state = focusOwnSection(doc, win);
            if (state !== "none") clicks += 1;
            if (state === "active") focused = true;
          }
          if (!verdict && clicks > 0) focused = true;
        }
      }
      if (open && (!focusOwn || focused)) return;
      if (--left > 0) {
        win.setTimeout(tick, interval);
        return;
      }
      if (open) {
        try {
          win[SECTION_WANT_FLAG] = false;
        } catch {
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
    }
    return result;
  }

  // src/ball.js
  var BALL_SIZE = 48;
  var SNAP_RATIO = 0.25;
  var CLICK_SQ = 9;
  var STORE_KEY = "dspack-ball-pos";
  var DEFAULT_OFFSET = 24;
  function clamp(v, min, max) {
    const n = Number(v);
    if (!Number.isFinite(n)) return min;
    return n < min ? min : n > max ? max : n;
  }
  function viewportOf(w, h) {
    return { w: Math.max(0, Number(w) || 0), h: Math.max(0, Number(h) || 0) };
  }
  function decideSnap(rect, vp) {
    const cx = (Number(rect?.left) || 0) + (Number(rect?.w) || 0) / 2;
    const cy = (Number(rect?.top) || 0) + (Number(rect?.h) || 0) / 2;
    let h = null;
    let v = null;
    if (cx < vp.w * SNAP_RATIO) h = "left";
    else if (cx > vp.w * (1 - SNAP_RATIO)) h = "right";
    if (cy < vp.h * SNAP_RATIO) v = "top";
    else if (cy > vp.h * (1 - SNAP_RATIO)) v = "bottom";
    return { h, v };
  }
  function anchorFrom(rect, vp, snap) {
    const left = Number(rect?.left) || 0;
    const top = Number(rect?.top) || 0;
    const w = Number(rect?.w) || 0;
    const h = Number(rect?.h) || 0;
    return {
      h: snap?.h ?? null,
      v: snap?.v ?? null,
      hOff: Math.max(0, snap?.h === "right" ? vp.w - (left + w) : left),
      vOff: Math.max(0, snap?.v === "bottom" ? vp.h - (top + h) : top)
    };
  }
  function positionFrom(anchor, size, vp) {
    const sw = Number(size?.w) || 0;
    const sh = Number(size?.h) || 0;
    const maxL = Math.max(0, vp.w - sw);
    const maxT = Math.max(0, vp.h - sh);
    const hOff = Math.max(0, Number(anchor?.hOff) || 0);
    const vOff = Math.max(0, Number(anchor?.vOff) || 0);
    const rawLeft = anchor?.h === "right" ? vp.w - sw - hOff : hOff;
    const rawTop = anchor?.v === "bottom" ? vp.h - sh - vOff : vOff;
    return {
      left: clamp(rawLeft, 0, maxL),
      top: clamp(rawTop, 0, maxT),
      hOff,
      vOff
    };
  }
  function defaultAnchor() {
    return { h: "right", v: "bottom", hOff: DEFAULT_OFFSET, vOff: DEFAULT_OFFSET };
  }
  var H_VALUES = /* @__PURE__ */ new Set(["left", "right"]);
  var V_VALUES = /* @__PURE__ */ new Set(["top", "bottom"]);
  function normalizeStored(raw, vp = null) {
    let parsed = null;
    try {
      parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      return defaultAnchor();
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return defaultAnchor();
    if (!("h" in parsed) && !("v" in parsed) && !("hOff" in parsed) && !("vOff" in parsed)) return defaultAnchor();
    const h = H_VALUES.has(parsed.h) ? parsed.h : null;
    const v = V_VALUES.has(parsed.v) ? parsed.v : null;
    const hOff = Number.isFinite(Number(parsed.hOff)) ? Math.max(0, Number(parsed.hOff)) : DEFAULT_OFFSET;
    const vOff = Number.isFinite(Number(parsed.vOff)) ? Math.max(0, Number(parsed.vOff)) : DEFAULT_OFFSET;
    const anchor = { h, v, hOff, vOff };
    if (vp && vp.w > 0 && vp.h > 0) {
      const pos = positionFrom(anchor, { w: BALL_SIZE, h: BALL_SIZE }, vp);
      return anchorFrom({ left: pos.left, top: pos.top, w: BALL_SIZE, h: BALL_SIZE }, vp, { h, v });
    }
    return anchor;
  }
  function serializeAnchor(anchor) {
    return JSON.stringify({
      h: anchor?.h ?? null,
      v: anchor?.v ?? null,
      hOff: Math.max(0, Number(anchor?.hOff) || 0),
      vOff: Math.max(0, Number(anchor?.vOff) || 0)
    });
  }
  var BALL_SVG = [
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"',
    ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">',
    '<path d="M3.5 6.5h17v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
    '<path d="M3.5 6.5V5.2a1.7 1.7 0 0 1 1.7-1.7h4.4l1.6 2.2"/>',
    '<path d="M12 9.5v7"/>',
    '<path d="M10.4 11.1h3.2M10.4 13h3.2M10.4 14.9h3.2"/>',
    "</svg>"
  ].join("");
  var BALL_CSS = [
    // 外层防御：宿主皮肤会按几何特征（position:fixed + 高 z-index）给元素套背景/边框/阴影/滤镜，
    // 关键属性全部 !important 顶回去（鲸鱼挂件 issue #133 的同类问题）。
    "#dspack-ball{position:fixed;box-sizing:border-box;width:48px;height:48px;border-radius:50%;",
    "display:flex;align-items:center;justify-content:center;cursor:grab;",
    "user-select:none;-webkit-user-select:none;touch-action:none;z-index:99999;color:#fff;",
    "background:linear-gradient(145deg,#4d6bfe,#203170) !important;",
    "border:2px solid rgba(255,255,255,.86) !important;",
    "box-shadow:0 6px 18px rgba(15,23,42,.34) !important;",
    "backdrop-filter:none !important;-webkit-backdrop-filter:none !important;",
    "transition:left .18s ease,top .18s ease,transform .18s ease}",
    "#dspack-ball::before,#dspack-ball::after{content:none !important}",
    "#dspack-ball.dspack-ball-dragging{cursor:grabbing;transition:none}",
    "#dspack-ball:active{transform:scale(.92)}",
    "#dspack-ball svg{width:26px;height:26px;display:block;pointer-events:none}",
    // 贴左时整体镜像（朝屏幕内），图标再反向镜像一次保持可读
    "#dspack-ball.dspack-ball-left{transform:scaleX(-1)}",
    "#dspack-ball.dspack-ball-left svg{transform:scaleX(-1)}",
    "#dspack-ball-tip{position:fixed;box-sizing:border-box;max-width:min(320px,calc(100vw - 24px));",
    "padding:8px 12px;border-radius:8px;background:rgba(15,23,42,.92);color:#fff;",
    'font:12px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;z-index:100000;pointer-events:none;',
    "box-shadow:0 6px 18px rgba(15,23,42,.3)}"
  ].join("");
  function safeStorage(win, key) {
    try {
      const ls = win?.localStorage;
      if (!ls) return null;
      return {
        get: () => {
          try {
            return ls.getItem(key);
          } catch {
            return null;
          }
        },
        set: (v) => {
          try {
            ls.setItem(key, v);
          } catch {
          }
        }
      };
    } catch {
      return null;
    }
  }
  function mountBall(opts = {}) {
    const win = opts.win || (typeof window === "undefined" ? null : window);
    const doc = opts.doc || win && win.document || null;
    if (!win || !doc) return null;
    if (win.__dspackBall) return win.__dspackBall;
    const size = Number(opts.size) || BALL_SIZE;
    const store = safeStorage(win, opts.storeKey || STORE_KEY);
    const mount = () => {
      if (win.__dspackBall) return win.__dspackBall;
      const style = doc.createElement("style");
      style.id = "dspack-ball-style";
      style.textContent = BALL_CSS;
      (doc.head || doc.documentElement).appendChild(style);
      const root = doc.createElement("div");
      root.id = "dspack-ball";
      root.setAttribute("role", "button");
      root.setAttribute("tabindex", "0");
      root.setAttribute("title", opts.title || "\u6253\u5F00\u8BBE\u7F6E \xB7 DSH PackForge");
      root.innerHTML = BALL_SVG;
      const state = normalizeStored(store ? store.get() : null);
      let drag = null;
      let tip = null;
      let tipTimer = 0;
      let action = null;
      const viewport = () => viewportOf(win.innerWidth || doc.documentElement.clientWidth, win.innerHeight || doc.documentElement.clientHeight);
      const initial = positionFrom(state, { w: size, h: size }, viewport());
      state.hOff = initial.hOff;
      state.vOff = initial.vOff;
      root.style.left = `${initial.left}px`;
      root.style.top = `${initial.top}px`;
      function express() {
        root.style.left = `${state.left}px`;
        root.style.top = `${state.top}px`;
        root.classList.toggle("dspack-ball-left", state.h === "left");
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
        if (tip) {
          try {
            tip.remove();
          } catch {
          }
        }
        tip = doc.createElement("div");
        tip.id = "dspack-ball-tip";
        tip.textContent = text;
        doc.body.appendChild(tip);
        const below = state.top + size + 8 + 40 < vp.h;
        tip.style.left = `${clamp(state.left - 40, 8, Math.max(8, vp.w - 200))}px`;
        tip.style.top = `${below ? state.top + size + 8 : Math.max(8, state.top - 44)}px`;
        if (tipTimer) win.clearTimeout(tipTimer);
        tipTimer = win.setTimeout(() => {
          if (tip) {
            try {
              tip.remove();
            } catch {
            }
          }
          tip = null;
        }, 2600);
      }
      function focusFailTip() {
        const info = describeSettingsNav(doc, win);
        try {
          console.info("[dspack] \u60AC\u6D6E\u7403\u5207\u5206\u533A\u5931\u8D25\uFF0C\u8BCA\u65AD\uFF1A", info);
        } catch {
        }
        const label = info.ownLabel || "\u6574\u5408\u5305";
        const rows = info.rows.join(" / ") || "\uFF08\u6CA1\u8BFB\u5230\u5BFC\u822A\uFF09";
        return `\u8BBE\u7F6E\u5DF2\u6253\u5F00\uFF0C\u8BF7\u5728\u5DE6\u4FA7\u9009\u300C${label}\u300D\uFF1B\u6211\u770B\u5230\u7684\u5BFC\u822A\uFF1A${rows}`;
      }
      function openSettings() {
        const result = openSettingsPage(doc, {
          win,
          // 轮询校验没通过（没弹出设置弹窗）才提示：点错/被拦/真的没有入口，都算失败。
          onFail: () => showTip(opts.noTriggerTip || "\u6CA1\u627E\u5230\u5B98\u65B9\u8BBE\u7F6E\u5165\u53E3\uFF1A\u4FA7\u8FB9\u680F/\u8BBE\u7F6E\u90A3\u68F5\u53EF\u80FD\u5DF2\u4E0D\u53EF\u7528"),
          // 弹窗开了但没切过去：明确指路，别把人晾在别人的分区上。
          onFocusFail: () => showTip(opts.focusFailTip || focusFailTip())
        });
        if (result === "no-trigger") {
          showTip(opts.noTriggerTip || "\u6CA1\u627E\u5230\u5B98\u65B9\u8BBE\u7F6E\u5165\u53E3\uFF1A\u4FA7\u8FB9\u680F/\u8BBE\u7F6E\u90A3\u68F5\u53EF\u80FD\u5DF2\u4E0D\u53EF\u7528");
        }
        return result;
      }
      function fireClick() {
        try {
          win.dispatchEvent(new win.CustomEvent("dspack/ball-click", { detail: { api: api2 } }));
        } catch {
        }
        const run = typeof opts.onClick === "function" ? opts.onClick : action;
        if (typeof run === "function") {
          try {
            run(api2);
          } catch {
          }
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
        doc.removeEventListener("pointermove", onMove, true);
        doc.removeEventListener("pointerup", onUp, true);
        doc.removeEventListener("pointercancel", onCancel, true);
      }
      function end(clickable) {
        if (!drag) return;
        const moved = drag.moved;
        drag = null;
        root.classList.remove("dspack-ball-dragging");
        detach();
        const vp = viewport();
        const rect = { left: state.left, top: state.top, w: size, h: size };
        Object.assign(state, anchorFrom(rect, vp, decideSnap(rect, vp)));
        settle();
        save();
        if (clickable && !moved) fireClick();
      }
      function onUp() {
        end(true);
      }
      function onCancel() {
        end(false);
      }
      function onDown(e) {
        if (drag) return;
        if (e?.pointerType === "mouse" && e.button !== 0) return;
        drag = { startX: Number(e.clientX) || 0, startY: Number(e.clientY) || 0, origLeft: state.left, origTop: state.top, moved: false };
        root.classList.add("dspack-ball-dragging");
        try {
          e.preventDefault();
          e.stopPropagation();
        } catch {
        }
        doc.addEventListener("pointermove", onMove, true);
        doc.addEventListener("pointerup", onUp, true);
        doc.addEventListener("pointercancel", onCancel, true);
      }
      function onKeyDown(e) {
        if (e.key !== "Enter" && e.key !== " ") return;
        try {
          e.preventDefault();
        } catch {
        }
        fireClick();
      }
      const onResize = () => settle();
      root.addEventListener("pointerdown", onDown);
      root.addEventListener("keydown", onKeyDown);
      root.addEventListener("click", (e) => {
        try {
          e.stopPropagation();
        } catch {
        }
      });
      win.addEventListener("resize", onResize);
      doc.body.appendChild(root);
      settle();
      save();
      const api2 = {
        root,
        state,
        size,
        showTip,
        click: fireClick,
        openSettings,
        setAction(fn) {
          action = typeof fn === "function" ? fn : null;
          return api2;
        },
        settle,
        viewport,
        /** 诊断：设置导航长什么样、钩子/标记在不在（排查「点了没切过去」时用）。 */
        diag: () => describeSettingsNav(doc, win),
        destroy() {
          win.removeEventListener("resize", onResize);
          detach();
          if (tipTimer) win.clearTimeout(tipTimer);
          try {
            root.remove();
          } catch {
          }
          try {
            style.remove();
          } catch {
          }
          win.__dspackBall = null;
        }
      };
      return api2;
    };
    const body = doc.body;
    if (!body) {
      doc.addEventListener("DOMContentLoaded", () => {
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

  // src/ball-entry.js
  mountBall();
})();
