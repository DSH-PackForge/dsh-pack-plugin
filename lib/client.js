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
    "result.pending": "\u5904\u7406\u4E2D\u2026",
    "result.noRpc": "\u540E\u7AEF RPC \u4E0D\u53EF\u7528\uFF08connection \u670D\u52A1\u7F3A\u5931\uFF09",
    "err.name": "\u8BF7\u586B\u5199 profile \u540D",
    "err.source": "\u8BF7\u586B\u5199 .dspack \u8DEF\u5F84\u6216 URL",
    "profile.active": "\u5F53\u524D",
    "market.loading": "\u52A0\u8F7D\u5E02\u573A\u4E2D\u2026",
    "market.empty": "\u5E02\u573A\u6682\u65E0\u5185\u5BB9",
    "market.error": "\u5E02\u573A\u52A0\u8F7D\u5931\u8D25",
    "market.none": "\uFF08\u65E0\uFF09"
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
    "result.noRpc": "Backend RPC unavailable (no connection service)",
    "err.name": "Please fill a profile name",
    "err.source": "Please fill a .dspack path or URL",
    "profile.active": "current",
    "market.loading": "Loading market\u2026",
    "market.empty": "Market is empty",
    "market.error": "Market load failed",
    "market.none": "(none)"
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
  const [tab, setTab] = (0, import_react.useState)("manage");
  const [profiles, setProfiles] = (0, import_react.useState)([]);
  const [result, setResult] = (0, import_react.useState)(null);
  const [mode, setMode] = (0, import_react.useState)(null);
  const [newName, setNewName] = (0, import_react.useState)("");
  const [source, setSource] = (0, import_react.useState)("");
  const [market, setMarket] = (0, import_react.useState)(null);
  const [meta, setMeta] = (0, import_react.useState)({});
  const [exportProfile, setExportProfile] = (0, import_react.useState)("");
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
  (0, import_react.useEffect)(() => {
    void refresh();
  }, []);
  const active = profiles.find((p) => p.active) ?? null;
  const showOk = (text) => setResult({ ok: true, text });
  const showErr = (error) => setResult({ ok: false, error });
  const doSwitch = async (name2) => {
    setResult({ pending: true });
    const r = await call("profile/switch", { name: name2 });
    if (!r.ok) return showErr(r.error);
    showOk(`\u5DF2\u5207\u6362\u5230\u300C${name2}\u300D\uFF0C\u91CD\u542F DSH \u540E\u751F\u6548`);
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
    const v = r.value;
    showOk(v.mode === "repo" ? `\u5DF2\u5BFC\u51FA\u4ED3\u5E93 ${v.dir}\uFF08${v.name}@${v.version}\uFF09` : `\u5DF2\u5BFC\u51FA ${v.output}\uFF08${v.size} \u5B57\u8282\uFF09`);
  };
  const doOpenDir = async (name2) => {
    const r = await call("profile/open-dir", { name: name2 });
    if (r.ok) showOk(`\u5DF2\u6253\u5F00 ${r.value.dir}`);
    else showErr(r.error);
  };
  const doCreate = async () => {
    const name2 = newName.trim();
    if (!name2) return showErr(t("err.name"));
    setResult({ pending: true });
    const r = await call("profile/create", { name: name2 });
    if (!r.ok) return showErr(r.error);
    showOk(`\u5DF2\u521B\u5EFA profile\u300C${name2}\u300D`);
    setNewName("");
    setMode(null);
    void refresh();
  };
  const doImport = async () => {
    const src = source.trim();
    if (!src) return showErr(t("err.source"));
    setResult({ pending: true });
    const r = await call("pack/install", { source: src });
    if (!r.ok) return showErr(r.error);
    showOk(`\u5DF2\u5B89\u88C5 profile\u300C${r.value.profileName}\u300D\u2192 ${r.value.dir}`);
    setSource("");
    setMode(null);
    void refresh();
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
    const r = await call("pack/install", { source: src });
    if (!r.ok) return showErr(r.error);
    showOk(`\u5DF2\u5B89\u88C5 profile\u300C${r.value.profileName}\u300D\u2192 ${r.value.dir}`);
    void refresh();
  };
  const doExportFromForm = async () => {
    setResult({ pending: true });
    const overrides = {};
    for (const k of META_FIELDS) {
      const v2 = (meta[k] ?? "").trim();
      if (v2) overrides[k] = v2;
    }
    if (exportProfile) overrides.profile = exportProfile;
    const r = await call("pack/export", overrides);
    if (!r.ok) return showErr(r.error);
    const v = r.value;
    showOk(v.mode === "repo" ? `\u5DF2\u5BFC\u51FA\u4ED3\u5E93 ${v.dir}\uFF08${v.name}@${v.version}\uFF09` : `\u5DF2\u5BFC\u51FA ${v.output}\uFF08${v.size} \u5B57\u8282\uFF09`);
  };
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
    grow: { flex: 1 },
    btn: {
      height: 30,
      padding: "0 12px",
      borderRadius: 15,
      border: "none",
      cursor: "pointer",
      fontSize: 13,
      lineHeight: "18px",
      background: "var(--dsw-alias-button-primary-fill)",
      color: "var(--dsw-alias-label-primary-foreground)",
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
    sectionBox: { display: "flex", flexDirection: "column", gap: 8, paddingBottom: 14, marginBottom: 14, borderBottom: "1px solid var(--dsw-alias-border-l2)" },
    sectionBoxLast: { display: "flex", flexDirection: "column", gap: 8 },
    hint: { margin: "4px 0 0", fontSize: 12, lineHeight: "18px", color: "var(--dsw-alias-label-tertiary)" },
    ok: { margin: 0, fontSize: 12, lineHeight: "18px", color: "var(--dsw-alias-success)", whiteSpace: "pre-wrap", wordBreak: "break-all" },
    err: { margin: 0, fontSize: 12, lineHeight: "18px", color: "var(--dsw-alias-danger)", whiteSpace: "pre-wrap", wordBreak: "break-all" }
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
          p.active ? null : (0, import_react.createElement)("button", { type: "button", style: style.btnSmall, onClick: () => doSwitch(p.name) }, t("action.switch")),
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
          (0, import_react.createElement)("button", { type: "button", style: style.btn, disabled: !rpc || !active, onClick: () => doOpenDir(active?.name) }, t("action.openDir"))
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
          (0, import_react.createElement)("button", { type: "button", style: style.btn, disabled: !rpc, onClick: () => setMode(mode === "create" ? null : "create") }, t("action.newEmpty")),
          (0, import_react.createElement)("button", { type: "button", style: style.btn, disabled: !rpc, onClick: () => setMode(mode === "import" ? null : "import") }, t("action.import")),
          (0, import_react.createElement)("button", { type: "button", style: style.btn, disabled: !rpc, onClick: () => {
            setTab("market");
            void loadMarket();
          } }, t("action.market"))
        ),
        mode === "create" ? (0, import_react.createElement)(
          "div",
          { style: style.row },
          (0, import_react.createElement)("input", { style: { ...style.input, ...style.grow }, placeholder: t("field.newName"), value: newName, onInput: (e) => setNewName(e.target.value) }),
          (0, import_react.createElement)("button", { type: "button", style: style.btnSmall, disabled: !rpc, onClick: doCreate }, t("action.create"))
        ) : null,
        mode === "import" ? (0, import_react.createElement)(
          "div",
          { style: style.row },
          (0, import_react.createElement)("input", { style: { ...style.input, ...style.grow }, placeholder: t("field.source"), value: source, onInput: (e) => setSource(e.target.value) }),
          (0, import_react.createElement)("button", { type: "button", style: style.btnSmall, disabled: !rpc, onClick: doImport }, t("action.install"))
        ) : null
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
      ...META_FIELDS.slice(0, 6).map(fieldInput)
    ),
    (0, import_react.createElement)(
      "div",
      { style: style.group },
      (0, import_react.createElement)("div", { style: style.groupTitle }, t("group.output")),
      ...META_FIELDS.slice(6).map(fieldInput),
      (0, import_react.createElement)(
        "label",
        { style: style.field },
        (0, import_react.createElement)("span", { style: style.fieldLabel }, t("field.profile")),
        (0, import_react.createElement)(
          "select",
          { style: style.input, value: exportProfile, onChange: (e) => setExportProfile(e.target.value) },
          profiles.map((p) => (0, import_react.createElement)("option", { key: p.name, value: p.name }, p.name + (p.active ? `\uFF08${t("profile.active")}\uFF09` : "")))
        )
      )
    ),
    (0, import_react.createElement)("button", { type: "button", style: style.btn, disabled: !rpc, onClick: doExportFromForm }, t("action.export"))
  );
  const renderMarket = () => {
    if (market === void 0) return (0, import_react.createElement)("p", { style: style.line }, t("market.loading"));
    if (market.error) return (0, import_react.createElement)("p", { style: style.err }, `${t("market.error")}\uFF1A${market.error}`);
    const packs = market.packs ?? [];
    if (packs.length === 0) return (0, import_react.createElement)("p", { style: style.line }, t("market.empty"));
    return (0, import_react.createElement)(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: 8 } },
      (0, import_react.createElement)("p", { style: style.line }, `\u5E02\u573A\u5171 ${packs.length} \u4E2A\u6574\u5408\u5305`),
      (0, import_react.createElement)(
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
      )
    );
  };
  const content = tab === "manage" ? renderManage() : tab === "export" ? renderExport() : renderMarket();
  return (0, import_react.createElement)(
    "div",
    { style: style.section },
    (0, import_react.createElement)(
      "div",
      { style: style.tabs },
      ["manage", "export", "market"].map((id) => (0, import_react.createElement)("button", {
        key: id,
        type: "button",
        style: tab === id ? { ...style.tab, ...style.tabActive } : style.tab,
        onClick: () => {
          setTab(id);
          if (id === "market" && market === null) void loadMarket();
        }
      }, t("tab." + id)))
    ),
    content,
    tab === "manage" ? (0, import_react.createElement)("p", { style: style.hint }, t("hint.restart")) : null,
    result ? (0, import_react.createElement)(
      "p",
      { style: result.ok === false ? style.err : style.ok },
      result.pending ? t("result.pending") : (result.ok ? "\u2713 " : "\u2717 ") + (result.text ?? result.error)
    ) : null
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
  console.error("[dsh-pack][client] apply slots=" + !!ctx?.slots + " locale=" + !!ctx?.locale + " connection=" + !!ctx?.connection + " rpc=" + !!ctx?.connection?.rpc);
  const rpc = createRpc(ctx);
  registerSettingsSection(ctx, { rpc });
}
    return module.exports;
  },
});
