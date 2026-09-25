// DSH 客户端插件 · 整合包管理器主面板（三 Tab：管理 / 导出 / 市场）。
//
// 所有按钮经 ctx.connection.rpc 直连宿主 endpoint（静默，不进聊天栏），
// 业务逻辑全在宿主 endpoint 层；这里只做表单收集 + 结果展示。
//
// slots 契约（已从 DSH 源码确证）：
//   ctx.slots.inject("settings.section", () => ctx.slots.register(options, Component))
import { createElement as h, useState, useEffect } from 'react';

const NS = 'dspack';

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
    'result.pending': '处理中…',
    'result.noRpc': '后端 RPC 不可用（connection 服务缺失）',
    'err.name': '请填写 profile 名',
    'err.source': '请填写 .dspack 路径或 URL',
    'profile.active': '当前',
    'market.loading': '加载市场中…',
    'market.empty': '市场暂无内容',
    'market.error': '市场加载失败',
    'market.none': '（无）',
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
    'profile.active': 'current',
    'market.loading': 'Loading market…',
    'market.empty': 'Market is empty',
    'market.error': 'Market load failed',
    'market.none': '(none)',
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

const META_FIELDS = ['name', 'version', 'displayName', 'description', 'author', 'icon', 'dshVersion', 'out'];

export function DspackSection({ t, packforge }) {
  const rpc = packforge?.rpc;
  const [tab, setTab] = useState('manage');
  const [profiles, setProfiles] = useState([]);
  const [result, setResult] = useState(null); // null | {pending:true} | {ok:true,text} | {ok:false,error}
  const [mode, setMode] = useState(null); // 'create' | 'import'
  const [newName, setNewName] = useState('');
  const [source, setSource] = useState('');
  const [market, setMarket] = useState(null); // null=未加载 undefined=加载中 {packs,error}
  const [meta, setMeta] = useState({});
  const [exportProfile, setExportProfile] = useState('');

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

  const doSwitch = async (name) => {
    setResult({ pending: true });
    const r = await call('profile/switch', { name });
    if (!r.ok) return showErr(r.error);
    showOk(`已切换到「${name}」，重启 DSH 后生效`);
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

  const doCreate = async () => {
    const name = newName.trim();
    if (!name) return showErr(t('err.name'));
    setResult({ pending: true });
    const r = await call('profile/create', { name });
    if (!r.ok) return showErr(r.error);
    showOk(`已创建 profile「${name}」`);
    setNewName('');
    setMode(null);
    void refresh();
  };

  const doImport = async () => {
    const src = source.trim();
    if (!src) return showErr(t('err.source'));
    setResult({ pending: true });
    const r = await call('pack/install', { source: src });
    if (!r.ok) return showErr(r.error);
    showOk(`已安装 profile「${r.value.profileName}」→ ${r.value.dir}`);
    setSource('');
    setMode(null);
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
    const r = await call('pack/install', { source: src });
    if (!r.ok) return showErr(r.error);
    showOk(`已安装 profile「${r.value.profileName}」→ ${r.value.dir}`);
    void refresh();
  };

  const doExportFromForm = async () => {
    setResult({ pending: true });
    const overrides = {};
    for (const k of META_FIELDS) {
      const v = (meta[k] ?? '').trim();
      if (v) overrides[k] = v;
    }
    if (exportProfile) overrides.profile = exportProfile;
    const r = await call('pack/export', overrides);
    if (!r.ok) return showErr(r.error);
    const v = r.value;
    showOk(v.mode === 'repo' ? `已导出仓库 ${v.dir}（${v.name}@${v.version}）` : `已导出 ${v.output}（${v.size} 字节）`);
  };

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
    grow: { flex: 1 },
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
    sectionBox: { display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 14, marginBottom: 14, borderBottom: '1px solid var(--dsw-alias-border-l2)' },
    sectionBoxLast: { display: 'flex', flexDirection: 'column', gap: 8 },
    hint: { margin: '4px 0 0', fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' },
    ok: { margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-success)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
    err: { margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-danger)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
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
          p.active ? null : h('button', { type: 'button', style: style.btnSmall, onClick: () => doSwitch(p.name) }, t('action.switch')),
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
          h('button', { type: 'button', style: style.btn, disabled: !rpc, onClick: () => setMode(mode === 'create' ? null : 'create') }, t('action.newEmpty')),
          h('button', { type: 'button', style: style.btn, disabled: !rpc, onClick: () => setMode(mode === 'import' ? null : 'import') }, t('action.import')),
          h('button', { type: 'button', style: style.btn, disabled: !rpc, onClick: () => { setTab('market'); void loadMarket(); } }, t('action.market')),
        ),
        mode === 'create'
          ? h('div', { style: style.row },
              h('input', { style: { ...style.input, ...style.grow }, placeholder: t('field.newName'), value: newName, onInput: (e) => setNewName(e.target.value) }),
              h('button', { type: 'button', style: style.btnSmall, disabled: !rpc, onClick: doCreate }, t('action.create')),
            )
          : null,
        mode === 'import'
          ? h('div', { style: style.row },
              h('input', { style: { ...style.input, ...style.grow }, placeholder: t('field.source'), value: source, onInput: (e) => setSource(e.target.value) }),
              h('button', { type: 'button', style: style.btnSmall, disabled: !rpc, onClick: doImport }, t('action.install')),
            )
          : null,
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
        ...META_FIELDS.slice(0, 6).map(fieldInput),
      ),
      h('div', { style: style.group },
        h('div', { style: style.groupTitle }, t('group.output')),
        ...META_FIELDS.slice(6).map(fieldInput),
        h('label', { style: style.field },
          h('span', { style: style.fieldLabel }, t('field.profile')),
          h('select', { style: style.input, value: exportProfile, onChange: (e) => setExportProfile(e.target.value) },
            profiles.map((p) => h('option', { key: p.name, value: p.name }, p.name + (p.active ? `（${t('profile.active')}）` : ''))),
          ),
        ),
      ),
      h('button', { type: 'button', style: style.btn, disabled: !rpc, onClick: doExportFromForm }, t('action.export')),
    );

  const renderMarket = () => {
    if (market === undefined) return h('p', { style: style.line }, t('market.loading'));
    if (market.error) return h('p', { style: style.err }, `${t('market.error')}：${market.error}`);
    const packs = market.packs ?? [];
    if (packs.length === 0) return h('p', { style: style.line }, t('market.empty'));
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
      h('p', { style: style.line }, `市场共 ${packs.length} 个整合包`),
      h('ul', { style: style.list },
        packs.map((p) => h('li', { key: (p.id || p.name) + '@' + (p.version ?? ''), style: style.listItem },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
            h('span', { style: style.listName }, p.displayName || p.name),
            p.description ? h('span', { style: style.line }, p.description) : null,
            h('span', { style: style.line }, `${p.author ? p.author + ' · ' : ''}${p.version || '?'}${p.dshVersion ? ' · DSH ' + p.dshVersion : ''}`),
          ),
          h('button', { type: 'button', style: style.btnSmall, disabled: !rpc, onClick: () => doInstallFromMarket(p) }, t('action.install')),
        )),
      ),
    );
  };

  const content = tab === 'manage' ? renderManage() : tab === 'export' ? renderExport() : renderMarket();

  return h('div', { style: style.section },
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
  );
}
