// DSH 客户端插件 · 整合包管理器主面板（三 Tab：管理 / 导出 / 市场）。
//
// 所有按钮经 ctx.connection.rpc 直连宿主 endpoint（静默，不进聊天栏），
// 业务逻辑全在宿主 endpoint 层；这里只做表单收集 + 结果展示。
//
// slots 契约（已从 DSH 源码确证）：
//   ctx.slots.inject("settings.section", () => ctx.slots.register(options, Component))
import { createElement as h, useState, useEffect, Fragment } from 'react';
import { PROFILE_NAME_RE, RESERVED_PROFILE_NAMES } from './channel.js';

const NS = 'dspack';
const MANAGER_PKG = '@dsh-packforge/dsh-pack-plugin';

const dict = {
  zh: {
    nav: '整合包',
    'tab.manage': '管理',
    'tab.export': '导出',
    'tab.market': '市场',
    'running.title': '正在运行的整合包',
    'running.profile': 'profile名：',
    'action.openDir': '打开目录',
    'create.title': '创建整合包',
    'action.newEmpty': '空整合包',
    'action.import': '导入新包',
    'action.market': '浏览市场',
    'action.refresh': '刷新',
    'installed.title': '已安装的整合包',
    'action.delete': '删除',
    'hint.restart': '点切换后重启生效',
    'group.meta': '元数据（留空用 profile 默认）',
    'group.output': '输出',
    'field.name': '整合包名',
    'field.version': '版本',
    'field.displayName': '展示名',
    'field.description': '描述',
    'field.author': '作者',
    'field.icon': '图标 URL',
    'field.dshVersion': 'DSH 版本（留空取最新已装）',
    'field.out': '输出目录（留空用当前目录）',
    'field.profile': '导出 profile（默认当前）',
    'field.source': '.dspack 路径或 URL',
    'field.newName': '新 profile 名',
    'action.export': '导出',
    'action.install': '安装',
    'action.switch': '切换',
    'action.create': '新建',
    'action.save': '保存',
    'action.load': '读取',
    'field.profileName': '安装名（覆盖 manifest profileName）',
    'field.mode': '导出形态',
    'mode.dspack': '单文件（.dspack）',
    'mode.repo': '源仓库',
    'field.content': '仓库内容档',
    'content.manifest': '仅清单（manifest.json）',
    'content.readme': '清单 + README',
    'content.full': '全套文件（overrides/ + release/）',
    'group.content': '导出内容（上一级目录开关）',
    'content.skill': '导出 skills/',
    'content.preset': '导出 .agent-presets/',
    'content.instruction': '导出 AGENTS.md',
    'result.saved': '已保存工作区配置',
    'result.loaded': '已读取工作区配置',
    'result.noCfg': '该 profile 暂无已保存的工作区配置',
    'result.pending': '处理中…',
    'result.noRpc': '后端 RPC 不可用（connection 服务缺失）',
    'err.name': '请填写 profile 名',
    'err.source': '请填写 .dspack 路径或 URL',
    'err.nameInvalid': '名字格式不对：只能用小写字母、数字和连字符（如 aaa-bb-c）',
    'err.nameReserved': '「{name}」是保留名，不能作为 profile 名',
    'hint.nameFormat': '小写字母、数字，用连字符分隔，如 aaa-bb-c',
    'hint.import': '.dspack 文件路径或 URL',
    'dialog.createTitle': '创建空的整合包',
    'dialog.importTitle': '导入新包',
    'profile.active': '当前',
    'market.loading': '加载市场中…',
    'market.empty': '市场暂无内容',
    'market.error': '市场加载失败',
    'market.none': '（无）',
    'confirm.title': '切换 profile',
    'confirm.from': '当前',
    'confirm.to': '目标',
    'confirm.firstTime': '首次切换：会把当前目录存档为 default',
    'confirm.warning': '检测到目标 profile 没有 {pkg}，将自动安装。若没有此插件，将无法从应用内再次切换 profile。',
    'confirm.cancel': '取消',
    'confirm.ok': '确认切换',
  },
  en: {
    nav: 'Modpacks',
    'tab.manage': 'Manage',
    'tab.export': 'Export',
    'tab.market': 'Market',
    'running.title': 'Running modpack',
    'running.profile': 'profile: ',
    'action.openDir': 'Open folder',
    'create.title': 'Create modpack',
    'action.newEmpty': 'Empty pack',
    'action.import': 'Import pack',
    'action.market': 'Browse market',
    'action.refresh': 'Refresh',
    'installed.title': 'Installed modpacks',
    'action.delete': 'Delete',
    'hint.restart': 'Takes effect after restart',
    'group.meta': 'Metadata (blank = profile default)',
    'group.output': 'Output',
    'field.name': 'Pack name',
    'field.version': 'Version',
    'field.displayName': 'Display name',
    'field.description': 'Description',
    'field.author': 'Author',
    'field.icon': 'Icon URL',
    'field.dshVersion': 'DSH version (blank = latest)',
    'field.out': 'Output dir (blank = current)',
    'field.profile': 'Profile to export (default: active)',
    'field.source': '.dspack path or URL',
    'field.newName': 'New profile name',
    'action.export': 'Export',
    'action.install': 'Install',
    'action.switch': 'Switch',
    'action.create': 'Create',
    'result.pending': 'Working…',
    'result.noRpc': 'Backend RPC unavailable (no connection service)',
    'err.name': 'Please fill a profile name',
    'err.source': 'Please fill a .dspack path or URL',
    'err.nameInvalid': 'Invalid name: lowercase letters, digits and hyphens only (e.g. aaa-bb-c)',
    'err.nameReserved': '"{name}" is a reserved name and cannot be used as a profile name',
    'hint.nameFormat': 'Lowercase letters and digits separated by hyphens, e.g. aaa-bb-c',
    'hint.import': '.dspack file path or URL',
    'dialog.createTitle': 'Create empty modpack',
    'dialog.importTitle': 'Import modpack',
    'profile.active': 'current',
    'market.loading': 'Loading market…',
    'market.empty': 'Market is empty',
    'market.error': 'Market load failed',
    'market.none': '(none)',
    'confirm.title': 'Switch profile',
    'confirm.from': 'current',
    'confirm.to': 'target',
    'confirm.firstTime': 'First switch: current folder will be archived as default',
    'confirm.warning': 'Target profile has no {pkg}; it will be installed automatically. Without it you cannot switch again from inside the app.',
    'confirm.cancel': 'Cancel',
    'confirm.ok': 'Confirm switch',
  },
};

