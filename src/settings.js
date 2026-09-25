// DSH 客户端插件 · 设置面板「整合包」section —— 纯 UI + 后端。
//
// 所有按钮经 ctx.connection.rpc 直连宿主 endpoint（静默，不进聊天栏），
// 业务逻辑全在宿主 endpoint 层；这里只做表单收集 + 结果展示。
//
// slots 契约（已从 DSH 源码确证）：
//   ctx.slots.inject("settings.section", () => ctx.slots.register(options, Component))
import { createElement as h } from 'react';

const NS = 'dspack';

const dict = {
  zh: {
    nav: '整合包',
    title: '整合包',
    intro: '把 profile 导出为 .dspack、从 .dspack 安装、或在多个 profile 之间切换。',
    'group.meta': '元数据（留空用 profile 默认）',
    'group.output': '输出',
    'group.content': '导出内容',
    'group.install': '安装 / 查看',
    'group.profile': '多 profile',
    'field.name': '整合包名',
    'field.version': '版本',
    'field.displayName': '展示名',
    'field.description': '描述',
    'field.author': '作者',
    'field.icon': '图标 URL',
    'field.dshVersion': 'DSH 版本（留空取最新已装）',
    'field.out': '输出目录（留空用当前目录）',
    'field.source': '.dspack 路径或 URL',
    'field.newName': '新 profile 名',
    'export.skill': 'skills/ 技能',
    'export.preset': '.agent-presets/ 预设',
    'export.instruction': 'AGENTS.md 指令',
    'export.data': 'data/ 数据',
    'action.export': '导出',
    'action.install': '安装',
    'action.view': '查看',
    'action.market': '浏览市场',
    'action.refresh': '刷新 profile',
    'action.create': '新建 profile',
    'action.switch': '切换',
    'result.pending': '处理中…',
    'result.noRpc': '后端 RPC 不可用（connection 服务缺失）',
    'err.source': '请填写 .dspack 路径或 URL',
    'err.name': '请填写 profile 名',
    'profile.active': '当前',
  },
  en: {
    nav: 'Modpacks',
    title: 'Modpacks',
    intro: 'Export a profile as .dspack, install from .dspack, or switch between profiles.',
    'group.meta': 'Metadata (blank = profile default)',
    'group.output': 'Output',
    'group.content': 'Export content',
    'group.install': 'Install / inspect',
    'group.profile': 'Profiles',
    'field.name': 'Pack name',
    'field.version': 'Version',
    'field.displayName': 'Display name',
    'field.description': 'Description',
    'field.author': 'Author',
    'field.icon': 'Icon URL',
    'field.dshVersion': 'DSH version (blank = latest)',
    'field.out': 'Output dir (blank = current)',
    'field.source': '.dspack path or URL',
    'field.newName': 'New profile name',
    'export.skill': 'skills/ skills',
    'export.preset': '.agent-presets/ presets',
    'export.instruction': 'AGENTS.md instruction',
    'export.data': 'data/ data',
    'action.export': 'Export',
    'action.install': 'Install',
    'action.view': 'Inspect',
    'action.market': 'Browse market',
    'action.refresh': 'Refresh profiles',
    'action.create': 'New profile',
    'action.switch': 'Switch',
    'result.pending': 'Working…',
    'result.noRpc': 'Backend RPC unavailable (no connection service)',
    'err.source': 'Please fill a .dspack path or URL',
    'err.name': 'Please fill a profile name',
    'profile.active': 'current',
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
  const fields = {};
  let resultEl = null;
  let profileListEl = null;

  const ref = (key) => (el) => {
    fields[key] = el;
  };

  const showResult = (r) => {
    if (!resultEl) return;
    if (r?.pending) {
      resultEl.textContent = t('result.pending');
      return;
    }
    resultEl.textContent = r?.ok ? `✓ ${r.text}` : `✗ ${r.error}`;
  };

  /** 调一个 endpoint；统一解包 { ok, value } / { ok:false, error }。 */
  const callRpc = async (endpoint, payload) => {
    if (!rpc) {
      showResult({ ok: false, error: t('result.noRpc') });
      return { ok: false, error: t('result.noRpc') };
    }
    try {
      const res = await rpc.call(endpoint, payload ?? {});
      if (res?.ok) return { ok: true, value: res.value };
      return { ok: false, error: res?.error?.message ?? String(res?.error ?? '失败') };
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
      data: fields.data?.checked ?? true,
    };
    return overrides;
  };

  const doExport = async () => {
    showResult({ pending: true });
    const r = await callRpc('pack/export', collectMeta());
    if (!r.ok) return showResult(r);
    const v = r.value;
    showResult({
      ok: true,
      text: v.mode === 'repo' ? `已导出仓库 ${v.dir}（${v.name}@${v.version}）` : `已导出 ${v.output}（${v.size} 字节）`,
    });
  };

  const doInstall = async () => {
    const source = fields.source?.value?.trim();
    if (!source) return showResult({ ok: false, error: t('err.source') });
    showResult({ pending: true });
    const r = await callRpc('pack/install', { source });
    if (!r.ok) return showResult(r);
    showResult({ ok: true, text: `已安装 profile「${r.value.profileName}」→ ${r.value.dir}` });
  };

  const doView = async () => {
    const source = fields.source?.value?.trim();
    if (!source) return showResult({ ok: false, error: t('err.source') });
    showResult({ pending: true });
    const r = await callRpc('pack/view', { source });
    if (!r.ok) return showResult(r);
    const v = r.value;
    showResult({
      ok: true,
      text: v.valid ? `整合包 ${v.name}@${v.version} 合法（${v.size} 字节）` : `不合法：${(v.validation ?? []).join('；')}`,
    });
  };

  const doMarket = async () => {
    showResult({ pending: true });
    const r = await callRpc('pack/market', {});
    if (!r.ok) return showResult(r);
    const packs = r.value.packs ?? [];
    showResult({
      ok: true,
      text: `市场 ${packs.length} 个包：\n` + packs.map((p) => `- ${p.name}@${p.version ?? '?'}`).join('\n'),
    });
  };

  const applyStyle = (el, s) => {
    for (const k in s) el.style[k] = s[k];
  };

  const renderProfiles = (list) => {
    if (!profileListEl) return;
    profileListEl.replaceChildren();
    for (const p of list ?? []) {
      const li = document.createElement('li');
      applyStyle(li, style.profileItem);
      const span = document.createElement('span');
      applyStyle(span, style.profileName);
      span.textContent = p.name + (p.active ? `（${t('profile.active')}）` : '');
      li.appendChild(span);
      if (!p.active) {
        const btn = document.createElement('button');
        btn.type = 'button';
        applyStyle(btn, style.btnSmall);
        btn.textContent = t('action.switch');
        btn.onclick = () => doSwitch(p.name);
        li.appendChild(btn);
      }
      profileListEl.appendChild(li);
    }
  };

  const refreshProfiles = async () => {
    const r = await callRpc('profile/list', {});
    if (r.ok) renderProfiles(r.value.profiles ?? []);
    else showResult(r);
  };

  const doSwitch = async (name) => {
    showResult({ pending: true });
    const r = await callRpc('profile/switch', { name });
    if (!r.ok) return showResult(r);
    showResult({ ok: true, text: `已切换到「${name}」（原「${r.value.previous}」），重启 DSH 后生效` });
    await refreshProfiles();
  };

  const doCreateProfile = async () => {
    const name = fields.newName?.value?.trim();
    if (!name) return showResult({ ok: false, error: t('err.name') });
    showResult({ pending: true });
    const r = await callRpc('profile/create', { name });
    if (!r.ok) return showResult(r);
    showResult({ ok: true, text: `已创建 profile「${name}」` });
    await refreshProfiles();
  };

  const style = {
    section: { display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 720, padding: '8px 0' },
    title: { margin: 0, fontSize: 16, fontWeight: 500, lineHeight: '24px' },
    intro: { margin: 0, fontSize: 14, lineHeight: '22px', color: 'var(--dsw-alias-label-tertiary)' },
    group: { display: 'flex', flexDirection: 'column', gap: 6 },
    groupTitle: { margin: '8px 0 0', fontSize: 13, fontWeight: 600, lineHeight: '20px', color: 'var(--dsw-alias-label-primary)' },
    field: { display: 'flex', flexDirection: 'column', gap: 4 },
    fieldLabel: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' },
    input: {
      height: 32, padding: '4px 10px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)',
      fontSize: 13, lineHeight: '20px', background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)', font: 'inherit', outline: 'none', boxSizing: 'border-box',
    },
    row: { display: 'flex', gap: 8, alignItems: 'center' },
    grow: { flex: 1 },
    check: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' },
    checkInput: { margin: 0 },
    checkLabel: { fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-primary)' },
    actions: { display: 'flex', gap: 8, margin: '4px 0 0', padding: 0, listStyle: 'none', flexWrap: 'wrap' },
    btn: {
      height: 36, padding: '0 14px', borderRadius: 18, border: 'none', cursor: 'pointer',
      fontSize: 14, lineHeight: '22px', background: 'var(--dsw-alias-button-primary-fill)',
      color: 'var(--dsw-alias-label-primary-foreground)', font: 'inherit',
    },
    btnSmall: {
      height: 28, padding: '0 12px', borderRadius: 14, border: '1px solid var(--dsw-alias-border-l2)',
      cursor: 'pointer', fontSize: 12, lineHeight: '18px', background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)', font: 'inherit',
    },
    profileList: { margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 },
    profileItem: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    profileName: { fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-primary)' },
    result: { margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
  };

  const textField = (key) =>
    h('label', { style: style.field, key },
      h('span', { style: style.fieldLabel }, t('field.' + key)),
      h('input', { style: style.input, ref: ref(key) }),
    );

  const checkbox = (key) =>
    h('label', { style: style.check, key },
      h('input', { type: 'checkbox', style: style.checkInput, defaultChecked: true, ref: ref(key) }),
      h('span', { style: style.checkLabel }, t('export.' + key)),
    );

  return h('div', { style: style.section },
    h('h2', { style: style.title }, t('title')),
    h('p', { style: style.intro }, t('intro')),

    h('div', { style: style.group },
      h('div', { style: style.groupTitle }, t('group.meta')),
      ...META_FIELDS.slice(0, 6).map(textField),
    ),
    h('div', { style: style.group },
      h('div', { style: style.groupTitle }, t('group.output')),
      ...META_FIELDS.slice(6).map(textField),
    ),
    h('div', { style: style.group },
      h('div', { style: style.groupTitle }, t('group.content')),
      checkbox('skill'), checkbox('preset'), checkbox('instruction'), checkbox('data'),
    ),
    h('ul', { style: style.actions },
      h('li', { key: 'export' },
        h('button', { type: 'button', style: style.btn, disabled: !rpc, onClick: doExport }, t('action.export')),
      ),
    ),

    h('div', { style: style.group },
      h('div', { style: style.groupTitle }, t('group.install')),
      h('label', { style: style.field },
        h('span', { style: style.fieldLabel }, t('field.source')),
        h('input', { style: style.input, ref: ref('source') }),
      ),
      h('ul', { style: style.actions },
        h('li', { key: 'install' },
          h('button', { type: 'button', style: style.btn, disabled: !rpc, onClick: doInstall }, t('action.install')),
        ),
        h('li', { key: 'view' },
          h('button', { type: 'button', style: style.btn, disabled: !rpc, onClick: doView }, t('action.view')),
        ),
        h('li', { key: 'market' },
          h('button', { type: 'button', style: style.btn, disabled: !rpc, onClick: doMarket }, t('action.market')),
        ),
      ),
    ),

    h('div', { style: style.group },
      h('div', { style: style.groupTitle }, t('group.profile')),
      h('ul', { style: style.actions },
        h('li', { key: 'refresh' },
          h('button', { type: 'button', style: style.btnSmall, disabled: !rpc, onClick: refreshProfiles }, t('action.refresh')),
        ),
      ),
      h('ul', { style: style.profileList, ref: (el) => { profileListEl = el; } }),
      h('div', { style: style.row },
        h('input', { style: { ...style.input, ...style.grow }, placeholder: t('field.newName'), ref: ref('newName') }),
        h('button', { type: 'button', style: style.btnSmall, disabled: !rpc, onClick: doCreateProfile }, t('action.create')),
      ),
    ),

    h('p', { style: style.result, ref: (el) => { resultEl = el; } }),
  );
}
