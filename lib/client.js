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

// src/settings.js
var NS = "dspack";
var MANAGER_PKG = "@dsh-packforge/dsh-pack-plugin";
var VERSION = false ? "0.1.0" : "0.1.0";
var LOGO_PATH = "M444.330667 128l85.333333 85.333333H896a42.666667 42.666667 0 0 1 42.666667 42.666667v597.333333a42.666667 42.666667 0 0 1-42.666667 42.666667H128a42.666667 42.666667 0 0 1-42.666667-42.666667V170.666667a42.666667 42.666667 0 0 1 42.666667-42.666667h316.330667zM768 768h-170.666667v-128h85.333334v-85.333333h-85.333334v-85.333334h85.333334V384h-85.333334V298.666667h-102.997333l-85.333333-85.333334H170.666667v597.333334h682.666666V298.666667h-170.666666v85.333333h85.333333v85.333333h-85.333333v85.333334h85.333333v213.333333z";
var AUTHOR = "hxh230802";
var AUTHOR_URL = "https://github.com/hxh230802";
var REPO_URL = "https://github.com/DSH-PackForge/dsh-pack-plugin";
var NPM_URL = "https://www.npmjs.com/package/@dsh-packforge/dsh-pack-plugin";
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
    "confirm.title": "\u5207\u6362 profile",
    "confirm.from": "\u5F53\u524D",
    "confirm.to": "\u76EE\u6807",
    "confirm.firstTime": "\u9996\u6B21\u5207\u6362\uFF1A\u4F1A\u628A\u5F53\u524D\u76EE\u5F55\u5B58\u6863\u4E3A default",
    "confirm.warning": "\u68C0\u6D4B\u5230\u76EE\u6807 profile \u6CA1\u6709 {pkg}\uFF0C\u9700\u8981\u5B89\u88C5\u3002\u82E5\u6CA1\u6709\u6B64\u63D2\u4EF6\uFF0C\u5C06\u65E0\u6CD5\u4ECE\u5E94\u7528\u5185\u518D\u6B21\u5207\u6362 profile\u3002",
    "confirm.cancel": "\u53D6\u6D88",
    "confirm.ok": "\u786E\u8BA4\u5207\u6362",
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
    "about.viewNpm": "\u5728 npm \u67E5\u770B"
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
    "action.export": "Export",
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
    "confirm.title": "Switch profile",
    "confirm.from": "current",
    "confirm.to": "target",
    "confirm.firstTime": "First switch: current folder will be archived as default",
    "confirm.warning": "Target profile has no {pkg}; it must be installed. Without it you cannot switch again from inside the app.",
    "confirm.cancel": "Cancel",
    "confirm.ok": "Confirm switch",
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
    "about.viewNpm": "View on npm"
  }
};
function registerSettingsSection(ctx, packforge = {}) {
  const slots = ctx?.slots;
  const locale = ctx?.locale;
  if (!slots || typeof slots.inject !== "function") return false;
  if (!locale || typeof locale.register !== "function" || typeof locale.bind !== "function") return false;
  const registerLocale = () => {
    locale.register(NS, dict);
  };
  if (typeof ctx.effect === "function") ctx.effect(registerLocale, "dspack: settings dict");
  else registerLocale();
  const t = locale.bind(NS);
  slots.inject(
    "settings.section",
    () => slots.register(
      {
        name: "settings.section",
        id: "dspack",
        order: 20,
        label: () => t("nav"),
        locale: NS,
        inject: () => ({ t, packforge })
      },
      DspackSection
    )
  );
  return true;
}
var META_FIELDS = ["name", "version", "displayName", "description", "author", "icon", "profileName"];
var OUTPUT_FIELDS = ["dshVersion", "out"];
var MODES = ["dspack", "repo"];
var CONTENT_LEVELS = ["manifest", "readme", "full"];
var CONTENT_TOGGLES = ["skill", "preset", "instruction"];
function DspackSection({ t, packforge }) {
  const rpc = packforge?.rpc;
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
  const [confirm, setConfirm] = (0, import_react.useState)(null);
  const [managerSource, setManagerSource] = (0, import_react.useState)("copy");
  const [tasksOpen, setTasksOpen] = (0, import_react.useState)(false);
  const [taskList, setTaskList] = (0, import_react.useState)([]);
  const [update, setUpdate] = (0, import_react.useState)(null);
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
  const askSwitch = async (name2) => {
    const r = await call("profile/switch-check", { name: name2 });
    if (!r.ok) return showErr(r.error);
    setManagerSource("copy");
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
    const r = await call("pack/install", { source: src });
    setSubmitting(false);
    if (!r.ok) return setFieldError(r.error);
    setSource("");
    closeDialog();
    showOk(t("result.taskStarted"));
    watch(r.value.taskId);
  };
  const loadMarket = async () => {
    setMarket(void 0);
    const r = await call("pack/market", {});
    if (r.ok) setMarket({ packs: r.value.packs ?? [], error: r.value.error ?? null });
    else setMarket({ packs: [], error: r.error });
  };
  const doInstallFromMarket = async (pack) => {
    const src = pack?.downloadUrl || pack?.urls?.[0];
    if (!src) return showErr("\u8BE5\u5305\u6CA1\u6709\u53EF\u4E0B\u8F7D\u5730\u5740");
    setResult({ pending: true });
    const r = await call("pack/install", {
      source: src,
      expectedSha256: pack?.sha256 || void 0,
      expectedSize: pack?.size || void 0
    });
    if (!r.ok) return showErr(r.error);
    showOk(t("result.taskStarted"));
    watch(r.value.taskId);
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
    const r = await call("pack/export", overrides);
    if (!r.ok) return showErr(r.error);
    showOk(t("result.taskStarted"));
    watch(r.value.taskId);
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
          (0, import_react.createElement)("button", { type: "button", style: style.btn, disabled: !rpc || !active, onClick: () => doExportProfile(active?.name) }, t("action.export")),
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
    (0, import_react.createElement)(
      "div",
      { style: style.row },
      (0, import_react.createElement)("button", { type: "button", style: style.btn, disabled: !rpc, onClick: doSaveConfig }, t("action.save")),
      (0, import_react.createElement)("button", { type: "button", style: style.btn, disabled: !rpc, onClick: doLoadConfig }, t("action.load")),
      (0, import_react.createElement)("button", { type: "button", style: style.btn, disabled: !rpc, onClick: doExportFromForm }, t("action.export"))
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
          (0, import_react.createElement)("span", { style: style.line }, `${p.author ? p.author + " \xB7 " : ""}${p.version || "?"}${p.dshVersion ? " \xB7 DSH " + p.dshVersion : ""}`)
        ),
        (0, import_react.createElement)("button", { type: "button", style: style.btnSmall, disabled: !rpc, onClick: () => doInstallFromMarket(p) }, t("action.install"))
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
      (0, import_react.createElement)(
        "div",
        { style: { ...style.row, justifyContent: "center" } },
        (0, import_react.createElement)("button", { type: "button", style: style.btnSmall, onClick: () => openUrl(AUTHOR_URL) }, `${t("about.author")} ${AUTHOR}`),
        (0, import_react.createElement)("button", { type: "button", style: style.btnSmall, onClick: () => openUrl(REPO_URL) }, t("about.repo")),
        (0, import_react.createElement)("button", { type: "button", style: style.btnSmall, onClick: () => openUrl(REPO_URL) }, `\u2B50 ${t("about.star")}`)
      )
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
            { key: "copy", style: style.row },
            (0, import_react.createElement)("input", {
              type: "radio",
              name: "managerSource",
              checked: managerSource === "copy",
              style: { width: 14, height: 14, cursor: "pointer", accentColor: "#4b7bec" },
              onChange: () => setManagerSource("copy")
            }),
            (0, import_react.createElement)("span", { style: style.line }, t("confirm.source.copy"))
          ),
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
          )
        ),
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
    renderDialog()
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

// src/client-plugin.js
var name = "dsh-packforge";
var inject = ["slots", "locale", "connection"];
function apply(ctx) {
  console.error("[dsh-pack][client] apply slots=" + !!ctx?.slots + " locale=" + !!ctx?.locale + " connection=" + !!ctx?.connection + " rpc=" + !!ctx?.connection?.rpc);
  const rpc = createRpc(ctx);
  registerSettingsSection(ctx, { rpc });
}
    return module.exports;
  },
});
