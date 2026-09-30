window.__ModuleLoader__.load({
  id: "@dsh-packforge/dsh-pack-plugin",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.js
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(client_exports);

// src/settings.js
var import_react = require("react");

// src/channel.js
var CHANNEL = "/dsh-pack";
var PROFILE_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
var RESERVED_PROFILE_NAMES = ["desktop", "default"];

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

// src/settings-nav-icon.js
var NAV_ICON_MARKER = "data-dspack-nav-icon";
var NAV_ROW_SELECTOR2 = '[role="dialog"] nav button';
var NAV_ICON_SIZE = 16;
function navIconMaskSvg(path, viewBox = "0 0 1024 1024") {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="#000"><path d="${path}"/></svg>`;
}
function navIconMaskUrl(svg) {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
function isOwnNavRow(rowText, wantedLabel) {
  const wanted = String(wantedLabel ?? "").trim();
  if (wanted.length === 0) return false;
  return String(rowText ?? "").trim() === wanted;
}
function navIconCss(maskUrl) {
  return [
    `[${NAV_ICON_MARKER}] > svg { display: none; }`,
    `[${NAV_ICON_MARKER}]::before {`,
    `  content: '';`,
    `  flex: none;`,
    `  width: ${NAV_ICON_SIZE}px;`,
    `  height: ${NAV_ICON_SIZE}px;`,
    `  background-color: currentColor;`,
    `  -webkit-mask-image: url("${maskUrl}");`,
    `  mask-image: url("${maskUrl}");`,
    `  -webkit-mask-repeat: no-repeat;`,
    `  mask-repeat: no-repeat;`,
    `  -webkit-mask-position: center;`,
    `  mask-position: center;`,
    `  -webkit-mask-size: ${NAV_ICON_SIZE}px ${NAV_ICON_SIZE}px;`,
    `  mask-size: ${NAV_ICON_SIZE}px ${NAV_ICON_SIZE}px;`,
    `}`
  ].join("\n");
}
function installSettingsNavIcon(ctx, resolveLabel, maskUrl) {
  if (typeof document === "undefined") return;
  if (!ctx || typeof ctx.effect !== "function") return;
  ctx.effect(() => {
    const tag = document.createElement("style");
    tag.dataset.plugin = "dsh-packforge";
    tag.dataset.pluginCss = "dsh-packforge/settings-nav-icon";
    tag.textContent = navIconCss(maskUrl);
    document.head.appendChild(tag);
    let disposed = false;
    let scheduled = false;
    const sync = () => {
      scheduled = false;
      if (disposed) return;
      const wanted = resolveLabel();
      for (const row of document.querySelectorAll(NAV_ROW_SELECTOR2)) {
        if (isOwnNavRow(row.textContent, wanted)) row.setAttribute(NAV_ICON_MARKER, "");
        else row.removeAttribute(NAV_ICON_MARKER);
      }
      if (window[SECTION_WANT_FLAG] === true) {
        const wantedText = String(wanted ?? "").trim();
        if (wantedText.length > 0) {
          for (const row of document.querySelectorAll(NAV_ROW_SELECTOR2)) {
            if (!isOwnNavRow(row.textContent, wantedText)) continue;
            window[SECTION_WANT_FLAG] = false;
            row.click();
            break;
          }
        }
      }
    };
    const schedule = () => {
      if (scheduled || disposed) return;
      scheduled = true;
      queueMicrotask(sync);
    };
    sync();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      disposed = true;
      observer.disconnect();
      for (const row of document.querySelectorAll(`[${NAV_ICON_MARKER}]`)) row.removeAttribute(NAV_ICON_MARKER);
      tag.remove();
    };
  }, "dsh-packforge: settings nav icon");
}
function installSectionFocusHook(ctx, resolveLabel) {
  if (typeof document === "undefined" || typeof window === "undefined") return false;
  const focus = () => {
    const wanted = String(resolveLabel?.() ?? "").trim();
    if (wanted.length === 0) return false;
    for (const row of document.querySelectorAll(NAV_ROW_SELECTOR2)) {
      if (!isOwnNavRow(row.textContent, wanted)) continue;
      row.click();
      return true;
    }
    return false;
  };
  const previous = window[SECTION_FOCUS_HOOK] ?? null;
  window[SECTION_FOCUS_HOOK] = focus;
  const previousLabel = window[SECTION_LABEL_HOOK] ?? null;
  window[SECTION_LABEL_HOOK] = () => String(resolveLabel?.() ?? "");
  if (ctx && typeof ctx.effect === "function") {
    ctx.effect(() => () => {
      if (window[SECTION_FOCUS_HOOK] === focus) window[SECTION_FOCUS_HOOK] = previous;
      if (window[SECTION_LABEL_HOOK] !== null && typeof window[SECTION_LABEL_HOOK] === "function") {
        window[SECTION_LABEL_HOOK] = previousLabel;
      }
    }, "dsh-packforge: section focus hook");
  }
  return true;
}

// src/section-gate.js
function createSectionGate(register) {
  let ready = false;
  let removed = false;
  let dispose = null;
  const apply2 = () => {
    if (!ready) return;
    const shouldShow = !removed;
    if (shouldShow && dispose === null) {
      dispose = register();
      return;
    }
    if (!shouldShow && dispose !== null) {
      const stop = dispose;
      dispose = null;
      stop();
    }
  };
  return {
    /** slots 服务已就位（inject 回调触发）。幂等：重复调用不会二次 register。 */
    available: () => {
      ready = true;
      apply2();
    },
    /** 当前入口是否已注册。 */
    visible: () => dispose !== null,
    /** 本包被移除：永久注销，后续任何 available 都不再复活。 */
    retire: () => {
      removed = true;
      apply2();
    }
  };
}

// src/settings.js
var NS = "dspack";
var MANAGER_PKG = "@dsh-packforge/dsh-pack-plugin";
var VERSION = false ? "0.1.0" : "0.4.0";
var LOGO_PATH = "M444.330667 128l85.333333 85.333333H896a42.666667 42.666667 0 0 1 42.666667 42.666667v597.333333a42.666667 42.666667 0 0 1-42.666667 42.666667H128a42.666667 42.666667 0 0 1-42.666667-42.666667V170.666667a42.666667 42.666667 0 0 1 42.666667-42.666667h316.330667zM768 768h-170.666667v-128h85.333334v-85.333333h-85.333334v-85.333334h85.333334V384h-85.333334V298.666667h-102.997333l-85.333333-85.333334H170.666667v597.333334h682.666666V298.666667h-170.666666v85.333333h85.333333v85.333333h-85.333333v85.333334h85.333333v213.333333z";
var AUTHOR = "hxh230802";
var AUTHOR_URL = "https://github.com/hxh230802";
var REPO_URL = "https://github.com/DSH-PackForge/dsh-pack-plugin";
var NPM_URL = "https://www.npmjs.com/package/@dsh-packforge/dsh-pack-plugin";
var SPEC_URL = "https://github.com/DSH-PackForge/DSH-PackForge";
var APP_URL = "https://github.com/DSH-PackForge/dsh-packforge-app";
var MARKET_URL = "https://github.com/DSH-PackForge/dsh-pack-market";
var dict = {
  zh: {
    nav: "\u6574\u5408\u5305",
    "tab.manage": "\u7BA1\u7406",
    "tab.export": "\u5BFC\u51FA",
    "tab.market": "\u5E02\u573A",
    "running.title": "\u6B63\u5728\u8FD0\u884C\u7684\u6574\u5408\u5305",
    "running.profile": "profile\u540D\uFF1A",
    "action.openDir": "\u6253\u5F00\u76EE\u5F55",
    "create.title": "\u521B\u5EFA\u6574\u5408\u5305",
    "action.newEmpty": "\u7A7A\u6574\u5408\u5305",
    "action.import": "\u5BFC\u5165\u65B0\u5305",
    "action.market": "\u6D4F\u89C8\u5E02\u573A",
    "action.refresh": "\u5237\u65B0",
    "action.tasks": "\u4EFB\u52A1\u4E2D\u5FC3",
    "tasks.empty": "\u6682\u65E0\u4EFB\u52A1",
    "tasks.close": "\u5173\u95ED",
    "installed.title": "\u5DF2\u5B89\u88C5\u7684\u6574\u5408\u5305",
    "action.delete": "\u5220\u9664",
    "hint.restart": "\u70B9\u5207\u6362\u540E\u91CD\u542F\u751F\u6548",
    "group.meta": "\u5143\u6570\u636E\uFF08\u7559\u7A7A\u7528 profile \u9ED8\u8BA4\uFF09",
    "group.output": "\u8F93\u51FA",
    "field.name": "\u6574\u5408\u5305\u540D",
    "field.version": "\u7248\u672C",
    "field.displayName": "\u5C55\u793A\u540D",
    "field.description": "\u63CF\u8FF0",
    "field.author": "\u4F5C\u8005",
    "field.icon": "\u56FE\u6807 URL",
    "field.dshVersion": "DSH \u7248\u672C\uFF08\u7559\u7A7A\u53D6\u6700\u65B0\u5DF2\u88C5\uFF09",
    "field.out": "\u8F93\u51FA\u76EE\u5F55\uFF08\u7559\u7A7A\u7528\u5F53\u524D\u76EE\u5F55\uFF09",
    "field.profile": "\u5BFC\u51FA profile\uFF08\u9ED8\u8BA4\u5F53\u524D\uFF09",
    "field.source": ".dspack \u8DEF\u5F84\u6216 URL",
    "field.newName": "\u65B0 profile \u540D",
    "action.export": "\u5BFC\u51FA",
    "action.quickExport": "\u5FEB\u6377\u5BFC\u51FA",
    "action.upload": "\u4E0A\u4F20\u5230 GitHub",
    "upload.hint": "\u5148\u5BFC\u51FA\uFF0C\u518D\u70B9\u6B64\u5207\u56DE\u804A\u5929\u6846\u8BA9 AI \u5E2E\u4F60\u53D1 Release",
    "upload.sent": "\u5DF2\u5207\u56DE\u804A\u5929\u6846\uFF0CAI \u63A5\u624B\u4E0A\u4F20",
    "upload.failed": "\u53D1\u9001\u5931\u8D25",
    "upload.noService": "\u804A\u5929\u670D\u52A1\u4E0D\u53EF\u7528\uFF08DSH \u7248\u672C\u8FC7\u4F4E\uFF09",
    "action.install": "\u5B89\u88C5",
    "action.switch": "\u5207\u6362",
    "action.create": "\u65B0\u5EFA",
    "action.save": "\u4FDD\u5B58",
    "action.load": "\u8BFB\u53D6",
    "field.profileName": "\u5B89\u88C5\u540D\uFF08\u8986\u76D6 manifest profileName\uFF09",
    "field.mode": "\u5BFC\u51FA\u5F62\u6001",
    "mode.dspack": "\u5355\u6587\u4EF6\uFF08.dspack\uFF09",
    "mode.repo": "\u6E90\u4ED3\u5E93",
    "field.content": "\u4ED3\u5E93\u5185\u5BB9\u6863",
    "content.manifest": "\u4EC5\u6E05\u5355\uFF08manifest.json\uFF09",
    "content.readme": "\u6E05\u5355 + README",
    "content.full": "\u5168\u5957\u6587\u4EF6\uFF08overrides/ + release/\uFF09",
    // 基线已取消离线包：内嵌依赖（离线分发）相关文案整块移除，仅保留兼容性徽标文案。
    "compat.title": "\u517C\u5BB9\u6027\uFF08v5 r2\uFF09",
    "compat.dshVersions": "\u517C\u5BB9 DSH \u7248\u672C\u96C6\uFF08dshVersions\uFF09",
    "compat.dshVersionsHint": "\u9017\u53F7\u5206\u9694\u7684\u5B9E\u6D4B\u517C\u5BB9\u7248\u672C\u679A\u4E3E\uFF08\u5982 0.1.1-rc.2, 0.1.0\uFF09\uFF1B\u300CDSH \u7248\u672C\u300D\u5FC5\u987B\u5305\u542B\u5728\u5185\uFF1B\u7559\u7A7A = \u4EC5\u6309 dshVersion",
    "compat.launchers": "\u542F\u52A8\u5668\u517C\u5BB9\u58F0\u660E\uFF08launchers\uFF09",
    "launcher.none": "\u672A\u58F0\u660E",
    "launcher.support": "\u652F\u6301",
    "launcher.conflict": "\u51B2\u7A81",
    "launcher.minVersion": "\u6700\u4F4E\u7248\u672C\uFF08\u53EF\u9009\uFF09",
    "launcher.reason": "\u51B2\u7A81\u539F\u56E0\uFF08\u5EFA\u8BAE\u586B\u5199\uFF09",
    "group.content": "\u5BFC\u51FA\u5185\u5BB9\uFF08\u4E0A\u4E00\u7EA7\u76EE\u5F55\u5F00\u5173\uFF09",
    "content.skill": "\u5BFC\u51FA skills/",
    "content.preset": "\u5BFC\u51FA .agent-presets/",
    "content.instruction": "\u5BFC\u51FA AGENTS.md",
    "result.saved": "\u5DF2\u4FDD\u5B58\u5DE5\u4F5C\u533A\u914D\u7F6E",
    "result.loaded": "\u5DF2\u8BFB\u53D6\u5DE5\u4F5C\u533A\u914D\u7F6E",
    "result.noCfg": "\u8BE5 profile \u6682\u65E0\u5DF2\u4FDD\u5B58\u7684\u5DE5\u4F5C\u533A\u914D\u7F6E",
    "result.pending": "\u5904\u7406\u4E2D\u2026",
    "result.taskStarted": "\u5DF2\u52A0\u5165\u4EFB\u52A1\u4E2D\u5FC3\uFF0C\u8FDB\u5EA6\u89C1\u9762\u677F",
    "result.noRpc": "\u540E\u7AEF RPC \u4E0D\u53EF\u7528\uFF08connection \u670D\u52A1\u7F3A\u5931\uFF09",
    "err.name": "\u8BF7\u586B\u5199 profile \u540D",
    "err.source": "\u8BF7\u586B\u5199 .dspack \u8DEF\u5F84\u6216 URL",
    "err.nameInvalid": "\u540D\u5B57\u683C\u5F0F\u4E0D\u5BF9\uFF1A\u53EA\u80FD\u7528\u5C0F\u5199\u5B57\u6BCD\u3001\u6570\u5B57\u548C\u8FDE\u5B57\u7B26\uFF08\u5982 aaa-bb-c\uFF09",
    "err.nameReserved": "\u300C{name}\u300D\u662F\u4FDD\u7559\u540D\uFF0C\u4E0D\u80FD\u4F5C\u4E3A profile \u540D",
    "hint.nameFormat": "\u5C0F\u5199\u5B57\u6BCD\u3001\u6570\u5B57\uFF0C\u7528\u8FDE\u5B57\u7B26\u5206\u9694\uFF0C\u5982 aaa-bb-c",
    "hint.import": ".dspack \u6587\u4EF6\u8DEF\u5F84\u6216 URL",
    "dialog.createTitle": "\u521B\u5EFA\u7A7A\u7684\u6574\u5408\u5305",
    "dialog.importTitle": "\u5BFC\u5165\u65B0\u5305",
    "profile.active": "\u5F53\u524D",
    "market.loading": "\u52A0\u8F7D\u5E02\u573A\u4E2D\u2026",
    "market.empty": "\u5E02\u573A\u6682\u65E0\u5185\u5BB9",
    "market.error": "\u5E02\u573A\u52A0\u8F7D\u5931\u8D25",
    "market.none": "\uFF08\u65E0\uFF09",
    "market.detail": "\u8BE6\u60C5",
    "market.detailTitle": "\u6574\u5408\u5305\u8BE6\u60C5",
    "market.launcherRestricted": "\u542F\u52A8\u5668\u9650\u5236",
    "market.r2.launcherRequire": "\u9700\u542F\u52A8\u5668 {id} \u2265 {ver}",
    "market.r2.launcherConflict": "\u4E0D\u652F\u6301\u5728 {id} \u4E0A\u8FD0\u884C\uFF1A{reason}",
    "market.r2.noReason": "\u672A\u63D0\u4F9B\u539F\u56E0",
    "market.r2.dshVersions": "\u517C\u5BB9 DSH \u7248\u672C\uFF1A{versions}",
    // 基线已取消离线包：徽标兜底文案不再提「内嵌依赖」（该徽标随基线一并移除）。
    "market.r2.none": "\u65E0\u542F\u52A8\u5668\u517C\u5BB9\u9650\u5236",
    "installConfirm.title": "\u5B89\u88C5\u786E\u8BA4",
    "installConfirm.hint": "\u8BE5\u6574\u5408\u5305\u7684\u542F\u52A8\u5668\u517C\u5BB9\u58F0\u660E\u5B58\u5728\u8B66\u544A\uFF0C\u786E\u8BA4\u540E\u5C06\u7167\u5E38\u5B89\u88C5\uFF1A",
    "installConfirm.ok": "\u4ECD\u8981\u5B89\u88C5",
    "confirm.title": "\u5207\u6362 profile",
    "confirm.from": "\u5F53\u524D",
    "confirm.to": "\u76EE\u6807",
    "confirm.firstTime": "\u9996\u6B21\u5207\u6362\uFF1A\u4F1A\u628A\u5F53\u524D\u76EE\u5F55\u5B58\u6863\u4E3A default",
    "confirm.warning": "\u68C0\u6D4B\u5230\u76EE\u6807 profile \u6CA1\u6709 {pkg}\uFF0C\u9700\u8981\u5B89\u88C5\u3002\u82E5\u6CA1\u6709\u6B64\u63D2\u4EF6\uFF0C\u5C06\u65E0\u6CD5\u4ECE\u5E94\u7528\u5185\u518D\u6B21\u5207\u6362 profile\u3002",
    "confirm.cancel": "\u53D6\u6D88",
    "confirm.ok": "\u786E\u8BA4\u5207\u6362",
    "confirm.hintRestart": "\u5207\u6362\u540E\u4F1A\u81EA\u52A8\u91CD\u542F\u5BA2\u6237\u7AEF\uFF1B\u82E5\u957F\u65F6\u95F4\u672A\u81EA\u52A8\u91CD\u542F\uFF0C\u8BF7\u624B\u52A8\u62C9\u8D77\u5BA2\u6237\u7AEF\u3002",
    "confirm.managerSource": "\u76EE\u6807\u7F3A\u5C11\u63D2\u4EF6\uFF0C\u5B89\u88C5\u65B9\u5F0F\uFF1A",
    "confirm.source.copy": "\u4ECE\u5F53\u524D profile \u590D\u5236",
    "confirm.source.npm": "\u4ECE NPM \u62C9\u53D6\u6700\u65B0",
    "tab.about": "\u5173\u4E8E",
    "about.version": "\u7248\u672C",
    "about.desc": "DSH \u6574\u5408\u5305\u7BA1\u7406\u63D2\u4EF6\uFF1A.dspack \u5BFC\u51FA/\u5BFC\u5165\u3001\u591A profile \u5207\u6362\uFF0C\u96F6\u5B98\u65B9\u6E90\u7801\u6539\u52A8\u3002",
    "about.philosophy": "\u6574\u5408\u2014\u2014\u5305\u7F57\u4E07\u8C61",
    "about.author": "\u4F5C\u8005",
    "about.repo": "\u4ED3\u5E93",
    "about.star": "\u6C42 Star",
    "about.checkUpdate": "\u68C0\u67E5\u66F4\u65B0",
    "about.checking": "\u68C0\u67E5\u4E2D\u2026",
    "about.upToDate": "\u5DF2\u662F\u6700\u65B0\u7248\u672C",
    "about.newVersion": "\u6709\u65B0\u7248\u672C {latest}\uFF08\u5F53\u524D {current}\uFF09",
    "about.checkFailed": "\u68C0\u67E5\u66F4\u65B0\u5931\u8D25",
    "about.viewNpm": "\u5728 npm \u67E5\u770B",
    "about.ecosystem": "\u751F\u6001",
    "about.ecosystem.spec": "\u7406\u5FF5\u53CA\u89C4\u8303",
    "about.ecosystem.app": "\u5305\u7BA1\u7406\u5668",
    "about.ecosystem.market": "\u5E02\u573A",
    "group.network": "\u7F51\u7EDC",
    "field.proxyMode": "\u4EE3\u7406\u6A21\u5F0F",
    "proxyMode.auto": "\u81EA\u52A8\uFF08\u8DDF\u968F\u7CFB\u7EDF\u4EE3\u7406\uFF09",
    "proxyMode.direct": "\u76F4\u8FDE\uFF08\u4E0D\u4F7F\u7528\u4EE3\u7406\uFF09",
    "proxyMode.manual": "\u624B\u52A8\u6307\u5B9A\u4EE3\u7406",
    "field.proxy": "\u4EE3\u7406\u5730\u5740",
    "hint.proxy": "\u81EA\u52A8\u6A21\u5F0F\u56DE\u843D\u73AF\u5883\u53D8\u91CF\uFF08HTTP_PROXY / HTTPS_PROXY / ALL_PROXY / NO_PROXY\uFF09\u4E0E Windows \u7CFB\u7EDF\u4EE3\u7406\uFF1B\u624B\u52A8\u652F\u6301 http / https / socks / socks5\uFF0C\u5982 http://127.0.0.1:7890",
    "result.proxySaved": "\u5DF2\u4FDD\u5B58\u4EE3\u7406\u8BBE\u7F6E\uFF08\u7ACB\u5373\u751F\u6548\uFF09",
    "about.copyright": "\xA9 2026 DSH-PackForge contributors \xB7 MIT License"
  },
  en: {
    nav: "Modpacks",
    "tab.manage": "Manage",
    "tab.export": "Export",
    "tab.market": "Market",
    "running.title": "Running modpack",
    "running.profile": "profile: ",
    "action.openDir": "Open folder",
    "create.title": "Create modpack",
    "action.newEmpty": "Empty pack",
    "action.import": "Import pack",
    "action.market": "Browse market",
    "action.refresh": "Refresh",
    "action.tasks": "Task Center",
    "tasks.empty": "No tasks",
    "tasks.close": "Close",
    "installed.title": "Installed modpacks",
    "action.delete": "Delete",
    "hint.restart": "Takes effect after restart",
    "group.meta": "Metadata (blank = profile default)",
    "group.output": "Output",
    "field.name": "Pack name",
    "field.version": "Version",
    "field.displayName": "Display name",
    "field.description": "Description",
    "field.author": "Author",
    "field.icon": "Icon URL",
    "field.dshVersion": "DSH version (blank = latest)",
    "field.out": "Output dir (blank = current)",
    "field.profile": "Profile to export (default: active)",
    "field.source": ".dspack path or URL",
    "field.newName": "New profile name",
    // 基线已取消离线包：内嵌依赖文案同样整块移除。
    "compat.title": "Compatibility (v5 r2)",
    "compat.dshVersions": "Compatible DSH versions (dshVersions)",
    "compat.dshVersionsHint": 'Comma-separated tested versions (e.g. 0.1.1-rc.2, 0.1.0); must include the "DSH version" field; blank = dshVersion only',
    "compat.launchers": "Launcher compatibility (launchers)",
    "launcher.none": "Unspecified",
    "launcher.support": "Supported",
    "launcher.conflict": "Conflict",
    "launcher.minVersion": "Min version (optional)",
    "launcher.reason": "Conflict reason (recommended)",
    "action.export": "Export",
    "action.quickExport": "Quick export",
    "action.upload": "Upload to GitHub",
    "upload.hint": "Export first, then switch to chat and let the AI publish the release",
    "upload.sent": "Switched to chat \u2014 the AI is on it",
    "upload.failed": "Send failed",
    "upload.noService": "Chat service unavailable (DSH too old)",
    "action.install": "Install",
    "action.switch": "Switch",
    "action.create": "Create",
    "result.pending": "Working\u2026",
    "result.taskStarted": "Added to task center \u2014 see the panel",
    "result.noRpc": "Backend RPC unavailable (no connection service)",
    "err.name": "Please fill a profile name",
    "err.source": "Please fill a .dspack path or URL",
    "err.nameInvalid": "Invalid name: lowercase letters, digits and hyphens only (e.g. aaa-bb-c)",
    "err.nameReserved": '"{name}" is a reserved name and cannot be used as a profile name',
    "hint.nameFormat": "Lowercase letters and digits separated by hyphens, e.g. aaa-bb-c",
    "hint.import": ".dspack file path or URL",
    "dialog.createTitle": "Create empty modpack",
    "dialog.importTitle": "Import modpack",
    "profile.active": "current",
    "market.loading": "Loading market\u2026",
    "market.empty": "Market is empty",
    "market.error": "Market load failed",
    "market.none": "(none)",
    "market.detail": "Details",
    "market.detailTitle": "Modpack details",
    "market.launcherRestricted": "launcher-restricted",
    "market.r2.launcherRequire": "Requires launcher {id} \u2265 {ver}",
    "market.r2.launcherConflict": "Not supported on {id}: {reason}",
    "market.r2.noReason": "no reason given",
    "market.r2.dshVersions": "Compatible DSH versions: {versions}",
    // 基线已取消离线包：徽标兜底文案不再提内嵌依赖。
    "market.r2.none": "No launcher restrictions",
    "installConfirm.title": "Install confirmation",
    "installConfirm.hint": "This pack has launcher-compatibility warnings. It will still be installed after you confirm:",
    "installConfirm.ok": "Install anyway",
    "confirm.title": "Switch profile",
    "confirm.from": "current",
    "confirm.to": "target",
    "confirm.firstTime": "First switch: current folder will be archived as default",
    "confirm.warning": "Target profile has no {pkg}; it must be installed. Without it you cannot switch again from inside the app.",
    "confirm.cancel": "Cancel",
    "confirm.ok": "Confirm switch",
    "confirm.hintRestart": "The client restarts automatically after switching; if it does not restart for a while, please launch it manually.",
    "confirm.managerSource": "Target profile is missing the plugin. Install via:",
    "confirm.source.copy": "Copy from current profile",
    "confirm.source.npm": "Pull latest from NPM",
    "tab.about": "About",
    "about.version": "Version",
    "about.desc": "DSH modpack plugin: .dspack export/import, multi-profile switching, zero official source changes.",
    "about.philosophy": "Integrate \u2014 embrace everything",
    "about.author": "Author",
    "about.repo": "Repository",
    "about.star": "Star on GitHub",
    "about.checkUpdate": "Check for updates",
    "about.checking": "Checking\u2026",
    "about.upToDate": "You are up to date",
    "about.newVersion": "New version {latest} (current {current})",
    "about.checkFailed": "Update check failed",
    "about.viewNpm": "View on npm",
    "about.ecosystem": "Ecosystem",
    "about.ecosystem.spec": "Philosophy & Spec",
    "about.ecosystem.app": "Package Manager",
    "about.ecosystem.market": "Market",
    "group.network": "Network",
    "field.proxyMode": "Proxy mode",
    "proxyMode.auto": "Auto (follow system proxy)",
    "proxyMode.direct": "Direct (no proxy)",
    "proxyMode.manual": "Manual proxy",
    "field.proxy": "Proxy",
    "hint.proxy": "Auto mode falls back to env vars (HTTP_PROXY / HTTPS_PROXY / ALL_PROXY / NO_PROXY) and the Windows system proxy; manual supports http / https / socks / socks5, e.g. http://127.0.0.1:7890",
    "result.proxySaved": "Proxy saved (takes effect immediately)",
    "about.copyright": "\xA9 2026 DSH-PackForge contributors \xB7 MIT License"
  }
};
function registerSettingsSection(ctx, packforge = {}) {
  const slots = ctx?.slots;
  const locale = ctx?.locale;
  if (!slots || typeof slots.inject !== "function") return false;
  if (!locale || typeof locale.register !== "function" || typeof locale.bind !== "function") return false;
  const registerLocale = () => {
    try {
      locale.register(NS, dict);
    } catch (e) {
      if (/already has locale/.test(String(e?.message ?? e))) return;
      throw e;
    }
  };
  if (typeof ctx.effect === "function") ctx.effect(registerLocale, "dspack: settings dict");
  else registerLocale();
  const t = locale.bind(NS);
  installSettingsNavIcon(ctx, () => t("nav"), navIconMaskUrl(navIconMaskSvg(LOGO_PATH)));
  installSectionFocusHook(ctx, () => t("nav"));
  const sectionGate = createSectionGate(() => {
    const off = slots.register(
      {
        name: "settings.section",
        id: "dspack",
        order: 20,
        label: () => t("nav"),
        locale: NS,
        inject: () => ({ t, packforge })
      },
      DspackSection
    );
    return typeof off === "function" ? off : () => {
    };
  });
  slots.inject("settings.section", () => {
    sectionGate.available();
  });
  return true;
}
var META_FIELDS = ["name", "version", "displayName", "description", "author", "icon", "profileName"];
var OUTPUT_FIELDS = ["dshVersion", "out"];
var MODES = ["dspack", "repo"];
var CONTENT_LEVELS = ["manifest", "readme", "full"];
var CONTENT_TOGGLES = ["skill", "preset", "instruction"];
var LAUNCHER_IDS = ["dshl", "hdsl", "dsh-packforge-app", "official-desktop", "dsh-cli"];
function DspackSection({ t, packforge }) {
  const rpc = packforge?.rpc;
  const sendToChat = packforge?.sendToChat;
  const [tab, setTab] = (0, import_react.useState)("manage");
  const [profiles, setProfiles] = (0, import_react.useState)([]);
  const [result, setResult] = (0, import_react.useState)(null);
  const [dialog, setDialog] = (0, import_react.useState)(null);
  const [newName, setNewName] = (0, import_react.useState)("");
  const [source, setSource] = (0, import_react.useState)("");
  const [fieldError, setFieldError] = (0, import_react.useState)("");
  const [submitting, setSubmitting] = (0, import_react.useState)(false);
  const [market, setMarket] = (0, import_react.useState)(null);
  const [meta, setMeta] = (0, import_react.useState)({});
  const [exportProfile, setExportProfile] = (0, import_react.useState)("");
  const [mode, setMode] = (0, import_react.useState)("dspack");
  const [contentLevel, setContentLevel] = (0, import_react.useState)("readme");
  const [exportContent, setExportContent] = (0, import_react.useState)({ skill: false, preset: false, instruction: false });
  const [loadedFor, setLoadedFor] = (0, import_react.useState)(null);
  const [dshVersionsText, setDshVersionsText] = (0, import_react.useState)("");
  const [launchersState, setLaunchersState] = (0, import_react.useState)({});
  const [installedDsh, setInstalledDsh] = (0, import_react.useState)([]);
  const [launchersReg, setLaunchersReg] = (0, import_react.useState)(null);
  const [confirm, setConfirm] = (0, import_react.useState)(null);
  const [managerSource, setManagerSource] = (0, import_react.useState)("npm");
  const [tasksOpen, setTasksOpen] = (0, import_react.useState)(false);
  const [taskList, setTaskList] = (0, import_react.useState)([]);
  const [update, setUpdate] = (0, import_react.useState)(null);
  const [proxy, setProxy] = (0, import_react.useState)("");
  const [proxyMode, setProxyMode] = (0, import_react.useState)("auto");
  const [upload, setUpload] = (0, import_react.useState)(null);
  const [installConfirm, setInstallConfirm] = (0, import_react.useState)(null);
  const [detail, setDetail] = (0, import_react.useState)(null);
  const call = async (endpoint, payload) => {
    if (!rpc) return { ok: false, error: t("result.noRpc") };
    try {
      const res = await rpc.call(endpoint, payload ?? {});
      return res?.ok ? { ok: true, value: res.value } : { ok: false, error: res?.error?.message ?? String(res?.error ?? "\u5931\u8D25") };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  };
  const refresh = async () => {
    const r = await call("profile/list", {});
    if (r.ok) {
      const list = r.value.profiles ?? [];
      setProfiles(list);
      setExportProfile((prev) => prev || list.find((p) => p.active)?.name || list[0]?.name || "");
    } else setResult(r);
  };
  const watch = (id) => {
    setTasksOpen(true);
    const timer = setInterval(async () => {
      const r = await call("task/get", { id });
      if (!r.ok) {
        clearInterval(timer);
        return;
      }
      const t2 = r.value;
      if (!t2 || t2.status !== "done" && t2.status !== "failed") return;
      clearInterval(timer);
      if (t2.status === "failed") showErr(t2.error || "\u4EFB\u52A1\u5931\u8D25");
      void refresh();
    }, 600);
  };
  (0, import_react.useEffect)(() => {
    void refresh();
  }, []);
  (0, import_react.useEffect)(() => {
    void (async () => {
      const r = await call("config/get", {});
      if (!r.ok) return;
      const v = r.value?.proxy ?? "";
      if (v === "direct") {
        setProxyMode("direct");
        setProxy("");
      } else if (v) {
        setProxyMode("manual");
        setProxy(v);
      } else {
        setProxyMode("auto");
        setProxy("");
      }
    })();
    void (async () => {
      const r = await call("runtime/get", {});
      if (r.ok && Array.isArray(r.value?.installedDshVersions)) setInstalledDsh(r.value.installedDshVersions);
    })();
    void (async () => {
      const r = await call("launchers/registry", {});
      if (r.ok && Array.isArray(r.value?.launchers) && r.value.launchers.length) {
        setLaunchersReg(r.value.launchers);
      }
    })();
  }, []);
  const active = profiles.find((p) => p.active) ?? null;
  const showOk = (text) => setResult({ ok: true, text });
  const showErr = (error) => setResult({ ok: false, error });
  const openUrl = (url) => {
    void call("plugin/open-url", { url });
  };
  const doCheckUpdate = async () => {
    setUpdate({ checking: true });
    const r = await call("plugin/check-update", {});
    if (!r.ok) setUpdate({ error: r.error });
    else setUpdate(r.value);
  };
  const doSaveProxy = async () => {
    const value = proxyMode === "direct" ? "direct" : proxyMode === "manual" ? proxy.trim() : "";
    const r = await call("config/set", { proxy: value });
    if (!r.ok) return showErr(r.error);
    showOk(t("result.proxySaved"));
  };
  const askSwitch = async (name2) => {
    const r = await call("profile/switch-check", { name: name2 });
    if (!r.ok) return showErr(r.error);
    setManagerSource("npm");
    setConfirm({
      from: r.value.from,
      to: r.value.to,
      hasManager: r.value.hasManager,
      firstTime: r.value.firstTime
    });
  };
  const confirmSwitch = async () => {
    if (!confirm) return;
    const name2 = confirm.to;
    setConfirm(null);
    setResult({ pending: true });
    const r = await call("profile/switch", { name: name2, managerSource });
    if (!r.ok) return showErr(r.error);
    showOk(r.value?.restarting ? `\u5207\u6362\u4E2D\uFF1A\u684C\u9762\u5C06\u81EA\u52A8\u91CD\u542F\u5230\u300C${name2}\u300D` : `\u5DF2\u5207\u6362\u5230\u300C${name2}\u300D\uFF0C\u91CD\u542F DSH \u540E\u751F\u6548`);
    void refresh();
  };
  const doDelete = async (name2) => {
    setResult({ pending: true });
    const r = await call("profile/delete", { name: name2 });
    if (!r.ok) return showErr(r.error);
    showOk(`\u5DF2\u5220\u9664\u300C${name2}\u300D`);
    void refresh();
  };
  const doExportProfile = async (name2) => {
    setResult({ pending: true });
    const r = await call("pack/export", name2 ? { profile: name2 } : {});
    if (!r.ok) return showErr(r.error);
    showOk(t("result.taskStarted"));
    watch(r.value.taskId);
  };
  const doOpenTasks = () => {
    setTasksOpen((v) => !v);
  };
  const doOpenDir = async (name2) => {
    const r = await call("profile/open-dir", { name: name2 });
    if (r.ok) showOk(`\u5DF2\u6253\u5F00 ${r.value.dir}`);
    else showErr(r.error);
  };
  const openDialog = (type) => {
    setFieldError("");
    setSubmitting(false);
    setDialog(type);
  };
  const closeDialog = () => {
    setDialog(null);
    setFieldError("");
    setSubmitting(false);
  };
  const doCreate = async () => {
    const name2 = newName.trim();
    if (!name2) return setFieldError(t("err.name"));
    if (!PROFILE_NAME_RE.test(name2)) return setFieldError(t("err.nameInvalid"));
    if (RESERVED_PROFILE_NAMES.includes(name2)) return setFieldError(t("err.nameReserved").replace("{name}", name2));
    setSubmitting(true);
    const r = await call("profile/create", { name: name2 });
    setSubmitting(false);
    if (!r.ok) return setFieldError(r.error);
    setNewName("");
    closeDialog();
    showOk(t("result.taskStarted"));
    watch(r.value.taskId);
  };
  const doImport = async () => {
    const src = source.trim();
    if (!src) return setFieldError(t("err.source"));
    setSubmitting(true);
    const v = await call("pack/view", { source: src });
    setSubmitting(false);
    if (!v.ok) return setFieldError(v.error);
    const warnings = v.value?.launchersWarnings ?? [];
    if (warnings.some((w) => w.level === "warn")) {
      setInstallConfirm({ source: src, extra: {}, warnings, fromDialog: true });
      return;
    }
    const infos = warnings.filter((w) => w.level === "info");
    if (infos.length) showOk(infos.map((w) => w.message).join("\n"));
    setSource("");
    closeDialog();
    await doInstallTask(src, {});
  };
  const loadMarket = async () => {
    setMarket(void 0);
    const r = await call("pack/market", {});
    if (r.ok) setMarket({ packs: r.value.packs ?? [], error: r.value.error ?? null });
    else setMarket({ packs: [], error: r.error });
  };
  const doInstallTask = async (src, extra) => {
    setResult({ pending: true });
    const r = await call("pack/install", { source: src, ...extra });
    if (!r.ok) return showErr(r.error);
    showOk(t("result.taskStarted"));
    watch(r.value.taskId);
  };
  const doInstallFromMarket = async (pack) => {
    const src = pack?.downloadUrl || pack?.urls?.[0];
    if (!src) return showErr("\u8BE5\u5305\u6CA1\u6709\u53EF\u4E0B\u8F7D\u5730\u5740");
    setResult({ pending: true });
    const v = await call("pack/view", { source: src });
    if (!v.ok) return showErr(v.error);
    const warnings = v.value?.launchersWarnings ?? [];
    const extra = {
      expectedSha256: pack?.sha256 || void 0,
      expectedSize: pack?.size || void 0
    };
    if (warnings.some((w) => w.level === "warn")) {
      setInstallConfirm({ source: src, extra, warnings, fromDialog: false });
      return;
    }
    const infos = warnings.filter((w) => w.level === "info");
    if (infos.length) showOk(infos.map((w) => w.message).join("\n"));
    await doInstallTask(src, extra);
  };
  const confirmInstall = async () => {
    const c = installConfirm;
    if (!c) return;
    setInstallConfirm(null);
    if (c.fromDialog) {
      setSource("");
      closeDialog();
    }
    await doInstallTask(c.source, c.extra ?? {});
  };
  const doMarketDetail = async (pack) => {
    setDetail({ pending: true, pack });
    const r = await call("pack/market-detail", { pack });
    if (!r.ok) {
      setDetail({ error: r.error, pack });
      return;
    }
    setDetail({
      pack,
      manifest: r.value.manifest,
      readme: r.value.readme ?? "",
      r2: r.value.r2 ?? {},
      badges: r.value.badges ?? []
    });
  };
  const badgeText = (b) => {
    if (b.kind === "launcher-require") return t("market.r2.launcherRequire").replace("{id}", b.id).replace("{ver}", b.minVersion);
    if (b.kind === "launcher-conflict") return t("market.r2.launcherConflict").replace("{id}", b.id).replace("{reason}", b.reason || t("market.r2.noReason"));
    if (b.kind === "dsh-versions") return t("market.r2.dshVersions").replace("{versions}", b.versions.join(", "));
    return "";
  };
  const doExportFromForm = async () => {
    setResult({ pending: true });
    const overrides = {};
    for (const k of [...META_FIELDS, ...OUTPUT_FIELDS]) {
      const v = (meta[k] ?? "").trim();
      if (v) overrides[k] = v;
    }
    overrides.profile = exportProfile;
    overrides.mode = mode;
    overrides.content = contentLevel;
    overrides.exportContent = {
      skill: !!exportContent.skill,
      preset: !!exportContent.preset,
      instruction: !!exportContent.instruction
    };
    const versions = parseDshVersionsInput(dshVersionsText);
    if (versions.length) {
      overrides.dshVersions = versions;
      if (!overrides.dshVersion) overrides.dshVersion = versions[0];
    }
    const launchers = buildLaunchersField();
    if (Object.keys(launchers).length) overrides.launchers = launchers;
    const r = await call("pack/export", overrides);
    if (!r.ok) return showErr(r.error);
    showOk(t("result.taskStarted"));
    watch(r.value.taskId);
  };
  const doAiUpload = async () => {
    if (!sendToChat) {
      setUpload({ ok: false, error: t("upload.noService") });
      return;
    }
    setUpload({ pending: true });
    const parts = ["\u8BF7\u5E2E\u6211\u628A\u6574\u5408\u5305\u53D1\u5E03\u5230 GitHub"];
    if (exportProfile) parts.push(`profile=${exportProfile}`);
    if ((meta.name ?? "").trim()) parts.push(`name=${String(meta.name).trim()}`);
    if ((meta.version ?? "").trim()) parts.push(`version=${String(meta.version).trim()}`);
    const prompt = parts.join("\uFF0C") + "\u3002";
    try {
      await sendToChat(prompt);
      setUpload({ ok: true, text: t("upload.sent") });
    } catch (e) {
      setUpload({ ok: false, error: `${t("upload.failed")}\uFF1A${String(e?.message ?? e)}` });
    }
  };
  const parseDshVersionsInput = (text) => [...new Set(String(text ?? "").split(/[,，;；\s]+/).map((s) => s.trim()).filter(Boolean))];
  const buildLaunchersField = () => {
    const out = {};
    for (const [id, s] of Object.entries(launchersState)) {
      if (!s || s.mode !== "support" && s.mode !== "conflict") continue;
      if (s.mode === "support") out[id] = (s.minVersion ?? "").trim() || true;
      else out[id] = (s.reason ?? "").trim() ? { supported: false, reason: (s.reason ?? "").trim() } : false;
    }
    return out;
  };
  const launchersValueToState = (value) => {
    const out = {};
    for (const [id, v] of Object.entries(value ?? {})) {
      if (v === true) out[id] = { mode: "support", minVersion: "", reason: "" };
      else if (typeof v === "string") out[id] = { mode: "support", minVersion: v, reason: "" };
      else if (v === false) out[id] = { mode: "conflict", minVersion: "", reason: "" };
      else if (v && typeof v === "object") out[id] = { mode: v.supported === false ? "conflict" : "support", minVersion: typeof v.minVersion === "string" ? v.minVersion : "", reason: typeof v.reason === "string" ? v.reason : "" };
    }
    return out;
  };
  const applyConfig = (cfg) => {
    const next = {};
    for (const k of [...META_FIELDS, ...OUTPUT_FIELDS]) {
      const v = cfg?.[k];
      if (typeof v === "string" && v.trim()) next[k] = v;
    }
    setMeta(next);
    setMode(MODES.includes(cfg?.mode) ? cfg.mode : "dspack");
    setContentLevel(CONTENT_LEVELS.includes(cfg?.content) ? cfg.content : "readme");
    const ec = cfg?.exportContent;
    setExportContent({
      skill: ec?.skill === true,
      preset: ec?.preset === true,
      instruction: ec?.instruction === true
    });
    setDshVersionsText(Array.isArray(cfg?.dshVersions) ? cfg.dshVersions.join(", ") : "");
    setLaunchersState(launchersValueToState(cfg?.launchers));
  };
  const loadConfig = async (name2, silent = false) => {
    const r = await call("pack/config-load", { profile: name2 });
    if (!r.ok) return showErr(r.error);
    setLoadedFor(name2);
    if (!r.value.config) {
      applyConfig(null);
      if (!silent) showOk(t("result.noCfg"));
      return;
    }
    applyConfig(r.value.config);
    if (!silent) showOk(t("result.loaded"));
  };
  const doLoadConfig = () => {
    if (exportProfile) void loadConfig(exportProfile, false);
  };
  const doSaveConfig = async () => {
    if (!exportProfile) return;
    setResult({ pending: true });
    const cfg = {};
    for (const k of [...META_FIELDS, ...OUTPUT_FIELDS]) cfg[k] = (meta[k] ?? "").trim();
    cfg.mode = mode;
    cfg.content = contentLevel;
    cfg.exportContent = {
      skill: !!exportContent.skill,
      preset: !!exportContent.preset,
      instruction: !!exportContent.instruction
    };
    const versions = parseDshVersionsInput(dshVersionsText);
    if (versions.length) cfg.dshVersions = versions;
    const launchers = buildLaunchersField();
    if (Object.keys(launchers).length) cfg.launchers = launchers;
    const r = await call("pack/config-save", { profile: exportProfile, ...cfg });
    if (!r.ok) return showErr(r.error);
    showOk(t("result.saved") + " \u2192 " + r.value.path);
  };
  (0, import_react.useEffect)(() => {
    if (tab !== "export" || !exportProfile || loadedFor === exportProfile) return;
    void loadConfig(exportProfile, true);
  }, [tab, exportProfile, loadedFor]);
  (0, import_react.useEffect)(() => {
    if (!tasksOpen) return;
    let stopped = false;
    const load = async () => {
      const r = await call("task/list", {});
      if (stopped || !r.ok) return;
      setTaskList(r.value.tasks ?? []);
    };
    void load();
    const timer = setInterval(load, 600);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [tasksOpen]);
  const style = {
    section: { display: "flex", flexDirection: "column", gap: 12, maxWidth: 720, padding: "8px 0" },
    tabs: { display: "flex", gap: 4, borderBottom: "1px solid var(--dsw-alias-border-l2)", paddingBottom: 8 },
    tab: {
      height: 32,
      padding: "0 16px",
      borderRadius: 16,
      border: "none",
      cursor: "pointer",
      fontSize: 13,
      lineHeight: "20px",
      background: "transparent",
      color: "var(--dsw-alias-label-secondary)",
      font: "inherit"
    },
    tabActive: { background: "var(--dsw-alias-bg-layer-1)", color: "var(--dsw-alias-label-primary)", fontWeight: 600 },
    group: { display: "flex", flexDirection: "column", gap: 6 },
    groupTitle: { margin: "0", fontSize: 13, fontWeight: 600, lineHeight: "20px", color: "var(--dsw-alias-label-primary)" },
    field: { display: "flex", flexDirection: "column", gap: 4 },
    fieldLabel: { fontSize: 12, lineHeight: "18px", color: "var(--dsw-alias-label-secondary)" },
    input: {
      height: 32,
      padding: "4px 10px",
      borderRadius: 8,
      border: "1px solid var(--dsw-alias-border-l2)",
      fontSize: 13,
      lineHeight: "20px",
      background: "var(--dsw-alias-bg-layer-1)",
      color: "var(--dsw-alias-label-primary)",
      font: "inherit",
      outline: "none",
      boxSizing: "border-box"
    },
    row: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
    btn: {
      height: 30,
      padding: "0 12px",
      borderRadius: 15,
      border: "1px solid var(--dsw-alias-border-l2)",
      cursor: "pointer",
      fontSize: 13,
      lineHeight: "18px",
      background: "var(--dsw-alias-bg-layer-1)",
      color: "var(--dsw-alias-label-primary)",
      font: "inherit",
      width: "fit-content",
      flex: "0 0 auto"
    },
    btnSmall: {
      height: 26,
      padding: "0 10px",
      borderRadius: 13,
      border: "1px solid var(--dsw-alias-border-l2)",
      cursor: "pointer",
      fontSize: 12,
      lineHeight: "18px",
      background: "var(--dsw-alias-bg-layer-1)",
      color: "var(--dsw-alias-label-primary)",
      font: "inherit",
      width: "fit-content",
      flex: "0 0 auto"
    },
    list: { margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 },
    listItem: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      padding: "10px 12px",
      borderRadius: 10,
      border: "1px solid var(--dsw-alias-border-l2)",
      background: "var(--dsw-alias-bg-layer-1)"
    },
    listName: { fontSize: 13, lineHeight: "20px", color: "var(--dsw-alias-label-primary)" },
    line: { margin: 0, fontSize: 12, lineHeight: "18px", color: "var(--dsw-alias-label-secondary)" },
    marketHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },
    refreshBtn: {
      width: 26,
      height: 26,
      padding: 0,
      borderRadius: "50%",
      border: "1px solid var(--dsw-alias-border-l2)",
      cursor: "pointer",
      background: "var(--dsw-alias-bg-layer-1)",
      color: "var(--dsw-alias-label-secondary)",
      fontSize: 15,
      lineHeight: "18px",
      font: "inherit",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "0 0 auto"
    },
    sectionBox: { display: "flex", flexDirection: "column", gap: 8, paddingBottom: 14, marginBottom: 14, borderBottom: "1px solid var(--dsw-alias-border-l2)" },
    sectionBoxLast: { display: "flex", flexDirection: "column", gap: 8 },
    hint: { margin: "4px 0 0", fontSize: 12, lineHeight: "18px", color: "var(--dsw-alias-label-tertiary)" },
    ok: { margin: 0, fontSize: 12, lineHeight: "18px", color: "var(--dsw-alias-success)", whiteSpace: "pre-wrap", wordBreak: "break-all" },
    err: { margin: 0, fontSize: 12, lineHeight: "18px", color: "var(--dsw-alias-danger)", whiteSpace: "pre-wrap", wordBreak: "break-all" },
    // —— 切换确认弹窗 ——
    overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1e3 },
    modal: {
      background: "var(--dsw-alias-bg-layer-1)",
      borderRadius: 12,
      padding: "20px 22px",
      minWidth: 360,
      maxWidth: 440,
      boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
      display: "flex",
      flexDirection: "column",
      gap: 14
    },
    modalTitle: { margin: 0, fontSize: 15, fontWeight: 600, color: "var(--dsw-alias-label-primary)", textAlign: "center" },
    ticket: {
      position: "relative",
      display: "flex",
      alignItems: "stretch",
      border: "1px solid var(--dsw-alias-border-l2)",
      borderRadius: 10,
      background: "var(--dsw-alias-bg-layer-1)"
    },
    ticketSide: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, padding: "16px 10px", minWidth: 0 },
    ticketName: { fontSize: 18, fontWeight: 700, color: "var(--dsw-alias-label-primary)", wordBreak: "break-all", textAlign: "center" },
    ticketRole: { fontSize: 12, color: "var(--dsw-alias-label-tertiary)" },
    ticketLine: { width: 0, borderLeft: "2px dashed var(--dsw-alias-border-l2)", alignSelf: "stretch" },
    ticketBadge: {
      position: "absolute",
      top: "50%",
      left: "50%",
      transform: "translate(-50%,-50%)",
      width: 28,
      height: 28,
      borderRadius: "50%",
      background: "var(--dsw-alias-bg-layer-1)",
      border: "2px dashed var(--dsw-alias-border-l2)",
      color: "var(--dsw-alias-label-secondary)",
      fontSize: 15,
      fontWeight: 700,
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    },
    warn: {
      display: "flex",
      gap: 8,
      alignItems: "flex-start",
      padding: "8px 10px",
      borderRadius: 8,
      border: "1px solid rgba(232,162,58,0.45)",
      background: "rgba(232,162,58,0.10)",
      fontSize: 12,
      lineHeight: "18px",
      color: "var(--dsw-alias-label-primary)",
      wordBreak: "break-word"
    },
    warnIcon: { flex: "0 0 auto", lineHeight: "18px", color: "#e8a23a", fontWeight: 700 },
    confirmBtns: { display: "flex", justifyContent: "flex-end", gap: 8 },
    logoTile: {
      width: 88,
      height: 88,
      borderRadius: 20,
      background: "#fff",
      color: "#4b7bec",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: "0 4px 16px rgba(0,0,0,0.28)",
      flex: "0 0 auto"
    },
    btnPrimary: {
      height: 30,
      padding: "0 14px",
      borderRadius: 15,
      border: "1px solid #4b7bec",
      cursor: "pointer",
      fontSize: 13,
      lineHeight: "18px",
      background: "#4b7bec",
      color: "#fff",
      fontWeight: 600,
      font: "inherit",
      width: "fit-content",
      flex: "0 0 auto"
    },
    // —— 任务中心内嵌面板 ——
    taskPanel: { display: "flex", flexDirection: "column", gap: 8, padding: "10px 12px", marginBottom: 12, borderRadius: 10, border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-1)" },
    taskCard: { display: "flex", flexDirection: "column", gap: 8, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-1)" },
    taskTitle: { fontSize: 13, fontWeight: 600, lineHeight: "20px", color: "var(--dsw-alias-label-primary)", wordBreak: "break-all" },
    taskTimeline: { display: "flex", flexWrap: "wrap", gap: "6px 16px" },
    taskStep: { display: "flex", alignItems: "center", gap: 5, fontSize: 12, lineHeight: "18px", color: "var(--dsw-alias-label-secondary)" },
    taskDot: { width: 14, height: 14, borderRadius: "50%", flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, lineHeight: 1, border: "1.5px solid var(--dsw-alias-border-l2)", color: "transparent", background: "transparent" },
    taskLog: { margin: 0, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-layer-1)", color: "var(--dsw-alias-label-secondary)", font: '12px/1.5 ui-monospace, Consolas, "Courier New", monospace', maxHeight: 160, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all" }
  };
  const fieldInput = (key) => (0, import_react.createElement)(
    "label",
    { key, style: style.field },
    (0, import_react.createElement)("span", { style: style.fieldLabel }, t("field." + key)),
    (0, import_react.createElement)("input", {
      style: style.input,
      value: meta[key] ?? "",
      onInput: (e) => setMeta((m) => ({ ...m, [key]: e.target.value }))
    })
  );
  const renderManage = () => {
    const rows = profiles.map(
      (p) => (0, import_react.createElement)(
        "li",
        { key: p.name, style: style.listItem },
        (0, import_react.createElement)("span", { style: style.listName }, p.name + (p.active ? `\uFF08${t("profile.active")}\uFF09` : "")),
        (0, import_react.createElement)(
          "div",
          { style: style.row },
          p.active ? null : (0, import_react.createElement)("button", { type: "button", style: style.btnSmall, onClick: () => askSwitch(p.name) }, t("action.switch")),
          (0, import_react.createElement)("button", { type: "button", style: style.btnSmall, onClick: () => doExportProfile(p.name) }, t("action.export")),
          (0, import_react.createElement)("button", { type: "button", style: style.btnSmall, onClick: () => doDelete(p.name) }, t("action.delete"))
        )
      )
    );
    return (0, import_react.createElement)(
      "div",
      { style: { display: "flex", flexDirection: "column" } },
      // 区域 1：正在运行的整合包
      (0, import_react.createElement)(
        "section",
        { key: "running", style: style.sectionBox },
        (0, import_react.createElement)("h3", { style: style.groupTitle }, t("running.title")),
        (0, import_react.createElement)("p", { style: style.line }, t("running.profile") + (active ? active.name : t("market.none"))),
        (0, import_react.createElement)(
          "div",
          { style: style.row },
          (0, import_react.createElement)("button", { type: "button", style: style.btn, disabled: !rpc || !active, onClick: () => doExportProfile(active?.name) }, t("action.quickExport")),
          (0, import_react.createElement)("button", { type: "button", style: style.btn, disabled: !rpc || !active, onClick: () => doOpenDir(active?.name) }, t("action.openDir")),
          (0, import_react.createElement)("button", { type: "button", style: style.btn, disabled: !rpc, onClick: doOpenTasks }, t("action.tasks"))
        )
      ),
      // 区域 2：创建整合包
      (0, import_react.createElement)(
        "section",
        { key: "create", style: style.sectionBox },
        (0, import_react.createElement)("h3", { style: style.groupTitle }, t("create.title")),
        (0, import_react.createElement)(
          "div",
          { style: style.row },
          (0, import_react.createElement)("button", { type: "button", style: style.btn, disabled: !rpc, onClick: () => openDialog("create") }, t("action.newEmpty")),
          (0, import_react.createElement)("button", { type: "button", style: style.btn, disabled: !rpc, onClick: () => openDialog("import") }, t("action.import")),
          (0, import_react.createElement)("button", { type: "button", style: style.btn, disabled: !rpc, onClick: () => {
            setTab("market");
            void loadMarket();
          } }, t("action.market"))
        )
      ),
      // 区域 3：已安装的整合包
      (0, import_react.createElement)(
        "section",
        { key: "installed", style: style.sectionBoxLast },
        (0, import_react.createElement)("h3", { style: style.groupTitle }, t("installed.title")),
        profiles.length === 0 ? (0, import_react.createElement)("p", { style: style.line }, t("market.none")) : (0, import_react.createElement)("ul", { style: style.list }, rows)
      )
    );
  };
  const renderExport = () => (0, import_react.createElement)(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: 12 } },
    (0, import_react.createElement)(
      "div",
      { style: style.group },
      (0, import_react.createElement)("div", { style: style.groupTitle }, t("group.meta")),
      ...META_FIELDS.map(fieldInput)
    ),
    (0, import_react.createElement)(
      "div",
      { style: style.group },
      (0, import_react.createElement)("div", { style: style.groupTitle }, t("group.output")),
      ...OUTPUT_FIELDS.map(fieldInput),
      (0, import_react.createElement)(
        "label",
        { style: style.field },
        (0, import_react.createElement)("span", { style: style.fieldLabel }, t("field.profile")),
        (0, import_react.createElement)(
          "select",
          { style: style.input, value: exportProfile, onChange: (e) => setExportProfile(e.target.value) },
          profiles.map((p) => (0, import_react.createElement)("option", { key: p.name, value: p.name }, p.name + (p.active ? `\uFF08${t("profile.active")}\uFF09` : "")))
        )
      ),
      (0, import_react.createElement)(
        "label",
        { style: style.field },
        (0, import_react.createElement)("span", { style: style.fieldLabel }, t("field.mode")),
        (0, import_react.createElement)(
          "select",
          { style: style.input, value: mode, onChange: (e) => setMode(e.target.value) },
          MODES.map((m) => (0, import_react.createElement)("option", { key: m, value: m }, t("mode." + m)))
        )
      ),
      mode === "repo" ? (0, import_react.createElement)(
        "label",
        { style: style.field },
        (0, import_react.createElement)("span", { style: style.fieldLabel }, t("field.content")),
        (0, import_react.createElement)(
          "select",
          { style: style.input, value: contentLevel, onChange: (e) => setContentLevel(e.target.value) },
          CONTENT_LEVELS.map((c) => (0, import_react.createElement)("option", { key: c, value: c }, t("content." + c)))
        )
      ) : null
    ),
    (0, import_react.createElement)(
      "div",
      { style: style.group },
      (0, import_react.createElement)("div", { style: style.groupTitle }, t("compat.title")),
      (0, import_react.createElement)(
        "label",
        { style: style.field },
        (0, import_react.createElement)("span", { style: style.fieldLabel }, t("compat.dshVersions")),
        (0, import_react.createElement)("input", {
          style: style.input,
          value: dshVersionsText,
          placeholder: "0.1.1-rc.2, 0.1.0",
          list: "dspack-dshversions",
          onChange: (e) => setDshVersionsText(e.target.value)
        }),
        installedDsh.length ? (0, import_react.createElement)(
          "datalist",
          { id: "dspack-dshversions" },
          installedDsh.map((v) => (0, import_react.createElement)("option", { key: v, value: v }))
        ) : null
      ),
      (0, import_react.createElement)("p", { style: style.hint }, t("compat.dshVersionsHint")),
      (0, import_react.createElement)(
        "div",
        { style: style.field },
        (0, import_react.createElement)("span", { style: style.fieldLabel }, t("compat.launchers")),
        ...(launchersReg ?? LAUNCHER_IDS.map((id) => ({ id, name: id }))).map(({ id, name: name2 }) => {
          const st = launchersState[id] ?? { mode: "none", minVersion: "", reason: "" };
          const setEntry = (patch) => setLaunchersState((s) => ({ ...s, [id]: { ...s[id] ?? { minVersion: "", reason: "" }, ...patch } }));
          return (0, import_react.createElement)(
            "div",
            { key: id, style: { ...style.row, flexWrap: "nowrap" } },
            (0, import_react.createElement)("span", { style: { ...style.line, flex: "0 0 190px", wordBreak: "break-all" } }, name2 && name2 !== id ? `${name2}\uFF08${id}\uFF09` : id),
            (0, import_react.createElement)(
              "select",
              {
                style: { ...style.input, flex: "0 0 auto", width: 110 },
                value: st.mode,
                onChange: (e) => {
                  const mode2 = e.target.value;
                  if (mode2 === "none") setLaunchersState((s) => {
                    const n = { ...s };
                    delete n[id];
                    return n;
                  });
                  else setEntry({ mode: mode2 });
                }
              },
              (0, import_react.createElement)("option", { value: "none" }, t("launcher.none")),
              (0, import_react.createElement)("option", { value: "support" }, t("launcher.support")),
              (0, import_react.createElement)("option", { value: "conflict" }, t("launcher.conflict"))
            ),
            st.mode === "support" ? (0, import_react.createElement)("input", {
              style: { ...style.input, flex: "0 1 170px" },
              placeholder: t("launcher.minVersion"),
              value: st.minVersion ?? "",
              onChange: (e) => setEntry({ minVersion: e.target.value })
            }) : null,
            st.mode === "conflict" ? (0, import_react.createElement)("input", {
              style: { ...style.input, flex: "1 1 auto", minWidth: 120 },
              placeholder: t("launcher.reason"),
              value: st.reason ?? "",
              onChange: (e) => setEntry({ reason: e.target.value })
            }) : null
          );
        })
      )
    ),
    (0, import_react.createElement)(
      "div",
      { style: style.group },
      (0, import_react.createElement)("div", { style: style.groupTitle }, t("group.content")),
      ...CONTENT_TOGGLES.map(
        (k) => (0, import_react.createElement)(
          "label",
          { key: k, style: style.row },
          (0, import_react.createElement)("input", {
            type: "checkbox",
            checked: !!exportContent[k],
            style: { width: 16, height: 16, cursor: "pointer", accentColor: "#4b7bec" },
            onChange: (e) => setExportContent((ec) => ({ ...ec, [k]: e.target.checked }))
          }),
          (0, import_react.createElement)("span", { style: style.line }, t("content." + k))
        )
      )
    ),
    // 基线已取消离线包：「内嵌依赖（离线分发）」表单区（档位选择 / 依赖勾选清单 /
    // 「刷新依赖」按钮 / 「已内嵌」「未安装」提示）整块移除，导出侧不再有内嵌相关 UI。
    (0, import_react.createElement)(
      "div",
      { style: style.row },
      (0, import_react.createElement)("button", { type: "button", style: style.btn, disabled: !rpc, onClick: doSaveConfig }, t("action.save")),
      (0, import_react.createElement)("button", { type: "button", style: style.btn, disabled: !rpc, onClick: doLoadConfig }, t("action.load")),
      (0, import_react.createElement)("button", { type: "button", style: style.btn, disabled: !rpc, onClick: doExportFromForm }, t("action.export"))
    ),
    (0, import_react.createElement)(
      "div",
      { style: style.row },
      (0, import_react.createElement)("button", { type: "button", style: style.btn, disabled: !sendToChat || upload?.pending, onClick: doAiUpload }, t("action.upload")),
      upload?.pending ? (0, import_react.createElement)("span", { style: style.line }, t("result.pending")) : upload?.ok ? (0, import_react.createElement)("span", { style: style.ok }, upload.text) : upload?.ok === false ? (0, import_react.createElement)("span", { style: style.err }, upload.error) : (0, import_react.createElement)("span", { style: style.hint }, t("upload.hint"))
    )
  );
  const renderMarket = () => {
    const packs = market?.packs ?? [];
    let body;
    if (market === void 0) body = (0, import_react.createElement)("p", { style: style.line }, t("market.loading"));
    else if (market.error) body = (0, import_react.createElement)("p", { style: style.err }, `${t("market.error")}\uFF1A${market.error}`);
    else if (packs.length === 0) body = (0, import_react.createElement)("p", { style: style.line }, t("market.empty"));
    else body = (0, import_react.createElement)(
      "ul",
      { style: style.list },
      packs.map((p) => (0, import_react.createElement)(
        "li",
        { key: (p.id || p.name) + "@" + (p.version ?? ""), style: style.listItem },
        (0, import_react.createElement)(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: 2 } },
          (0, import_react.createElement)("span", { style: style.listName }, p.displayName || p.name),
          p.description ? (0, import_react.createElement)("span", { style: style.line }, p.description) : null,
          (0, import_react.createElement)(
            "span",
            { style: style.line },
            `${p.author ? p.author + " \xB7 " : ""}${p.version || "?"}${p.dshVersion ? " \xB7 DSH " + p.dshVersion : ""}` + (p.launcherRestricted ? " \xB7 \u26A0 " + t("market.launcherRestricted") : "")
          )
        ),
        (0, import_react.createElement)(
          "div",
          { style: style.row },
          (0, import_react.createElement)("button", { type: "button", style: style.btnSmall, disabled: !rpc || detail?.pending, onClick: () => void doMarketDetail(p) }, t("market.detail")),
          (0, import_react.createElement)("button", { type: "button", style: style.btnSmall, disabled: !rpc, onClick: () => doInstallFromMarket(p) }, t("action.install"))
        )
      ))
    );
    return (0, import_react.createElement)(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: 8 } },
      (0, import_react.createElement)(
        "div",
        { style: style.marketHead },
        packs.length > 0 ? (0, import_react.createElement)("p", { style: style.line }, `\u5E02\u573A\u5171 ${packs.length} \u4E2A\u6574\u5408\u5305`) : null,
        (0, import_react.createElement)("button", {
          type: "button",
          style: style.refreshBtn,
          disabled: !rpc || market === void 0,
          title: t("action.refresh"),
          onClick: () => void loadMarket()
        }, "\u21BB")
      ),
      body
    );
  };
  const renderLogo = () => (0, import_react.createElement)(
    "div",
    { style: style.logoTile },
    (0, import_react.createElement)(
      "svg",
      { viewBox: "0 0 1024 1024", width: 52, height: 52, style: { display: "block" } },
      (0, import_react.createElement)("path", { d: LOGO_PATH, fill: "currentColor" })
    )
  );
  const renderAbout = () => {
    const updateLine = !update ? null : update.checking ? (0, import_react.createElement)("p", { style: { ...style.line, margin: 0 } }, t("about.checking")) : update.error ? (0, import_react.createElement)("p", { style: { ...style.err, margin: 0 } }, `${t("about.checkFailed")}\uFF1A${update.error}`) : update.outdated ? (0, import_react.createElement)(
      "div",
      { style: { ...style.row, justifyContent: "center" } },
      (0, import_react.createElement)(
        "p",
        { style: { margin: 0, fontSize: 12, lineHeight: "18px", color: "#e8a23a", fontWeight: 600 } },
        t("about.newVersion").replace("{latest}", update.latest).replace("{current}", update.current)
      ),
      (0, import_react.createElement)("button", { type: "button", style: style.btnSmall, onClick: () => openUrl(update.npmUrl || NPM_URL) }, t("about.viewNpm"))
    ) : (0, import_react.createElement)("p", { style: { ...style.line, margin: 0 } }, `${t("about.upToDate")}\uFF08${update.latest}\uFF09`);
    return (0, import_react.createElement)(
      "div",
      { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "24px 0" } },
      renderLogo(),
      (0, import_react.createElement)("div", { style: { fontSize: 16, fontWeight: 700, lineHeight: "24px", color: "var(--dsw-alias-label-primary)" } }, MANAGER_PKG),
      (0, import_react.createElement)("p", { style: { ...style.line, margin: 0 } }, `${t("about.version")} ${VERSION}`),
      (0, import_react.createElement)("p", { style: { ...style.line, margin: 0, maxWidth: 440, textAlign: "center" } }, t("about.desc")),
      (0, import_react.createElement)("p", { style: { ...style.line, margin: 0, maxWidth: 440, textAlign: "center", fontStyle: "italic", color: "var(--dsw-alias-label-primary)" } }, t("about.philosophy")),
      (0, import_react.createElement)(
        "div",
        { style: { ...style.row, justifyContent: "center" } },
        (0, import_react.createElement)("button", { type: "button", style: style.btn, onClick: () => doCheckUpdate() }, t("about.checkUpdate"))
      ),
      updateLine,
      // —— 网络（代理设置：覆盖环境变量，保存即生效）——
      (0, import_react.createElement)(
        "div",
        { style: { ...style.group, width: "100%", maxWidth: 440, paddingTop: 14, borderTop: "1px solid var(--dsw-alias-border-l2)" } },
        (0, import_react.createElement)("p", { style: style.groupTitle }, t("group.network")),
        (0, import_react.createElement)(
          "div",
          { style: style.field },
          (0, import_react.createElement)("span", { style: style.fieldLabel }, t("field.proxyMode")),
          (0, import_react.createElement)(
            "div",
            { style: style.row },
            ["auto", "direct", "manual"].map(
              (m) => (0, import_react.createElement)("button", {
                key: m,
                type: "button",
                style: proxyMode === m ? { ...style.tab, ...style.tabActive } : style.tab,
                onClick: () => setProxyMode(m)
              }, t("proxyMode." + m))
            )
          )
        ),
        proxyMode === "manual" ? (0, import_react.createElement)(
          "label",
          { style: style.field },
          (0, import_react.createElement)("span", { style: style.fieldLabel }, t("field.proxy")),
          (0, import_react.createElement)("input", {
            style: style.input,
            value: proxy,
            placeholder: "http://127.0.0.1:7890",
            onInput: (e) => setProxy(e.target.value)
          })
        ) : null,
        (0, import_react.createElement)("p", { style: style.hint }, t("hint.proxy")),
        (0, import_react.createElement)(
          "div",
          { style: style.row },
          (0, import_react.createElement)("button", { type: "button", style: style.btn, disabled: !rpc, onClick: doSaveProxy }, t("action.save"))
        )
      ),
      (0, import_react.createElement)(
        "div",
        { style: { ...style.row, justifyContent: "center" } },
        (0, import_react.createElement)("button", { type: "button", style: style.btnSmall, onClick: () => openUrl(AUTHOR_URL) }, `${t("about.author")} ${AUTHOR}`),
        (0, import_react.createElement)("button", { type: "button", style: style.btnSmall, onClick: () => openUrl(REPO_URL) }, t("about.repo")),
        (0, import_react.createElement)("button", { type: "button", style: style.btnSmall, onClick: () => openUrl(REPO_URL) }, `\u2B50 ${t("about.star")}`)
      ),
      // —— 生态（DSH-PackForge 名下其它项目）——
      (0, import_react.createElement)(
        "div",
        { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: 8, width: "100%", maxWidth: 440, paddingTop: 14, borderTop: "1px solid var(--dsw-alias-border-l2)" } },
        (0, import_react.createElement)("p", { style: style.groupTitle }, t("about.ecosystem")),
        (0, import_react.createElement)(
          "div",
          { style: { ...style.row, justifyContent: "center" } },
          (0, import_react.createElement)("button", { type: "button", style: style.btnSmall, onClick: () => openUrl(SPEC_URL) }, t("about.ecosystem.spec")),
          (0, import_react.createElement)("button", { type: "button", style: style.btnSmall, onClick: () => openUrl(APP_URL) }, t("about.ecosystem.app")),
          (0, import_react.createElement)("button", { type: "button", style: style.btnSmall, onClick: () => openUrl(MARKET_URL) }, t("about.ecosystem.market"))
        )
      ),
      // —— 版权说明 ——
      (0, import_react.createElement)("p", { style: { ...style.hint, margin: "4px 0 0", textAlign: "center", maxWidth: 440 } }, t("about.copyright"))
    );
  };
  const content = tab === "manage" ? renderManage() : tab === "export" ? renderExport() : tab === "market" ? renderMarket() : renderAbout();
  const renderConfirm = () => {
    if (!confirm) return null;
    const warning = t("confirm.warning").replace("{pkg}", MANAGER_PKG);
    return (0, import_react.createElement)(
      "div",
      { style: style.overlay, onClick: () => setConfirm(null) },
      (0, import_react.createElement)(
        "div",
        { style: style.modal, onClick: (e) => e.stopPropagation() },
        (0, import_react.createElement)("h3", { style: style.modalTitle }, t("confirm.title")),
        (0, import_react.createElement)(
          "div",
          { style: style.ticket },
          (0, import_react.createElement)(
            "div",
            { style: style.ticketSide },
            (0, import_react.createElement)("span", { style: style.ticketName }, confirm.from),
            (0, import_react.createElement)("span", { style: style.ticketRole }, t("confirm.from"))
          ),
          (0, import_react.createElement)("div", { style: style.ticketLine }),
          (0, import_react.createElement)("div", { style: style.ticketBadge }, "\u2192"),
          (0, import_react.createElement)(
            "div",
            { style: style.ticketSide },
            (0, import_react.createElement)("span", { style: style.ticketName }, confirm.to),
            (0, import_react.createElement)("span", { style: style.ticketRole }, t("confirm.to"))
          )
        ),
        confirm.firstTime ? (0, import_react.createElement)("p", { style: style.hint }, t("confirm.firstTime")) : null,
        confirm.hasManager ? null : (0, import_react.createElement)(
          "div",
          { style: style.warn },
          (0, import_react.createElement)("span", { style: style.warnIcon }, "!"),
          (0, import_react.createElement)("span", null, warning)
        ),
        confirm.hasManager ? null : (0, import_react.createElement)(
          "div",
          { style: style.group },
          (0, import_react.createElement)("span", { style: style.fieldLabel }, t("confirm.managerSource")),
          (0, import_react.createElement)(
            "label",
            { key: "npm", style: style.row },
            (0, import_react.createElement)("input", {
              type: "radio",
              name: "managerSource",
              checked: managerSource === "npm",
              style: { width: 14, height: 14, cursor: "pointer", accentColor: "#4b7bec" },
              onChange: () => setManagerSource("npm")
            }),
            (0, import_react.createElement)("span", { style: style.line }, t("confirm.source.npm"))
          ),
          (0, import_react.createElement)(
            "label",
            { key: "copy", style: style.row },
            (0, import_react.createElement)("input", {
              type: "radio",
              name: "managerSource",
              checked: managerSource === "copy",
              style: { width: 14, height: 14, cursor: "pointer", accentColor: "#4b7bec" },
              onChange: () => setManagerSource("copy")
            }),
            (0, import_react.createElement)("span", { style: style.line }, t("confirm.source.copy"))
          )
        ),
        (0, import_react.createElement)("p", { style: style.hint }, t("confirm.hintRestart")),
        (0, import_react.createElement)(
          "div",
          { style: style.confirmBtns },
          (0, import_react.createElement)("button", { type: "button", style: style.btn, onClick: () => setConfirm(null) }, t("confirm.cancel")),
          (0, import_react.createElement)("button", { type: "button", style: style.btnPrimary, onClick: confirmSwitch }, t("confirm.ok"))
        )
      )
    );
  };
  const renderDialog = () => {
    if (!dialog) return null;
    const isCreate = dialog === "create";
    const value = isCreate ? newName : source;
    const submit = () => {
      if (!submitting) void (isCreate ? doCreate() : doImport());
    };
    return (0, import_react.createElement)(
      "div",
      { style: style.overlay, onClick: closeDialog },
      (0, import_react.createElement)(
        "div",
        { style: style.modal, onClick: (e) => e.stopPropagation() },
        (0, import_react.createElement)("h3", { style: style.modalTitle }, isCreate ? t("dialog.createTitle") : t("dialog.importTitle")),
        (0, import_react.createElement)(
          "label",
          { style: style.field },
          (0, import_react.createElement)("span", { style: style.fieldLabel }, isCreate ? t("field.newName") : t("field.source")),
          (0, import_react.createElement)("input", {
            style: style.input,
            value,
            autoFocus: true,
            placeholder: isCreate ? t("field.newName") : t("field.source"),
            onInput: (e) => {
              if (isCreate) setNewName(e.target.value);
              else setSource(e.target.value);
              if (fieldError) setFieldError("");
            },
            onKeyDown: (e) => {
              if (e.key === "Enter") submit();
            }
          })
        ),
        (0, import_react.createElement)("p", { style: style.hint }, isCreate ? t("hint.nameFormat") : t("hint.import")),
        fieldError ? (0, import_react.createElement)("p", { style: style.err }, fieldError) : null,
        (0, import_react.createElement)(
          "div",
          { style: style.confirmBtns },
          (0, import_react.createElement)("button", { type: "button", style: style.btn, disabled: submitting, onClick: closeDialog }, t("confirm.cancel")),
          (0, import_react.createElement)(
            "button",
            { type: "button", style: style.btnPrimary, disabled: !rpc || submitting, onClick: submit },
            submitting ? t("result.pending") : isCreate ? t("action.create") : t("action.install")
          )
        )
      )
    );
  };
  const renderInstallConfirm = () => {
    if (!installConfirm) return null;
    const warnings = installConfirm.warnings ?? [];
    return (0, import_react.createElement)(
      "div",
      { style: style.overlay, onClick: () => setInstallConfirm(null) },
      (0, import_react.createElement)(
        "div",
        { style: style.modal, onClick: (e) => e.stopPropagation() },
        (0, import_react.createElement)("h3", { style: style.modalTitle }, t("installConfirm.title")),
        (0, import_react.createElement)("p", { style: style.hint }, t("installConfirm.hint")),
        ...warnings.map((w, i) => (0, import_react.createElement)(
          "div",
          { key: i, style: style.warn },
          (0, import_react.createElement)("span", { style: style.warnIcon }, "!"),
          (0, import_react.createElement)("span", null, w.message)
        )),
        (0, import_react.createElement)(
          "div",
          { style: style.confirmBtns },
          (0, import_react.createElement)("button", { type: "button", style: style.btn, onClick: () => setInstallConfirm(null) }, t("confirm.cancel")),
          (0, import_react.createElement)("button", { type: "button", style: style.btnPrimary, onClick: confirmInstall }, t("installConfirm.ok"))
        )
      )
    );
  };
  const renderDetail = () => {
    if (!detail) return null;
    const close = () => setDetail(null);
    const pack = detail.pack ?? {};
    return (0, import_react.createElement)(
      "div",
      { style: style.overlay, onClick: close },
      (0, import_react.createElement)(
        "div",
        { style: { ...style.modal, maxWidth: 560 }, onClick: (e) => e.stopPropagation() },
        (0, import_react.createElement)("h3", { style: style.modalTitle }, t("market.detailTitle")),
        detail.pending ? (0, import_react.createElement)("p", { style: style.line }, t("market.loading")) : detail.error ? (0, import_react.createElement)("p", { style: style.err }, `${t("market.error")}\uFF1A${detail.error}`) : (0, import_react.createElement)(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: 8, minWidth: 0 } },
          (0, import_react.createElement)(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: 2 } },
            (0, import_react.createElement)("span", { style: style.listName }, pack.displayName || pack.name || detail.manifest?.name || ""),
            pack.description ? (0, import_react.createElement)("span", { style: style.line }, pack.description) : null,
            (0, import_react.createElement)(
              "span",
              { style: style.line },
              `${pack.author ? pack.author + " \xB7 " : ""}${pack.version || "?"}${pack.dshVersion ? " \xB7 DSH " + pack.dshVersion : ""}`
            )
          ),
          // v5 r2 兼容性徽标：需启动器 ≥ x / 声明冲突 / 兼容 DSH 版本集（离线包徽标已随基线移除）
          (detail.badges ?? []).length ? (0, import_react.createElement)(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: 4 } },
            detail.badges.map((b, i) => b.kind === "launcher-conflict" ? (0, import_react.createElement)(
              "div",
              { key: i, style: style.warn },
              (0, import_react.createElement)("span", { style: style.warnIcon }, "!"),
              (0, import_react.createElement)("span", null, badgeText(b))
            ) : (0, import_react.createElement)("p", { key: i, style: style.line }, "\xB7 " + badgeText(b)))
          ) : (0, import_react.createElement)("p", { style: style.line }, t("market.r2.none")),
          detail.readme ? (0, import_react.createElement)("pre", { style: { ...style.taskLog, maxHeight: 260 } }, detail.readme) : null
        ),
        (0, import_react.createElement)(
          "div",
          { style: style.confirmBtns },
          (0, import_react.createElement)("button", { type: "button", style: style.btn, onClick: close }, t("tasks.close")),
          detail.pending || detail.error ? null : (0, import_react.createElement)("button", {
            type: "button",
            style: style.btnPrimary,
            disabled: !rpc,
            onClick: () => {
              const p = detail.pack;
              setDetail(null);
              void doInstallFromMarket(p);
            }
          }, t("action.install"))
        )
      )
    );
  };
  const TASK_STATUS = {
    queued: ["\u6392\u961F\u4E2D", "#e8a23a"],
    running: ["\u8FDB\u884C\u4E2D", "#6ab7ff"],
    done: ["\u5B8C\u6210", "#2ea44f"],
    failed: ["\u5931\u8D25", "#d3383a"]
  };
  const taskDotStyle = (status) => status === "done" ? { borderColor: "#2ea44f", background: "#2ea44f", color: "#fff" } : status === "failed" ? { borderColor: "#d3383a", background: "#d3383a", color: "#fff" } : status === "running" ? { borderColor: "#6ab7ff", color: "#6ab7ff" } : {};
  const renderTasks = () => {
    const cards = taskList.map((t2) => {
      const [stLabel, stColor] = TASK_STATUS[t2.status] || ["?", "#9a9ba3"];
      const log = t2.log || [];
      const stages = t2.stages || [];
      return (0, import_react.createElement)(
        "li",
        { key: t2.id, style: style.taskCard },
        (0, import_react.createElement)(
          "div",
          { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 } },
          (0, import_react.createElement)("span", { style: style.taskTitle }, t2.title || "\u4EFB\u52A1"),
          (0, import_react.createElement)("span", { style: { flex: "0 0 auto", fontSize: 12, fontWeight: 600, color: stColor } }, stLabel)
        ),
        stages.length ? (0, import_react.createElement)(
          "div",
          { style: style.taskTimeline },
          stages.map(
            (s) => (0, import_react.createElement)(
              "span",
              { key: s.id, style: style.taskStep },
              (0, import_react.createElement)("span", { style: { ...style.taskDot, ...taskDotStyle(s.status) } }, s.status === "done" ? "\u2713" : s.status === "failed" ? "\u2717" : ""),
              (0, import_react.createElement)("span", null, s.label)
            )
          )
        ) : null,
        t2.error ? (0, import_react.createElement)("p", { style: style.err }, "\u9519\u8BEF\uFF1A" + t2.error) : null,
        log.length ? (0, import_react.createElement)("pre", { style: style.taskLog }, (t2.logTruncated ? "\u2026\uFF08\u5DF2\u622A\u65AD\uFF0C\u4EC5\u4FDD\u7559\u6700\u540E " + log.length + " \u884C\uFF09\n" : "") + log.join("\n")) : null
      );
    });
    return (0, import_react.createElement)(
      "div",
      { style: style.taskPanel },
      (0, import_react.createElement)(
        "div",
        { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 } },
        (0, import_react.createElement)("h3", { style: style.groupTitle }, t("action.tasks")),
        (0, import_react.createElement)("button", { type: "button", style: style.btnSmall, onClick: doOpenTasks, title: t("tasks.close") }, "\u2715")
      ),
      taskList.length === 0 ? (0, import_react.createElement)("p", { style: style.line }, t("tasks.empty")) : (0, import_react.createElement)("ul", { style: style.list }, cards)
    );
  };
  return (0, import_react.createElement)(
    import_react.Fragment,
    null,
    (0, import_react.createElement)(
      "div",
      { style: style.section },
      (0, import_react.createElement)(
        "div",
        { style: style.tabs },
        ["manage", "export", "market", "about"].map((id) => (0, import_react.createElement)("button", {
          key: id,
          type: "button",
          style: tab === id ? { ...style.tab, ...style.tabActive } : style.tab,
          onClick: () => {
            setTab(id);
            if (id === "market" && market === null) void loadMarket();
          }
        }, t("tab." + id)))
      ),
      tasksOpen ? renderTasks() : null,
      content,
      tab === "manage" ? (0, import_react.createElement)("p", { style: style.hint }, t("hint.restart")) : null,
      result ? (0, import_react.createElement)(
        "p",
        { style: result.ok === false ? style.err : style.ok },
        result.pending ? t("result.pending") : result.text ?? result.error
      ) : null
    ),
    renderConfirm(),
    renderDialog(),
    renderInstallConfirm(),
    renderDetail()
  );
}

// src/client-rpc.js
function createRpc(ctx) {
  const rpc = ctx?.connection?.rpc;
  if (!rpc || typeof rpc.call !== "function") return null;
  return {
    call: (endpoint, payload, signal) => rpc.call(CHANNEL, endpoint, payload ?? {}, signal)
  };
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
function viewportOf(w, h2) {
  return { w: Math.max(0, Number(w) || 0), h: Math.max(0, Number(h2) || 0) };
}
function decideSnap(rect, vp) {
  const cx = (Number(rect?.left) || 0) + (Number(rect?.w) || 0) / 2;
  const cy = (Number(rect?.top) || 0) + (Number(rect?.h) || 0) / 2;
  let h2 = null;
  let v = null;
  if (cx < vp.w * SNAP_RATIO) h2 = "left";
  else if (cx > vp.w * (1 - SNAP_RATIO)) h2 = "right";
  if (cy < vp.h * SNAP_RATIO) v = "top";
  else if (cy > vp.h * (1 - SNAP_RATIO)) v = "bottom";
  return { h: h2, v };
}
function anchorFrom(rect, vp, snap) {
  const left = Number(rect?.left) || 0;
  const top = Number(rect?.top) || 0;
  const w = Number(rect?.w) || 0;
  const h2 = Number(rect?.h) || 0;
  return {
    h: snap?.h ?? null,
    v: snap?.v ?? null,
    hOff: Math.max(0, snap?.h === "right" ? vp.w - (left + w) : left),
    vOff: Math.max(0, snap?.v === "bottom" ? vp.h - (top + h2) : top)
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
  const h2 = H_VALUES.has(parsed.h) ? parsed.h : null;
  const v = V_VALUES.has(parsed.v) ? parsed.v : null;
  const hOff = Number.isFinite(Number(parsed.hOff)) ? Math.max(0, Number(parsed.hOff)) : DEFAULT_OFFSET;
  const vOff = Number.isFinite(Number(parsed.vOff)) ? Math.max(0, Number(parsed.vOff)) : DEFAULT_OFFSET;
  const anchor = { h: h2, v, hOff, vOff };
  if (vp && vp.w > 0 && vp.h > 0) {
    const pos = positionFrom(anchor, { w: BALL_SIZE, h: BALL_SIZE }, vp);
    return anchorFrom({ left: pos.left, top: pos.top, w: BALL_SIZE, h: BALL_SIZE }, vp, { h: h2, v });
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

// src/client-plugin.js
var name = "dsh-packforge";
var inject = ["slots", "locale", "connection", "sessions", "uiWorkspace"];
function apply(ctx) {
  console.error("[dsh-pack][client] apply slots=" + !!ctx?.slots + " locale=" + !!ctx?.locale + " connection=" + !!ctx?.connection + " rpc=" + !!ctx?.connection?.rpc + " sessions=" + !!ctx?.sessions + " uiWorkspace=" + !!ctx?.uiWorkspace);
  const rpc = createRpc(ctx);
  registerSettingsSection(ctx, { rpc, sendToChat: makeSendToChat(ctx) });
  mountBallFallback();
}
function mountBallFallback() {
  try {
    mountBall();
  } catch (error) {
    console.error("[dsh-pack][client] \u60AC\u6D6E\u7403\u6302\u8F7D\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u8BBE\u7F6E\u9762\u677F\uFF09:", error);
  }
}
function makeSendToChat(ctx) {
  const sessions = ctx?.sessions;
  const uiWorkspace = ctx?.uiWorkspace;
  if (!sessions || typeof sessions.create !== "function" || typeof sessions.using !== "function" || typeof sessions.scope !== "function" || !uiWorkspace || typeof uiWorkspace.openSession !== "function") {
    return null;
  }
  return async (text) => {
    const id = await sessions.create({});
    if (!id) throw new Error("\u521B\u5EFA\u4F1A\u8BDD\u672A\u8FD4\u56DE sessionId");
    uiWorkspace.openSession(id);
    await sessions.using(id, { source: "dspack" }, async () => {
      const scoped = sessions.scope(id);
      const conversation = scoped?.conversation;
      if (!conversation || typeof conversation.send !== "function") throw new Error("conversation \u670D\u52A1\u4E0D\u53EF\u7528");
      await conversation.send(text);
    });
  };
}
    return module.exports;
  },
});