export function registerSettingsSection(ctx, packforge = {}) {
  const slots = ctx?.slots;
  const locale = ctx?.locale;
  if (!slots || typeof slots.inject !== 'function') return false;
  if (!locale || typeof locale.register !== 'function' || typeof locale.bind !== 'function') return false;

  const registerLocale = () => {
    locale.register(NS, dict);
  };
  if (typeof ctx.effect === 'function') ctx.effect(registerLocale, 'dspack: settings dict');
  else registerLocale();

  const t = locale.bind(NS);

  slots.inject('settings.section', () =>
    slots.register(
      {
        name: 'settings.section',
        id: 'dspack',
        order: 20,
        label: () => t('nav'),
        locale: NS,
        inject: () => ({ t, packforge }),
      },
      DspackSection,
    ),
  );
  return true;
}

const META_FIELDS = ['name', 'version', 'displayName', 'description', 'author', 'icon', 'profileName'];
const OUTPUT_FIELDS = ['dshVersion', 'out'];
const MODES = ['dspack', 'repo'];
const CONTENT_LEVELS = ['manifest', 'readme', 'full'];
const CONTENT_TOGGLES = ['skill', 'preset', 'instruction'];

export function DspackSection({ t, packforge }) {
  const rpc = packforge?.rpc;
  const [tab, setTab] = useState('manage');
  const [profiles, setProfiles] = useState([]);
  const [result, setResult] = useState(null); // null | {pending:true} | {ok:true,text} | {ok:false,error}
  const [dialog, setDialog] = useState(null); // null | 'create' | 'import'
  const [newName, setNewName] = useState('');
  const [source, setSource] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [market, setMarket] = useState(null); // null=未加载 undefined=加载中 {packs,error}
  const [meta, setMeta] = useState({});
  const [exportProfile, setExportProfile] = useState('');
  const [mode, setMode] = useState('dspack');
  const [contentLevel, setContentLevel] = useState('readme');
  const [exportContent, setExportContent] = useState({ skill: false, preset: false, instruction: false });
  const [loadedFor, setLoadedFor] = useState(null); // 已自动加载过配置的 profile 名
  const [confirm, setConfirm] = useState(null); // null | {from,to,hasManager,firstTime}

  const call = async (endpoint, payload) => {
    if (!rpc) return { ok: false, error: t('result.noRpc') };
    try {
      const res = await rpc.call(endpoint, payload ?? {});
      return res?.ok ? { ok: true, value: res.value } : { ok: false, error: res?.error?.message ?? String(res?.error ?? '失败') };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  };

  const refresh = async () => {
    const r = await call('profile/list', {});
    if (r.ok) {
      const list = r.value.profiles ?? [];
      setProfiles(list);
      setExportProfile((prev) => prev || list.find((p) => p.active)?.name || list[0]?.name || '');
    } else setResult(r);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void refresh(); }, []);

  const active = profiles.find((p) => p.active) ?? null;

  const showOk = (text) => setResult({ ok: true, text });
  const showErr = (error) => setResult({ ok: false, error });

  // 点击「切换」先做只读预检，弹确认窗；用户点「确认切换」才真正调 profile/switch。
  const askSwitch = async (name) => {
    const r = await call('profile/switch-check', { name });
    if (!r.ok) return showErr(r.error);
    setConfirm({
      from: r.value.from,
      to: r.value.to,
      hasManager: r.value.hasManager,
      firstTime: r.value.firstTime,
    });
  };

  const confirmSwitch = async () => {
    if (!confirm) return;
    const name = confirm.to;
    setConfirm(null);
    setResult({ pending: true });
    const r = await call('profile/switch', { name });
    if (!r.ok) return showErr(r.error);
    showOk(r.value?.restarting
      ? `切换中：桌面将自动重启到「${name}」`
      : `已切换到「${name}」，重启 DSH 后生效`);
    void refresh();
  };

  const doDelete = async (name) => {
    setResult({ pending: true });
    const r = await call('profile/delete', { name });
    if (!r.ok) return showErr(r.error);
    showOk(`已删除「${name}」`);
    void refresh();
  };

  const doExportProfile = async (name) => {
    setResult({ pending: true });
    const r = await call('pack/export', name ? { profile: name } : {});
    if (!r.ok) return showErr(r.error);
    const v = r.value;
    showOk(v.mode === 'repo' ? `已导出仓库 ${v.dir}（${v.name}@${v.version}）` : `已导出 ${v.output}（${v.size} 字节）`);
  };

  const doOpenDir = async (name) => {
    const r = await call('profile/open-dir', { name });
    if (r.ok) showOk(`已打开 ${r.value.dir}`);
    else showErr(r.error);
  };

  // 弹窗：点「空整合包」/「导入新包」打开，收集名字/路径，校验通过才提交。
  const openDialog = (type) => {
    setFieldError('');
    setSubmitting(false);
    setDialog(type);
  };

  const closeDialog = () => {
    setDialog(null);
    setFieldError('');
    setSubmitting(false);
  };

  const doCreate = async () => {
    const name = newName.trim();
    if (!name) return setFieldError(t('err.name'));
    if (!PROFILE_NAME_RE.test(name)) return setFieldError(t('err.nameInvalid'));
    if (RESERVED_PROFILE_NAMES.includes(name)) return setFieldError(t('err.nameReserved').replace('{name}', name));
    setSubmitting(true);
    const r = await call('profile/create', { name });
    setSubmitting(false);
    if (!r.ok) return setFieldError(r.error);
    setNewName('');
    closeDialog();
    showOk(`已创建 profile「${name}」`);
    void refresh();
  };

  const doImport = async () => {
    const src = source.trim();
    if (!src) return setFieldError(t('err.source'));
    setSubmitting(true);
    const r = await call('pack/install', { source: src });
    setSubmitting(false);
    if (!r.ok) return setFieldError(r.error);
    setSource('');
    closeDialog();
    showOk(`已安装 profile「${r.value.profileName}」→ ${r.value.dir}`);
    void refresh();
  };

  const loadMarket = async () => {
    setMarket(undefined);
    const r = await call('pack/market', {});
    if (r.ok) setMarket({ packs: r.value.packs ?? [], error: r.value.error ?? null });
    else setMarket({ packs: [], error: r.error });
  };

  const doInstallFromMarket = async (pack) => {
    const src = pack?.downloadUrl || pack?.urls?.[0];
    if (!src) return showErr('该包没有可下载地址');
    setResult({ pending: true });
    const r = await call('pack/install', {
      source: src,
      expectedSha256: pack?.sha256 || undefined,
      expectedSize: pack?.size || undefined,
    });
    if (!r.ok) return showErr(r.error);
    showOk(`已安装 profile「${r.value.profileName}」→ ${r.value.dir}`);
    void refresh();
  };

  const doExportFromForm = async () => {
    setResult({ pending: true });
    const overrides = {};
    for (const k of [...META_FIELDS, ...OUTPUT_FIELDS]) {
      const v = (meta[k] ?? '').trim();
      if (v) overrides[k] = v;
    }
    overrides.profile = exportProfile;
    overrides.mode = mode;
    overrides.content = contentLevel;
    overrides.exportContent = {
      skill: !!exportContent.skill,
      preset: !!exportContent.preset,
      instruction: !!exportContent.instruction,
    };
    const r = await call('pack/export', overrides);
    if (!r.ok) return showErr(r.error);
    const v = r.value;
    showOk(v.mode === 'repo' ? `已导出仓库 ${v.dir}（${v.name}@${v.version}）` : `已导出 ${v.output}（${v.size} 字节）`);
  };

  // 把 .dshpkcfg 回填进表单：空串跳过（保留表单默认值）；无 config 则清空回填。
  const applyConfig = (cfg) => {
    const next = {};
    for (const k of [...META_FIELDS, ...OUTPUT_FIELDS]) {
      const v = cfg?.[k];
      if (typeof v === 'string' && v.trim()) next[k] = v;
    }
    setMeta(next);
    setMode(MODES.includes(cfg?.mode) ? cfg.mode : 'dspack');
    setContentLevel(CONTENT_LEVELS.includes(cfg?.content) ? cfg.content : 'readme');
    const ec = cfg?.exportContent;
    setExportContent({
      skill: ec?.skill === true,
      preset: ec?.preset === true,
      instruction: ec?.instruction === true,
    });
  };

  const loadConfig = async (name, silent = false) => {
    const r = await call('pack/config-load', { profile: name });
    if (!r.ok) return showErr(r.error);
    setLoadedFor(name);
    if (!r.value.config) {
      applyConfig(null); // 切到无配置的 profile：清空表单残留
      if (!silent) showOk(t('result.noCfg'));
      return;
    }
    applyConfig(r.value.config);
    if (!silent) showOk(t('result.loaded'));
  };

  const doLoadConfig = () => { if (exportProfile) void loadConfig(exportProfile, false); };

  const doSaveConfig = async () => {
    if (!exportProfile) return;
    setResult({ pending: true });
    const cfg = {};
    for (const k of [...META_FIELDS, ...OUTPUT_FIELDS]) cfg[k] = (meta[k] ?? '').trim();
    cfg.mode = mode;
    cfg.content = contentLevel;
    cfg.exportContent = {
      skill: !!exportContent.skill,
      preset: !!exportContent.preset,
      instruction: !!exportContent.instruction,
    };
    const r = await call('pack/config-save', { profile: exportProfile, ...cfg });
    if (!r.ok) return showErr(r.error);
    showOk(t('result.saved') + ' → ' + r.value.path);
  };

  // 切到导出 tab / 换 profile 时自动加载工作区配置（每个 profile 只自动加载一次；「读取」按钮可强制重读）。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (tab !== 'export' || !exportProfile || loadedFor === exportProfile) return;
    void loadConfig(exportProfile, true);
  }, [tab, exportProfile, loadedFor]);

  const style = {
    section: { display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 720, padding: '8px 0' },
    tabs: { display: 'flex', gap: 4, borderBottom: '1px solid var(--dsw-alias-border-l2)', paddingBottom: 8 },
    tab: {
      height: 32, padding: '0 16px', borderRadius: 16, border: 'none', cursor: 'pointer',
      fontSize: 13, lineHeight: '20px', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', font: 'inherit',
    },
    tabActive: { background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', fontWeight: 600 },
    group: { display: 'flex', flexDirection: 'column', gap: 6 },
    groupTitle: { margin: '0', fontSize: 13, fontWeight: 600, lineHeight: '20px', color: 'var(--dsw-alias-label-primary)' },
    field: { display: 'flex', flexDirection: 'column', gap: 4 },
    fieldLabel: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' },
    input: {
      height: 32, padding: '4px 10px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)',
      fontSize: 13, lineHeight: '20px', background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)', font: 'inherit', outline: 'none', boxSizing: 'border-box',
    },
    row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
    btn: {
      height: 30, padding: '0 12px', borderRadius: 15, border: '1px solid var(--dsw-alias-border-l2)', cursor: 'pointer',
      fontSize: 13, lineHeight: '18px', background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)', font: 'inherit',
      width: 'fit-content', flex: '0 0 auto',
    },
    btnSmall: {
      height: 26, padding: '0 10px', borderRadius: 13, border: '1px solid var(--dsw-alias-border-l2)',
      cursor: 'pointer', fontSize: 12, lineHeight: '18px', background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)', font: 'inherit',
      width: 'fit-content', flex: '0 0 auto',
    },
    list: { margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 },
    listItem: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      padding: '10px 12px', borderRadius: 10, border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-1)',
    },
    listName: { fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-primary)' },
    line: { margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' },
    marketHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    refreshBtn: {
      width: 26, height: 26, padding: 0, borderRadius: '50%',
      border: '1px solid var(--dsw-alias-border-l2)', cursor: 'pointer',
      background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-secondary)',
      fontSize: 15, lineHeight: '18px', font: 'inherit',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flex: '0 0 auto',
    },
    sectionBox: { display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 14, marginBottom: 14, borderBottom: '1px solid var(--dsw-alias-border-l2)' },
    sectionBoxLast: { display: 'flex', flexDirection: 'column', gap: 8 },
    hint: { margin: '4px 0 0', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' },
    ok: { margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-success)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
    err: { margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-danger)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
    // —— 切换确认弹窗 ——
    overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
    modal: {
      background: 'var(--dsw-alias-bg-layer-1)', borderRadius: 12, padding: '20px 22px',
      minWidth: 360, maxWidth: 440, boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
      display: 'flex', flexDirection: 'column', gap: 14,
    },
    modalTitle: { margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--dsw-alias-label-primary)', textAlign: 'center' },
    ticket: {
      position: 'relative', display: 'flex', alignItems: 'stretch',
      border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 10, background: 'var(--dsw-alias-bg-layer-1)',
    },
    ticketSide: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '16px 10px', minWidth: 0 },
    ticketName: { fontSize: 18, fontWeight: 700, color: 'var(--dsw-alias-label-primary)', wordBreak: 'break-all', textAlign: 'center' },
    ticketRole: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' },
    ticketLine: { width: 0, borderLeft: '2px dashed var(--dsw-alias-border-l2)', alignSelf: 'stretch' },
    ticketBadge: {
      position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
      width: 28, height: 28, borderRadius: '50%',
      background: 'var(--dsw-alias-bg-layer-1)', border: '2px dashed var(--dsw-alias-border-l2)',
      color: 'var(--dsw-alias-label-secondary)', fontSize: 15, fontWeight: 700,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    },
    warn: {
      display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 8,
      border: '1px solid rgba(232,162,58,0.45)', background: 'rgba(232,162,58,0.10)',
      fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-primary)', wordBreak: 'break-word',
    },
    warnIcon: { flex: '0 0 auto', lineHeight: '18px', color: '#e8a23a', fontWeight: 700 },
    confirmBtns: { display: 'flex', justifyContent: 'flex-end', gap: 8 },
    btnPrimary: {
      height: 30, padding: '0 14px', borderRadius: 15, border: '1px solid #4b7bec', cursor: 'pointer',
      fontSize: 13, lineHeight: '18px', background: '#4b7bec', color: '#fff', fontWeight: 600, font: 'inherit',
      width: 'fit-content', flex: '0 0 auto',
    },
  };

  const fieldInput = (key) =>
    h('label', { key, style: style.field },
      h('span', { style: style.fieldLabel }, t('field.' + key)),
      h('input', {
        style: style.input, value: meta[key] ?? '',
        onInput: (e) => setMeta((m) => ({ ...m, [key]: e.target.value })),
      }),
    );

  const renderManage = () => {
    const rows = profiles.map((p) =>
      h('li', { key: p.name, style: style.listItem },
        h('span', { style: style.listName }, p.name + (p.active ? `（${t('profile.active')}）` : '')),
        h('div', { style: style.row },
          p.active ? null : h('button', { type: 'button', style: style.btnSmall, onClick: () => askSwitch(p.name) }, t('action.switch')),
          h('button', { type: 'button', style: style.btnSmall, onClick: () => doExportProfile(p.name) }, t('action.export')),
          h('button', { type: 'button', style: style.btnSmall, onClick: () => doDelete(p.name) }, t('action.delete')),
        ),
      ),
    );

    return h('div', { style: { display: 'flex', flexDirection: 'column' } },
      // 区域 1：正在运行的整合包
      h('section', { key: 'running', style: style.sectionBox },
        h('h3', { style: style.groupTitle }, t('running.title')),
        h('p', { style: style.line }, t('running.profile') + (active ? active.name : t('market.none'))),
        h('div', { style: style.row },
          h('button', { type: 'button', style: style.btn, disabled: !rpc || !active, onClick: () => doExportProfile(active?.name) }, t('action.export')),
          h('button', { type: 'button', style: style.btn, disabled: !rpc || !active, onClick: () => doOpenDir(active?.name) }, t('action.openDir')),
        ),
      ),
      // 区域 2：创建整合包
      h('section', { key: 'create', style: style.sectionBox },
        h('h3', { style: style.groupTitle }, t('create.title')),
        h('div', { style: style.row },
          h('button', { type: 'button', style: style.btn, disabled: !rpc, onClick: () => openDialog('create') }, t('action.newEmpty')),
          h('button', { type: 'button', style: style.btn, disabled: !rpc, onClick: () => openDialog('import') }, t('action.import')),
          h('button', { type: 'button', style: style.btn, disabled: !rpc, onClick: () => { setTab('market'); void loadMarket(); } }, t('action.market')),
        ),
      ),
      // 区域 3：已安装的整合包
      h('section', { key: 'installed', style: style.sectionBoxLast },
        h('h3', { style: style.groupTitle }, t('installed.title')),
        profiles.length === 0 ? h('p', { style: style.line }, t('market.none')) : h('ul', { style: style.list }, rows),
      ),
    );
  };

  const renderExport = () =>
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
      h('div', { style: style.group },
        h('div', { style: style.groupTitle }, t('group.meta')),
        ...META_FIELDS.map(fieldInput),
      ),
      h('div', { style: style.group },
        h('div', { style: style.groupTitle }, t('group.output')),
        ...OUTPUT_FIELDS.map(fieldInput),
        h('label', { style: style.field },
          h('span', { style: style.fieldLabel }, t('field.profile')),
          h('select', { style: style.input, value: exportProfile, onChange: (e) => setExportProfile(e.target.value) },
            profiles.map((p) => h('option', { key: p.name, value: p.name }, p.name + (p.active ? `（${t('profile.active')}）` : ''))),
          ),
        ),
        h('label', { style: style.field },
          h('span', { style: style.fieldLabel }, t('field.mode')),
          h('select', { style: style.input, value: mode, onChange: (e) => setMode(e.target.value) },
            MODES.map((m) => h('option', { key: m, value: m }, t('mode.' + m))),
          ),
        ),
        mode === 'repo'
          ? h('label', { style: style.field },
              h('span', { style: style.fieldLabel }, t('field.content')),
              h('select', { style: style.input, value: contentLevel, onChange: (e) => setContentLevel(e.target.value) },
                CONTENT_LEVELS.map((c) => h('option', { key: c, value: c }, t('content.' + c))),
              ),
            )
          : null,
      ),
      h('div', { style: style.group },
        h('div', { style: style.groupTitle }, t('group.content')),
        ...CONTENT_TOGGLES.map((k) =>
          h('label', { key: k, style: style.row },
            h('input', {
              type: 'checkbox', checked: !!exportContent[k],
              style: { width: 16, height: 16, cursor: 'pointer', accentColor: '#4b7bec' },
              onChange: (e) => setExportContent((ec) => ({ ...ec, [k]: e.target.checked })),
            }),
            h('span', { style: style.line }, t('content.' + k)),
          ),
        ),
      ),
      h('div', { style: style.row },
        h('button', { type: 'button', style: style.btn, disabled: !rpc, onClick: doSaveConfig }, t('action.save')),
        h('button', { type: 'button', style: style.btn, disabled: !rpc, onClick: doLoadConfig }, t('action.load')),
        h('button', { type: 'button', style: style.btn, disabled: !rpc, onClick: doExportFromForm }, t('action.export')),
      ),
    );

  const renderMarket = () => {
    const packs = market?.packs ?? [];
    let body;
    if (market === undefined) body = h('p', { style: style.line }, t('market.loading'));
    else if (market.error) body = h('p', { style: style.err }, `${t('market.error')}：${market.error}`);
    else if (packs.length === 0) body = h('p', { style: style.line }, t('market.empty'));
    else body = h('ul', { style: style.list },
      packs.map((p) => h('li', { key: (p.id || p.name) + '@' + (p.version ?? ''), style: style.listItem },
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
          h('span', { style: style.listName }, p.displayName || p.name),
          p.description ? h('span', { style: style.line }, p.description) : null,
          h('span', { style: style.line }, `${p.author ? p.author + ' · ' : ''}${p.version || '?'}${p.dshVersion ? ' · DSH ' + p.dshVersion : ''}`),
        ),
        h('button', { type: 'button', style: style.btnSmall, disabled: !rpc, onClick: () => doInstallFromMarket(p) }, t('action.install')),
      )),
    );
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
      h('div', { style: style.marketHead },
        packs.length > 0 ? h('p', { style: style.line }, `市场共 ${packs.length} 个整合包`) : null,
        h('button', {
          type: 'button', style: style.refreshBtn, disabled: !rpc || market === undefined,
          title: t('action.refresh'), onClick: () => void loadMarket(),
        }, '↻'),
      ),
      body,
    );
  };

  const content = tab === 'manage' ? renderManage() : tab === 'export' ? renderExport() : renderMarket();

  const renderConfirm = () => {
    if (!confirm) return null;
    const warning = t('confirm.warning').replace('{pkg}', MANAGER_PKG);
    return h('div', { style: style.overlay, onClick: () => setConfirm(null) },
      h('div', { style: style.modal, onClick: (e) => e.stopPropagation() },
        h('h3', { style: style.modalTitle }, t('confirm.title')),
        h('div', { style: style.ticket },
          h('div', { style: style.ticketSide },
            h('span', { style: style.ticketName }, confirm.from),
            h('span', { style: style.ticketRole }, t('confirm.from')),
          ),
          h('div', { style: style.ticketLine }),
          h('div', { style: style.ticketBadge }, '→'),
          h('div', { style: style.ticketSide },
            h('span', { style: style.ticketName }, confirm.to),
            h('span', { style: style.ticketRole }, t('confirm.to')),
          ),
        ),
        confirm.firstTime ? h('p', { style: style.hint }, t('confirm.firstTime')) : null,
        confirm.hasManager ? null : h('div', { style: style.warn },
          h('span', { style: style.warnIcon }, '!'),
          h('span', null, warning),
        ),
        h('div', { style: style.confirmBtns },
          h('button', { type: 'button', style: style.btn, onClick: () => setConfirm(null) }, t('confirm.cancel')),
          h('button', { type: 'button', style: style.btnPrimary, onClick: confirmSwitch }, t('confirm.ok')),
        ),
      ),
    );
  };

  // 创建/导入弹窗：收集名字（校验 kebab-case）或 .dspack 路径，错误就地展示。
  const renderDialog = () => {
    if (!dialog) return null;
    const isCreate = dialog === 'create';
    const value = isCreate ? newName : source;
    const submit = () => { if (!submitting) void (isCreate ? doCreate() : doImport()); };
    return h('div', { style: style.overlay, onClick: closeDialog },
      h('div', { style: style.modal, onClick: (e) => e.stopPropagation() },
        h('h3', { style: style.modalTitle }, isCreate ? t('dialog.createTitle') : t('dialog.importTitle')),
        h('label', { style: style.field },
          h('span', { style: style.fieldLabel }, isCreate ? t('field.newName') : t('field.source')),
          h('input', {
            style: style.input,
            value,
            autoFocus: true,
            placeholder: isCreate ? t('field.newName') : t('field.source'),
            onInput: (e) => {
              if (isCreate) setNewName(e.target.value); else setSource(e.target.value);
              if (fieldError) setFieldError('');
            },
            onKeyDown: (e) => { if (e.key === 'Enter') submit(); },
          }),
        ),
        h('p', { style: style.hint }, isCreate ? t('hint.nameFormat') : t('hint.import')),
        fieldError ? h('p', { style: style.err }, fieldError) : null,
        h('div', { style: style.confirmBtns },
          h('button', { type: 'button', style: style.btn, disabled: submitting, onClick: closeDialog }, t('confirm.cancel')),
          h('button', { type: 'button', style: style.btnPrimary, disabled: !rpc || submitting, onClick: submit },
            submitting ? t('result.pending') : (isCreate ? t('action.create') : t('action.install'))),
        ),
      ),
    );
  };

  return h(Fragment, null,
    h('div', { style: style.section },
    h('div', { style: style.tabs },
      ['manage', 'export', 'market'].map((id) => h('button', {
        key: id, type: 'button',
        style: tab === id ? { ...style.tab, ...style.tabActive } : style.tab,
        onClick: () => { setTab(id); if (id === 'market' && market === null) void loadMarket(); },
      }, t('tab.' + id))),
    ),
    content,
    tab === 'manage' ? h('p', { style: style.hint }, t('hint.restart')) : null,
    result
      ? h('p', { style: result.ok === false ? style.err : style.ok },
          result.pending ? t('result.pending') : (result.text ?? result.error))
      : null,
    ),
    renderConfirm(),
    renderDialog(),
  );
}
