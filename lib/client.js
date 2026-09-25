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
var NS = "dspack";
var dict = {
  zh: {
    nav: "\u6574\u5408\u5305",
    title: "\u6574\u5408\u5305",
    intro: "\u628A profile \u5BFC\u51FA\u4E3A .dspack\u3001\u4ECE .dspack \u5B89\u88C5\u3001\u6216\u5728\u591A\u4E2A profile \u4E4B\u95F4\u5207\u6362\u3002",
    "group.meta": "\u5143\u6570\u636E\uFF08\u7559\u7A7A\u7528 profile \u9ED8\u8BA4\uFF09",
    "group.output": "\u8F93\u51FA",
    "group.content": "\u5BFC\u51FA\u5185\u5BB9",
    "group.install": "\u5B89\u88C5 / \u67E5\u770B",
    "group.profile": "\u591A profile",
    "field.name": "\u6574\u5408\u5305\u540D",
    "field.version": "\u7248\u672C",
    "field.displayName": "\u5C55\u793A\u540D",
    "field.description": "\u63CF\u8FF0",
    "field.author": "\u4F5C\u8005",
    "field.icon": "\u56FE\u6807 URL",
    "field.dshVersion": "DSH \u7248\u672C\uFF08\u7559\u7A7A\u53D6\u6700\u65B0\u5DF2\u88C5\uFF09",
    "field.out": "\u8F93\u51FA\u76EE\u5F55\uFF08\u7559\u7A7A\u7528\u5F53\u524D\u76EE\u5F55\uFF09",
    "field.source": ".dspack \u8DEF\u5F84\u6216 URL",
    "field.newName": "\u65B0 profile \u540D",
    "export.skill": "skills/ \u6280\u80FD",
    "export.preset": ".agent-presets/ \u9884\u8BBE",
    "export.instruction": "AGENTS.md \u6307\u4EE4",
    "export.data": "data/ \u6570\u636E",
    "action.export": "\u5BFC\u51FA",
    "action.install": "\u5B89\u88C5",
    "action.view": "\u67E5\u770B",
    "action.market": "\u6D4F\u89C8\u5E02\u573A",
    "action.refresh": "\u5237\u65B0 profile",
    "action.create": "\u65B0\u5EFA profile",
    "action.switch": "\u5207\u6362",
    "result.pending": "\u5904\u7406\u4E2D\u2026",
    "result.noRpc": "\u540E\u7AEF RPC \u4E0D\u53EF\u7528\uFF08connection \u670D\u52A1\u7F3A\u5931\uFF09",
    "err.source": "\u8BF7\u586B\u5199 .dspack \u8DEF\u5F84\u6216 URL",
    "err.name": "\u8BF7\u586B\u5199 profile \u540D",
    "profile.active": "\u5F53\u524D"
  },
  en: {
    nav: "Modpacks",
    title: "Modpacks",
    intro: "Export a profile as .dspack, install from .dspack, or switch between profiles.",
    "group.meta": "Metadata (blank = profile default)",
    "group.output": "Output",
    "group.content": "Export content",
    "group.install": "Install / inspect",
    "group.profile": "Profiles",
    "field.name": "Pack name",
    "field.version": "Version",
    "field.displayName": "Display name",
    "field.description": "Description",
    "field.author": "Author",
    "field.icon": "Icon URL",
    "field.dshVersion": "DSH version (blank = latest)",
    "field.out": "Output dir (blank = current)",
    "field.source": ".dspack path or URL",
    "field.newName": "New profile name",
    "export.skill": "skills/ skills",
    "export.preset": ".agent-presets/ presets",
    "export.instruction": "AGENTS.md instruction",
    "export.data": "data/ data",
    "action.export": "Export",
    "action.install": "Install",
    "action.view": "Inspect",
    "action.market": "Browse market",
    "action.refresh": "Refresh profiles",
    "action.create": "New profile",
    "action.switch": "Switch",
    "result.pending": "Working\u2026",
    "result.noRpc": "Backend RPC unavailable (no connection service)",
    "err.source": "Please fill a .dspack path or URL",
    "err.name": "Please fill a profile name",
    "profile.active": "current"
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
var META_FIELDS = ["name", "version", "displayName", "description", "author", "icon", "dshVersion", "out"];
function DspackSection({ t, packforge }) {
  const rpc = packforge?.rpc;
  const [profiles, setProfiles] = (0, import_react.useState)([]);
  const fields = {};
  let resultEl = null;
  const ref = (key) => (el) => {
    fields[key] = el;
  };
  const showResult = (r) => {
    if (!resultEl) return;
    if (r?.pending) {
      resultEl.textContent = t("result.pending");
      return;
    }
    resultEl.textContent = r?.ok ? `\u2713 ${r.text}` : `\u2717 ${r.error}`;
  };
  const callRpc = async (endpoint, payload) => {
    if (!rpc) {
      showResult({ ok: false, error: t("result.noRpc") });
      return { ok: false, error: t("result.noRpc") };
    }
    try {
      const res = await rpc.call(endpoint, payload ?? {});
      if (res?.ok) return { ok: true, value: res.value };
      return { ok: false, error: res?.error?.message ?? String(res?.error ?? "\u5931\u8D25") };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  };
  const collectMeta = () => {
    const overrides = {};
    for (const key of META_FIELDS) {
      const v = fields[key]?.value?.trim();
      if (v) overrides[key] = v;
    }
    overrides.exportContent = {
      skill: fields.skill?.checked ?? true,
      preset: fields.preset?.checked ?? true,
      instruction: fields.instruction?.checked ?? true,
      data: fields.data?.checked ?? true
    };
    return overrides;
  };
  const doExport = async () => {
    showResult({ pending: true });
    const r = await callRpc("pack/export", collectMeta());
    if (!r.ok) return showResult(r);
    const v = r.value;
    showResult({
      ok: true,
      text: v.mode === "repo" ? `\u5DF2\u5BFC\u51FA\u4ED3\u5E93 ${v.dir}\uFF08${v.name}@${v.version}\uFF09` : `\u5DF2\u5BFC\u51FA ${v.output}\uFF08${v.size} \u5B57\u8282\uFF09`
    });
  };
  const doInstall = async () => {
    const source = fields.source?.value?.trim();
    if (!source) return showResult({ ok: false, error: t("err.source") });
    showResult({ pending: true });
    const r = await callRpc("pack/install", { source });
    if (!r.ok) return showResult(r);
    showResult({ ok: true, text: `\u5DF2\u5B89\u88C5 profile\u300C${r.value.profileName}\u300D\u2192 ${r.value.dir}` });
  };
  const doView = async () => {
    const source = fields.source?.value?.trim();
    if (!source) return showResult({ ok: false, error: t("err.source") });
    showResult({ pending: true });
    const r = await callRpc("pack/view", { source });
    if (!r.ok) return showResult(r);
    const v = r.value;
    showResult({
      ok: true,
      text: v.valid ? `\u6574\u5408\u5305 ${v.name}@${v.version} \u5408\u6CD5\uFF08${v.size} \u5B57\u8282\uFF09` : `\u4E0D\u5408\u6CD5\uFF1A${(v.validation ?? []).join("\uFF1B")}`
    });
  };
  const doMarket = async () => {
    showResult({ pending: true });
    const r = await callRpc("pack/market", {});
    if (!r.ok) return showResult(r);
    const packs = r.value.packs ?? [];
    showResult({
      ok: true,
      text: `\u5E02\u573A ${packs.length} \u4E2A\u5305\uFF1A
` + packs.map((p) => `- ${p.name}@${p.version ?? "?"}`).join("\n")
    });
  };
  const refreshProfiles = async () => {
    const r = await callRpc("profile/list", {});
    if (r.ok) setProfiles(r.value.profiles ?? []);
    else showResult(r);
  };
  const doSwitch = async (name2) => {
    showResult({ pending: true });
    const r = await callRpc("profile/switch", { name: name2 });
    if (!r.ok) return showResult(r);
    showResult({ ok: true, text: `\u5DF2\u5207\u6362\u5230\u300C${name2}\u300D\uFF08\u539F\u300C${r.value.previous}\u300D\uFF09\uFF0C\u91CD\u542F DSH \u540E\u751F\u6548` });
    await refreshProfiles();
  };
  const doCreateProfile = async () => {
    const name2 = fields.newName?.value?.trim();
    if (!name2) return showResult({ ok: false, error: t("err.name") });
    showResult({ pending: true });
    const r = await callRpc("profile/create", { name: name2 });
    if (!r.ok) return showResult(r);
    showResult({ ok: true, text: `\u5DF2\u521B\u5EFA profile\u300C${name2}\u300D` });
    await refreshProfiles();
  };
  const style = {
    section: { display: "flex", flexDirection: "column", gap: 12, maxWidth: 720, padding: "8px 0" },
    title: { margin: 0, fontSize: 16, fontWeight: 500, lineHeight: "24px" },
    intro: { margin: 0, fontSize: 14, lineHeight: "22px", color: "var(--dsw-alias-label-tertiary)" },
    group: { display: "flex", flexDirection: "column", gap: 6 },
    groupTitle: { margin: "8px 0 0", fontSize: 13, fontWeight: 600, lineHeight: "20px", color: "var(--dsw-alias-label-primary)" },
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
    row: { display: "flex", gap: 8, alignItems: "center" },
    grow: { flex: 1 },
    check: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer" },
    checkInput: { margin: 0 },
    checkLabel: { fontSize: 13, lineHeight: "20px", color: "var(--dsw-alias-label-primary)" },
    actions: { display: "flex", gap: 8, margin: "4px 0 0", padding: 0, listStyle: "none", flexWrap: "wrap" },
    btn: {
      height: 36,
      padding: "0 14px",
      borderRadius: 18,
      border: "none",
      cursor: "pointer",
      fontSize: 14,
      lineHeight: "22px",
      background: "var(--dsw-alias-button-primary-fill)",
      color: "var(--dsw-alias-label-primary-foreground)",
      font: "inherit"
    },
    btnSmall: {
      height: 28,
      padding: "0 12px",
      borderRadius: 14,
      border: "1px solid var(--dsw-alias-border-l2)",
      cursor: "pointer",
      fontSize: 12,
      lineHeight: "18px",
      background: "var(--dsw-alias-bg-layer-1)",
      color: "var(--dsw-alias-label-primary)",
      font: "inherit"
    },
    profileList: { margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 },
    profileItem: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },
    profileName: { fontSize: 13, lineHeight: "20px", color: "var(--dsw-alias-label-primary)" },
    result: { margin: 0, fontSize: 12, lineHeight: "18px", color: "var(--dsw-alias-label-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-all" }
  };
  const textField = (key) => (0, import_react.createElement)(
    "label",
    { style: style.field, key },
    (0, import_react.createElement)("span", { style: style.fieldLabel }, t("field." + key)),
    (0, import_react.createElement)("input", { style: style.input, ref: ref(key) })
  );
  const checkbox = (key) => (0, import_react.createElement)(
    "label",
    { style: style.check, key },
    (0, import_react.createElement)("input", { type: "checkbox", style: style.checkInput, defaultChecked: true, ref: ref(key) }),
    (0, import_react.createElement)("span", { style: style.checkLabel }, t("export." + key))
  );
  return (0, import_react.createElement)(
    "div",
    { style: style.section },
    (0, import_react.createElement)("h2", { style: style.title }, t("title")),
    (0, import_react.createElement)("p", { style: style.intro }, t("intro")),
    (0, import_react.createElement)(
      "div",
      { style: style.group },
      (0, import_react.createElement)("div", { style: style.groupTitle }, t("group.meta")),
      ...META_FIELDS.slice(0, 6).map(textField)
    ),
    (0, import_react.createElement)(
      "div",
      { style: style.group },
      (0, import_react.createElement)("div", { style: style.groupTitle }, t("group.output")),
      ...META_FIELDS.slice(6).map(textField)
    ),
    (0, import_react.createElement)(
      "div",
      { style: style.group },
      (0, import_react.createElement)("div", { style: style.groupTitle }, t("group.content")),
      checkbox("skill"),
      checkbox("preset"),
      checkbox("instruction"),
      checkbox("data")
    ),
    (0, import_react.createElement)(
      "ul",
      { style: style.actions },
      (0, import_react.createElement)(
        "li",
        { key: "export" },
        (0, import_react.createElement)("button", { type: "button", style: style.btn, disabled: !rpc, onClick: doExport }, t("action.export"))
      )
    ),
    (0, import_react.createElement)(
      "div",
      { style: style.group },
      (0, import_react.createElement)("div", { style: style.groupTitle }, t("group.install")),
      (0, import_react.createElement)(
        "label",
        { style: style.field },
        (0, import_react.createElement)("span", { style: style.fieldLabel }, t("field.source")),
        (0, import_react.createElement)("input", { style: style.input, ref: ref("source") })
      ),
      (0, import_react.createElement)(
        "ul",
        { style: style.actions },
        (0, import_react.createElement)(
          "li",
          { key: "install" },
          (0, import_react.createElement)("button", { type: "button", style: style.btn, disabled: !rpc, onClick: doInstall }, t("action.install"))
        ),
        (0, import_react.createElement)(
          "li",
          { key: "view" },
          (0, import_react.createElement)("button", { type: "button", style: style.btn, disabled: !rpc, onClick: doView }, t("action.view"))
        ),
        (0, import_react.createElement)(
          "li",
          { key: "market" },
          (0, import_react.createElement)("button", { type: "button", style: style.btn, disabled: !rpc, onClick: doMarket }, t("action.market"))
        )
      )
    ),
    (0, import_react.createElement)(
      "div",
      { style: style.group },
      (0, import_react.createElement)("div", { style: style.groupTitle }, t("group.profile")),
      (0, import_react.createElement)(
        "ul",
        { style: style.actions },
        (0, import_react.createElement)(
          "li",
          { key: "refresh" },
          (0, import_react.createElement)("button", { type: "button", style: style.btnSmall, disabled: !rpc, onClick: refreshProfiles }, t("action.refresh"))
        )
      ),
      (0, import_react.createElement)(
        "ul",
        { style: style.profileList },
        profiles.map(
          (p) => (0, import_react.createElement)(
            "li",
            { key: p.name, style: style.profileItem },
            (0, import_react.createElement)("span", { style: style.profileName }, p.name + (p.active ? `\uFF08${t("profile.active")}\uFF09` : "")),
            !p.active ? (0, import_react.createElement)("button", { type: "button", style: style.btnSmall, onClick: () => doSwitch(p.name) }, t("action.switch")) : null
          )
        )
      ),
      (0, import_react.createElement)(
        "div",
        { style: style.row },
        (0, import_react.createElement)("input", { style: { ...style.input, ...style.grow }, placeholder: t("field.newName"), ref: ref("newName") }),
        (0, import_react.createElement)("button", { type: "button", style: style.btnSmall, disabled: !rpc, onClick: doCreateProfile }, t("action.create"))
      )
    ),
    (0, import_react.createElement)("p", { style: style.result, ref: (el) => {
      resultEl = el;
    } })
  );
}

// src/channel.js
var CHANNEL = "/dsh-pack";

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
  const rpc = createRpc(ctx);
  registerSettingsSection(ctx, { rpc });
}
    return module.exports;
  },
});
