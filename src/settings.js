// DSH 客户端插件 · 整合包管理器主面板（三 Tab：管理 / 导出 / 市场）。
//
// 所有按钮经 ctx.connection.rpc 直连宿主 endpoint（静默，不进聊天栏），
// 业务逻辑全在宿主 endpoint 层；这里只做表单收集 + 结果展示。
//
// slots 契约（已从 DSH 源码确证）：
//   ctx.slots.inject("settings.section", () => ctx.slots.register(options, Component))
import { createElement as h, useState, useEffect, Fragment } from 'react';
import { PROFILE_NAME_RE, RESERVED_PROFILE_NAMES } from './channel.js';
import { installSettingsNavIcon, installSectionFocusHook, navIconMaskSvg, navIconMaskUrl } from './settings-nav-icon.js';
import { createSectionGate } from './section-gate.js';

const NS = 'dspack';
const MANAGER_PKG = '@dsh-packforge/dsh-pack-plugin';
// 版本号由 bundle-client.mjs 用 esbuild define 注入（__PACKAGE_VERSION__）；未注入（如单测直连源码）时兜底。
const VERSION = typeof __PACKAGE_VERSION__ === 'undefined' ? '0.1.0' : __PACKAGE_VERSION__;
// logo（icons/folder-zip-line.svg 的 path），About 页用 currentColor 上色。
const LOGO_PATH = 'M444.330667 128l85.333333 85.333333H896a42.666667 42.666667 0 0 1 42.666667 42.666667v597.333333a42.666667 42.666667 0 0 1-42.666667 42.666667H128a42.666667 42.666667 0 0 1-42.666667-42.666667V170.666667a42.666667 42.666667 0 0 1 42.666667-42.666667h316.330667zM768 768h-170.666667v-128h85.333334v-85.333333h-85.333334v-85.333334h85.333334V384h-85.333334V298.666667h-102.997333l-85.333333-85.333334H170.666667v597.333334h682.666666V298.666667h-170.666666v85.333333h85.333333v85.333333h-85.333333v85.333334h85.333333v213.333333z';

// About 页外部链接（作者 / 仓库 / 求 Star / 生态），点击经 plugin/open-url 用系统浏览器打开。
const AUTHOR = 'hxh230802';
const AUTHOR_URL = 'https://github.com/hxh230802';
const REPO_URL = 'https://github.com/DSH-PackForge/dsh-pack-plugin';
const NPM_URL = 'https://www.npmjs.com/package/@dsh-packforge/dsh-pack-plugin';
const SPEC_URL = 'https://github.com/DSH-PackForge/DSH-PackForge';
const APP_URL = 'https://github.com/DSH-PackForge/dsh-packforge-app';
const MARKET_URL = 'https://github.com/DSH-PackForge/dsh-pack-market';

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
    'action.tasks': '任务中心',
    'tasks.empty': '暂无任务',
    'tasks.close': '关闭',
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
    'action.quickExport': '快捷导出',
    'action.upload': '上传到 GitHub',
    'upload.hint': '先导出，再点此切回聊天框让 AI 帮你发 Release',
    'upload.sent': '已切回聊天框，AI 接手上传',
    'upload.failed': '发送失败',
    'upload.noService': '聊天服务不可用（DSH 版本过低）',
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
    // 基线已取消离线包：内嵌依赖（离线分发）相关文案整块移除，仅保留兼容性徽标文案。
    'compat.title': '兼容性（v5 r2）',
    'compat.dshVersions': '兼容 DSH 版本集（dshVersions）',
    'compat.dshVersionsHint': '逗号分隔的实测兼容版本枚举（如 0.1.1-rc.2, 0.1.0）；「DSH 版本」必须包含在内；留空 = 仅按 dshVersion',
    'compat.launchers': '启动器兼容声明（launchers）',
    'launcher.none': '未声明',
    'launcher.support': '支持',
    'launcher.conflict': '冲突',
    'launcher.minVersion': '最低版本（可选）',
    'launcher.reason': '冲突原因（建议填写）',
    'group.content': '导出内容（上一级目录开关）',
    'content.skill': '导出 skills/',
    'content.preset': '导出 .agent-presets/',
    'content.instruction': '导出 AGENTS.md',
    'result.saved': '已保存工作区配置',
    'result.loaded': '已读取工作区配置',
    'result.noCfg': '该 profile 暂无已保存的工作区配置',
    'result.pending': '处理中…',
    'result.taskStarted': '已加入任务中心，进度见面板',
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
    'market.detail': '详情',
    'market.detailTitle': '整合包详情',
    'market.launcherRestricted': '启动器限制',
    'market.r2.launcherRequire': '需启动器 {id} ≥ {ver}',
    'market.r2.launcherConflict': '不支持在 {id} 上运行：{reason}',
    'market.r2.noReason': '未提供原因',
    'market.r2.dshVersions': '兼容 DSH 版本：{versions}',
    // 展示侧保留：主线不再产内嵌包，但仍要能装、并在详情页看出这是带内嵌依赖的包。
    'market.r2.vendored': '内嵌 {count} 个依赖',
    'market.r2.none': '无启动器兼容限制，未内嵌依赖',
    'installConfirm.title': '安装确认',
    'installConfirm.hint': '该整合包的启动器兼容声明存在警告，确认后将照常安装：',
    'installConfirm.ok': '仍要安装',
    'confirm.title': '切换 profile',
    'confirm.from': '当前',
    'confirm.to': '目标',
    'confirm.firstTime': '首次切换：会把当前目录存档为 default',
    'confirm.warning': '检测到目标 profile 没有 {pkg}，需要安装。若没有此插件，将无法从应用内再次切换 profile。',
    'confirm.cancel': '取消',
    'confirm.ok': '确认切换',
    'confirm.hintRestart': '切换后会自动重启客户端；若长时间未自动重启，请手动拉起客户端。',
    'confirm.managerSource': '目标缺少插件，安装方式：',
    'confirm.source.copy': '从当前 profile 复制',
    'confirm.source.npm': '从 NPM 拉取最新',
    'tab.about': '关于',
    'about.version': '版本',
    'about.desc': 'DSH 整合包管理插件：.dspack 导出/导入、多 profile 切换，零官方源码改动。',
    'about.philosophy': '整合——包罗万象',
    'about.author': '作者',
    'about.repo': '仓库',
    'about.star': '求 Star',
    'about.checkUpdate': '检查更新',
    'about.checking': '检查中…',
    'about.upToDate': '已是最新版本',
    'about.newVersion': '有新版本 {latest}（当前 {current}）',
    'about.checkFailed': '检查更新失败',
    'about.viewNpm': '在 npm 查看',
    'about.ecosystem': '生态',
    'about.ecosystem.spec': '理念及规范',
    'about.ecosystem.app': '包管理器',
    'about.ecosystem.market': '市场',
    'group.network': '网络',
    'field.proxyMode': '代理模式',
    'proxyMode.auto': '自动（跟随系统代理）',
    'proxyMode.direct': '直连（不使用代理）',
    'proxyMode.manual': '手动指定代理',
    'field.proxy': '代理地址',
    'hint.proxy': '自动模式回落环境变量（HTTP_PROXY / HTTPS_PROXY / ALL_PROXY / NO_PROXY）与 Windows 系统代理；手动支持 http / https / socks / socks5，如 http://127.0.0.1:7890',
    'result.proxySaved': '已保存代理设置（立即生效）',
    'about.copyright': '© 2026 DSH-PackForge contributors · MIT License',
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
    'action.tasks': 'Task Center',
    'tasks.empty': 'No tasks',
    'tasks.close': 'Close',
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
    // 基线已取消离线包：内嵌依赖文案同样整块移除。
    'compat.title': 'Compatibility (v5 r2)',
    'compat.dshVersions': 'Compatible DSH versions (dshVersions)',
    'compat.dshVersionsHint': 'Comma-separated tested versions (e.g. 0.1.1-rc.2, 0.1.0); must include the "DSH version" field; blank = dshVersion only',
    'compat.launchers': 'Launcher compatibility (launchers)',
    'launcher.none': 'Unspecified',
    'launcher.support': 'Supported',
    'launcher.conflict': 'Conflict',
    'launcher.minVersion': 'Min version (optional)',
    'launcher.reason': 'Conflict reason (recommended)',
    'action.export': 'Export',
    'action.quickExport': 'Quick export',
    'action.upload': 'Upload to GitHub',
    'upload.hint': 'Export first, then switch to chat and let the AI publish the release',
    'upload.sent': 'Switched to chat — the AI is on it',
    'upload.failed': 'Send failed',
    'upload.noService': 'Chat service unavailable (DSH too old)',
    'action.install': 'Install',
    'action.switch': 'Switch',
    'action.create': 'Create',
    'result.pending': 'Working…',
    'result.taskStarted': 'Added to task center — see the panel',
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
    'market.detail': 'Details',
    'market.detailTitle': 'Modpack details',
    'market.launcherRestricted': 'launcher-restricted',
    'market.r2.launcherRequire': 'Requires launcher {id} ≥ {ver}',
    'market.r2.launcherConflict': 'Not supported on {id}: {reason}',
    'market.r2.noReason': 'no reason given',
    'market.r2.dshVersions': 'Compatible DSH versions: {versions}',
    'market.r2.vendored': '{count} vendored deps',
    'market.r2.none': 'No launcher restrictions, no vendored deps',
    'installConfirm.title': 'Install confirmation',
    'installConfirm.hint': 'This pack has launcher-compatibility warnings. It will still be installed after you confirm:',
    'installConfirm.ok': 'Install anyway',
    'confirm.title': 'Switch profile',
    'confirm.from': 'current',
    'confirm.to': 'target',
    'confirm.firstTime': 'First switch: current folder will be archived as default',
    'confirm.warning': 'Target profile has no {pkg}; it must be installed. Without it you cannot switch again from inside the app.',
    'confirm.cancel': 'Cancel',
    'confirm.ok': 'Confirm switch',
    'confirm.hintRestart': 'The client restarts automatically after switching; if it does not restart for a while, please launch it manually.',
    'confirm.managerSource': 'Target profile is missing the plugin. Install via:',
    'confirm.source.copy': 'Copy from current profile',
    'confirm.source.npm': 'Pull latest from NPM',
    'tab.about': 'About',
    'about.version': 'Version',
    'about.desc': 'DSH modpack plugin: .dspack export/import, multi-profile switching, zero official source changes.',
    'about.philosophy': 'Integrate — embrace everything',
    'about.author': 'Author',
    'about.repo': 'Repository',
    'about.star': 'Star on GitHub',
    'about.checkUpdate': 'Check for updates',
    'about.checking': 'Checking…',
    'about.upToDate': 'You are up to date',
    'about.newVersion': 'New version {latest} (current {current})',
    'about.checkFailed': 'Update check failed',
    'about.viewNpm': 'View on npm',
    'about.ecosystem': 'Ecosystem',
    'about.ecosystem.spec': 'Philosophy & Spec',
    'about.ecosystem.app': 'Package Manager',
    'about.ecosystem.market': 'Market',
    'group.network': 'Network',
    'field.proxyMode': 'Proxy mode',
    'proxyMode.auto': 'Auto (follow system proxy)',
    'proxyMode.direct': 'Direct (no proxy)',
    'proxyMode.manual': 'Manual proxy',
    'field.proxy': 'Proxy',
    'hint.proxy': 'Auto mode falls back to env vars (HTTP_PROXY / HTTPS_PROXY / ALL_PROXY / NO_PROXY) and the Windows system proxy; manual supports http / https / socks / socks5, e.g. http://127.0.0.1:7890',
    'result.proxySaved': 'Proxy saved (takes effect immediately)',
    'about.copyright': '© 2026 DSH-PackForge contributors · MIT License',
  },
};

export function registerSettingsSection(ctx, packforge = {}) {
  const slots = ctx?.slots;
  const locale = ctx?.locale;
  if (!slots || typeof slots.inject !== 'function') return false;
  if (!locale || typeof locale.register !== 'function' || typeof locale.bind !== 'function') return false;

  const registerLocale = () => {
    try {
      locale.register(NS, dict);
    } catch (e) {
      // DSH locale 服务全局去重：同一 namespace+locale 重复注册抛错，且旧注册不随
      // 插件 fiber 卸载清理。热重载（关→开）时 dict 内容不变，重复注册安全忽略；
      // 其余错误照抛，避免掩盖真正的注册失败。
      if (/already has locale/.test(String(e?.message ?? e))) return;
      throw e;
    }
  };
  if (typeof ctx.effect === 'function') ctx.effect(registerLocale, 'dspack: settings dict');
  else registerLocale();

  const t = locale.bind(NS);

  // 导航 tab 图标：settings.section 契约没有 icon 字段，shell 对未知 id 一律
  // 回退齿轮；这里在对话框挂载后把属于本插件的那一行换成 logo（folder-zip）。
  installSettingsNavIcon(ctx, () => t('nav'), navIconMaskUrl(navIconMaskSvg(LOGO_PATH)));
  // 悬浮球点开设置后要切到本插件分区：把「认标签找那一行」的能力交给客户端插件
  // （球在页面 DOM 里跑，不该依赖图标标记的时机）。
  installSectionFocusHook(ctx, () => t('nav'));

  // 经 section-gate 注册：register 幂等、disposer 显式持有，热重载时不二次 register，
  // 从而避免命中 SlotCore 的重复 id 校验（dsh-market 同款做法，实测重载不丢入口）。
  const sectionGate = createSectionGate(() => {
    const off = slots.register(
      {
        name: 'settings.section',
        id: 'dspack',
        order: 20,
        label: () => t('nav'),
        locale: NS,
        inject: () => ({ t, packforge }),
      },
      DspackSection,
    );
    // slots.register 在不支持 disposer 的宿主上可能返回 undefined；闸门需要一个恒有的
    // disposer，缺省退化为 no-op，避免变成无法撤销的注册。
    return typeof off === 'function' ? off : () => {};
  });

  slots.inject('settings.section', () => {
    sectionGate.available();
  });
  return true;
}

const META_FIELDS = ['name', 'version', 'displayName', 'description', 'author', 'icon', 'profileName'];
const OUTPUT_FIELDS = ['dshVersion', 'out'];
const MODES = ['dspack', 'repo'];
const CONTENT_LEVELS = ['manifest', 'readme', 'full'];
const CONTENT_TOGGLES = ['skill', 'preset', 'instruction'];
// 启动器编辑器回落清单（launchers/registry 端点不可用时用；与 specs/launcher-registry.md §1 同步维护）。
const LAUNCHER_IDS = ['dshl', 'hdsl', 'dsh-packforge-app', 'official-desktop', 'dsh-cli'];

export function DspackSection({ t, packforge }) {
  const rpc = packforge?.rpc;
  const sendToChat = packforge?.sendToChat;
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
  // 基线已取消离线包：导出依赖清单 / 内嵌勾选 / 内嵌档位三组 state 一并移除。
  const [dshVersionsText, setDshVersionsText] = useState(''); // 兼容 DSH 版本集（逗号分隔文本）
  // 启动器兼容编辑：{ [id]: { mode: 'support'|'conflict', minVersion, reason } }；无条目 = 未声明
  const [launchersState, setLaunchersState] = useState({});
  const [installedDsh, setInstalledDsh] = useState([]); // 本机已装 DSH 版本（dshVersions 建议列表）
  // 启动器注册表（launchers/registry 端点，机器可读版）：[{id, name}]；null = 未加载（回落 LAUNCHER_IDS）
  const [launchersReg, setLaunchersReg] = useState(null);
  const [confirm, setConfirm] = useState(null); // null | {from,to,hasManager,firstTime}
  const [managerSource, setManagerSource] = useState('npm'); // 'npm'（拉取最新，默认）| 'copy'（次之复制）
  const [tasksOpen, setTasksOpen] = useState(false); // 任务中心面板是否展开（内嵌视图，替代旧版独立小窗）
  const [taskList, setTaskList] = useState([]); // task/list 轮询结果
  const [update, setUpdate] = useState(null); // null | {checking:true} | {current,latest,outdated,npmUrl} | {error}
  const [proxy, setProxy] = useState(''); // 代理地址（config.proxy；空 = 回落环境变量）
  const [proxyMode, setProxyMode] = useState('auto'); // auto | direct | manual
  const [upload, setUpload] = useState(null); // null | {pending:true} | {ok:true,text} | {ok:false,error}
  // 安装确认（v5 r2 §8.4 判定表第 4 行）：pack/view 预检出 warn 级 launchers 警告时弹确认，
  // 用户点「仍要安装」后才继续 pack/install。null | { source, extra, warnings, fromDialog }
  const [installConfirm, setInstallConfirm] = useState(null);
  // 市场详情弹窗（v5 r2 徽标 + README 懒加载）：null | {pending:true,pack} | {error,pack} | {pack,manifest,readme,r2,badges}
  const [detail, setDetail] = useState(null);

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

  // 轮询任务到结束：完成后刷新 profile 列表；失败就地把错误弹到面板。
  const watch = (id) => {
    setTasksOpen(true); // 任务开始即展开任务中心面板（替代旧版自动弹出独立小窗）
    const timer = setInterval(async () => {
      const r = await call('task/get', { id });
      if (!r.ok) { clearInterval(timer); return; }
      const t = r.value;
      if (!t || (t.status !== 'done' && t.status !== 'failed')) return;
      clearInterval(timer);
      if (t.status === 'failed') showErr(t.error || '任务失败');
      void refresh();
    }, 600);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void refresh(); }, []);

  // 挂载时读一次已存代理设置回填（保存后 host 立即生效，无需重启）。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    void (async () => {
      const r = await call('config/get', {});
      if (!r.ok) return;
      const v = r.value?.proxy ?? '';
      if (v === 'direct') { setProxyMode('direct'); setProxy(''); }
      else if (v) { setProxyMode('manual'); setProxy(v); }
      else { setProxyMode('auto'); setProxy(''); }
    })();
    // 已装 DSH 版本（dshVersions 多选建议来源）
    void (async () => {
      const r = await call('runtime/get', {});
      if (r.ok && Array.isArray(r.value?.installedDshVersions)) setInstalledDsh(r.value.installedDshVersions);
    })();
    // 启动器注册表（机器可读版，launchers/registry 端点）：失败静默回落内置清单
    void (async () => {
      const r = await call('launchers/registry', {});
      if (r.ok && Array.isArray(r.value?.launchers) && r.value.launchers.length) {
        setLaunchersReg(r.value.launchers);
      }
    })();
  }, []);

  const active = profiles.find((p) => p.active) ?? null;

  const showOk = (text) => setResult({ ok: true, text });
  const showErr = (error) => setResult({ ok: false, error });

  // About 页：用系统浏览器打开外部链接（经 host，避免 renderer 里 target=_blank 不可控）。
  const openUrl = (url) => {
    void call('plugin/open-url', { url });
  };

  // About 页：检查更新（host 拉 registry 最新版并与本地比较）。
  const doCheckUpdate = async () => {
    setUpdate({ checking: true });
    const r = await call('plugin/check-update', {});
    if (!r.ok) setUpdate({ error: r.error });
    else setUpdate(r.value);
  };

  // About 页：保存代理设置（config/set 里 host 会立即 setProxy，无需重启）。
  const doSaveProxy = async () => {
    const value = proxyMode === 'direct' ? 'direct' : proxyMode === 'manual' ? proxy.trim() : '';
    const r = await call('config/set', { proxy: value });
    if (!r.ok) return showErr(r.error);
    showOk(t('result.proxySaved'));
  };

  // 点击「切换」先做只读预检，弹确认窗；用户点「确认切换」才真正调 profile/switch。
  const askSwitch = async (name) => {
    const r = await call('profile/switch-check', { name });
    if (!r.ok) return showErr(r.error);
    setManagerSource('npm');
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
    const r = await call('profile/switch', { name, managerSource });
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
    showOk(t('result.taskStarted'));
    watch(r.value.taskId);
  };

  const doOpenTasks = () => {
    setTasksOpen((v) => !v);
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
    showOk(t('result.taskStarted'));
    watch(r.value.taskId);
  };

  const doImport = async () => {
    const src = source.trim();
    if (!src) return setFieldError(t('err.source'));
    setSubmitting(true);
    // 安装前预检（v5 r2 §8.4）：pack/view 做 launchers 判定——warn 级须用户确认后才安装。
    const v = await call('pack/view', { source: src });
    setSubmitting(false);
    if (!v.ok) return setFieldError(v.error);
    const warnings = v.value?.launchersWarnings ?? [];
    if (warnings.some((w) => w.level === 'warn')) {
      // 重警告（supported:false）：弹确认对话框，确认后走 confirmInstall（导入弹窗暂留，取消可返回）
      setInstallConfirm({ source: src, extra: {}, warnings, fromDialog: true });
      return;
    }
    // info 级（版本不足 / 白名单未含本启动器）：轻提示放行，不打断
    const infos = warnings.filter((w) => w.level === 'info');
    if (infos.length) showOk(infos.map((w) => w.message).join('\n'));
    setSource('');
    closeDialog();
    await doInstallTask(src, {});
  };

  const loadMarket = async () => {
    setMarket(undefined);
    const r = await call('pack/market', {});
    if (r.ok) setMarket({ packs: r.value.packs ?? [], error: r.value.error ?? null });
    else setMarket({ packs: [], error: r.error });
  };

  // 真正的安装（任务中心非阻塞）：launchers 确认流的终点，市场 / 本地导入两条路径共用。
  const doInstallTask = async (src, extra) => {
    setResult({ pending: true });
    const r = await call('pack/install', { source: src, ...extra });
    if (!r.ok) return showErr(r.error);
    showOk(t('result.taskStarted'));
    watch(r.value.taskId);
  };

  const doInstallFromMarket = async (pack) => {
    const src = pack?.downloadUrl || pack?.urls?.[0];
    if (!src) return showErr('该包没有可下载地址');
    setResult({ pending: true });
    // 安装前预检（v5 r2 §8.4）：与本地导入同一条 pack/view 校验点。
    const v = await call('pack/view', { source: src });
    if (!v.ok) return showErr(v.error);
    const warnings = v.value?.launchersWarnings ?? [];
    const extra = {
      expectedSha256: pack?.sha256 || undefined,
      expectedSize: pack?.size || undefined,
    };
    if (warnings.some((w) => w.level === 'warn')) {
      setInstallConfirm({ source: src, extra, warnings, fromDialog: false });
      return;
    }
    const infos = warnings.filter((w) => w.level === 'info');
    if (infos.length) showOk(infos.map((w) => w.message).join('\n'));
    await doInstallTask(src, extra);
  };

  // 安装确认弹窗的「仍要安装」：warn 级放行须用户确认（v3 §8.4「警告放行」+ 留痕由任务日志承担）。
  const confirmInstall = async () => {
    const c = installConfirm;
    if (!c) return;
    setInstallConfirm(null);
    if (c.fromDialog) {
      setSource('');
      closeDialog();
    }
    await doInstallTask(c.source, c.extra ?? {});
  };

  // 市场详情：懒加载 packs/<id>/manifest.json + README（fetchMarketPackDetail），弹窗展示 r2 徽标。
  const doMarketDetail = async (pack) => {
    setDetail({ pending: true, pack });
    const r = await call('pack/market-detail', { pack });
    if (!r.ok) { setDetail({ error: r.error, pack }); return; }
    setDetail({
      pack,
      manifest: r.value.manifest,
      readme: r.value.readme ?? '',
      r2: r.value.r2 ?? {},
      badges: r.value.badges ?? [],
    });
  };

  // r2 徽标 → 本地化文案（结构化数据来自 core r2Badges，经 endpoint 透传；文案在 UI 层 i18n）。
  const badgeText = (b) => {
    if (b.kind === 'launcher-require') return t('market.r2.launcherRequire').replace('{id}', b.id).replace('{ver}', b.minVersion);
    if (b.kind === 'launcher-conflict') return t('market.r2.launcherConflict').replace('{id}', b.id).replace('{reason}', b.reason || t('market.r2.noReason'));
    if (b.kind === 'dsh-versions') return t('market.r2.dshVersions').replace('{versions}', b.versions.join(', '));
    // 展示侧：带内嵌依赖的包（多由 feat/vendoring 分支产出）在这里标出数量
    if (b.kind === 'vendored') return t('market.r2.vendored').replace('{count}', String(b.count));
    return '';
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
    // v5 r2：兼容性字段（dshVersions 枚举集 + launchers 兼容声明，两种形态都写 manifest）。
    // 首个版本即首选（workspace-config v1 r2）：未显式填「DSH 版本」时用集合首项作 dshVersion。
    const versions = parseDshVersionsInput(dshVersionsText);
    if (versions.length) {
      overrides.dshVersions = versions;
      if (!overrides.dshVersion) overrides.dshVersion = versions[0];
    }
    const launchers = buildLaunchersField();
    if (Object.keys(launchers).length) overrides.launchers = launchers;
    // 基线已取消离线包：不再向导出 payload 写内嵌档位 / 内嵌坐标（其余字段一律保留）。
    const r = await call('pack/export', overrides);
    if (!r.ok) return showErr(r.error);
    showOk(t('result.taskStarted'));
    watch(r.value.taskId);
  };

  // 导出页「上传到 GitHub」：切回聊天框并把发布指令直接发给 AI（走 session-scope 的 conversation.send）。
  const doAiUpload = async () => {
    if (!sendToChat) { setUpload({ ok: false, error: t('upload.noService') }); return; }
    setUpload({ pending: true });
    const parts = ['请帮我把整合包发布到 GitHub'];
    if (exportProfile) parts.push(`profile=${exportProfile}`);
    if ((meta.name ?? '').trim()) parts.push(`name=${String(meta.name).trim()}`);
    if ((meta.version ?? '').trim()) parts.push(`version=${String(meta.version).trim()}`);
    const prompt = parts.join('，') + '。';
    try {
      await sendToChat(prompt);
      setUpload({ ok: true, text: t('upload.sent') });
    } catch (e) {
      setUpload({ ok: false, error: `${t('upload.failed')}：${String(e?.message ?? e)}` });
    }
  };

  // 「兼容 DSH 版本集」文本 → 去重去空数组（中英文逗号 / 分号 / 空白分隔）。
  const parseDshVersionsInput = (text) =>
    [...new Set(String(text ?? '').split(/[,，;；\s]+/).map((s) => s.trim()).filter(Boolean))];

  // 启动器编辑状态 → manifest launchers 字段（简式糖：支持+版本 → "ver"；支持 → true；冲突 → false / 全式带 reason）。
  const buildLaunchersField = () => {
    const out = {};
    for (const [id, s] of Object.entries(launchersState)) {
      if (!s || (s.mode !== 'support' && s.mode !== 'conflict')) continue;
      if (s.mode === 'support') out[id] = (s.minVersion ?? '').trim() || true;
      else out[id] = (s.reason ?? '').trim() ? { supported: false, reason: (s.reason ?? '').trim() } : false;
    }
    return out;
  };

  // manifest/.dshpkcfg 的 launchers 值 → 编辑状态（简式/全式都归一）。
  const launchersValueToState = (value) => {
    const out = {};
    for (const [id, v] of Object.entries(value ?? {})) {
      if (v === true) out[id] = { mode: 'support', minVersion: '', reason: '' };
      else if (typeof v === 'string') out[id] = { mode: 'support', minVersion: v, reason: '' };
      else if (v === false) out[id] = { mode: 'conflict', minVersion: '', reason: '' };
      else if (v && typeof v === 'object') out[id] = { mode: v.supported === false ? 'conflict' : 'support', minVersion: typeof v.minVersion === 'string' ? v.minVersion : '', reason: typeof v.reason === 'string' ? v.reason : '' };
    }
    return out;
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
    // v5 r2 兼容性字段回填（数组 → 逗号文本；launchers 简式/全式 → 编辑状态）
    // 基线已取消离线包：.dshpkcfg 的内嵌档位字段随基线一并移除，不再回填。
    setDshVersionsText(Array.isArray(cfg?.dshVersions) ? cfg.dshVersions.join(', ') : '');
    setLaunchersState(launchersValueToState(cfg?.launchers));
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
    // v5 r2 兼容性字段持久化（.dshpkcfg 白名单已扩展）
    const versions = parseDshVersionsInput(dshVersionsText);
    if (versions.length) cfg.dshVersions = versions;
    const launchers = buildLaunchersField();
    if (Object.keys(launchers).length) cfg.launchers = launchers;
    // 基线已取消离线包：不再把内嵌档位写进 .dshpkcfg。
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

  // 基线已取消离线包：依赖清单加载（loadDeps）、默认勾选与「刷新依赖」触发的自动重读
  // （原 pack/dependencies 轮询 effect）随之删除，这里不再保留任何内嵌相关逻辑。

  // 任务中心面板：展开期间轮询 task/list（600ms），收起即停止。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!tasksOpen) return;
    let stopped = false;
    const load = async () => {
      const r = await call('task/list', {});
      if (stopped || !r.ok) return;
      setTaskList(r.value.tasks ?? []);
    };
    void load();
    const timer = setInterval(load, 600);
    return () => { stopped = true; clearInterval(timer); };
  }, [tasksOpen]);

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
    logoTile: {
      width: 88, height: 88, borderRadius: 20, background: '#fff', color: '#4b7bec',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: '0 4px 16px rgba(0,0,0,0.28)', flex: '0 0 auto',
    },
    btnPrimary: {
      height: 30, padding: '0 14px', borderRadius: 15, border: '1px solid #4b7bec', cursor: 'pointer',
      fontSize: 13, lineHeight: '18px', background: '#4b7bec', color: '#fff', fontWeight: 600, font: 'inherit',
      width: 'fit-content', flex: '0 0 auto',
    },
    // —— 任务中心内嵌面板 ——
    taskPanel: { display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', marginBottom: 12, borderRadius: 10, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)' },
    taskCard: { display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)' },
    taskTitle: { fontSize: 13, fontWeight: 600, lineHeight: '20px', color: 'var(--dsw-alias-label-primary)', wordBreak: 'break-all' },
    taskTimeline: { display: 'flex', flexWrap: 'wrap', gap: '6px 16px' },
    taskStep: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)' },
    taskDot: { width: 14, height: 14, borderRadius: '50%', flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, lineHeight: 1, border: '1.5px solid var(--dsw-alias-border-l2)', color: 'transparent', background: 'transparent' },
    taskLog: { margin: 0, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-secondary)', font: '12px/1.5 ui-monospace, Consolas, "Courier New", monospace', maxHeight: 160, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
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
          h('button', { type: 'button', style: style.btn, disabled: !rpc || !active, onClick: () => doExportProfile(active?.name) }, t('action.quickExport')),
          h('button', { type: 'button', style: style.btn, disabled: !rpc || !active, onClick: () => doOpenDir(active?.name) }, t('action.openDir')),
          h('button', { type: 'button', style: style.btn, disabled: !rpc, onClick: doOpenTasks }, t('action.tasks')),
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
        h('div', { style: style.groupTitle }, t('compat.title')),
        h('label', { style: style.field },
          h('span', { style: style.fieldLabel }, t('compat.dshVersions')),
          h('input', {
            style: style.input, value: dshVersionsText,
            placeholder: '0.1.1-rc.2, 0.1.0',
            list: 'dspack-dshversions',
            onChange: (e) => setDshVersionsText(e.target.value),
          }),
          installedDsh.length
            ? h('datalist', { id: 'dspack-dshversions' },
                installedDsh.map((v) => h('option', { key: v, value: v })))
            : null,
        ),
        h('p', { style: style.hint }, t('compat.dshVersionsHint')),
        h('div', { style: style.field },
          h('span', { style: style.fieldLabel }, t('compat.launchers')),
          ...(launchersReg ?? LAUNCHER_IDS.map((id) => ({ id, name: id }))).map(({ id, name }) => {
            const st = launchersState[id] ?? { mode: 'none', minVersion: '', reason: '' };
            const setEntry = (patch) => setLaunchersState((s) => ({ ...s, [id]: { ...(s[id] ?? { minVersion: '', reason: '' }), ...patch } }));
            return h('div', { key: id, style: { ...style.row, flexWrap: 'nowrap' } },
              h('span', { style: { ...style.line, flex: '0 0 190px', wordBreak: 'break-all' } }, name && name !== id ? `${name}（${id}）` : id),
              h('select', {
                style: { ...style.input, flex: '0 0 auto', width: 110 },
                value: st.mode,
                onChange: (e) => {
                  const mode = e.target.value;
                  if (mode === 'none') setLaunchersState((s) => { const n = { ...s }; delete n[id]; return n; });
                  else setEntry({ mode });
                },
              },
                h('option', { value: 'none' }, t('launcher.none')),
                h('option', { value: 'support' }, t('launcher.support')),
                h('option', { value: 'conflict' }, t('launcher.conflict')),
              ),
              st.mode === 'support'
                ? h('input', {
                    style: { ...style.input, flex: '0 1 170px' },
                    placeholder: t('launcher.minVersion'),
                    value: st.minVersion ?? '',
                    onChange: (e) => setEntry({ minVersion: e.target.value }),
                  })
                : null,
              st.mode === 'conflict'
                ? h('input', {
                    style: { ...style.input, flex: '1 1 auto', minWidth: 120 },
                    placeholder: t('launcher.reason'),
                    value: st.reason ?? '',
                    onChange: (e) => setEntry({ reason: e.target.value }),
                  })
                : null,
            );
          }),
        ),
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
      // 基线已取消离线包：「内嵌依赖（离线分发）」表单区（档位选择 / 依赖勾选清单 /
      // 「刷新依赖」按钮 / 「已内嵌」「未安装」提示）整块移除，导出侧不再有内嵌相关 UI。
      h('div', { style: style.row },
        h('button', { type: 'button', style: style.btn, disabled: !rpc, onClick: doSaveConfig }, t('action.save')),
        h('button', { type: 'button', style: style.btn, disabled: !rpc, onClick: doLoadConfig }, t('action.load')),
        h('button', { type: 'button', style: style.btn, disabled: !rpc, onClick: doExportFromForm }, t('action.export')),
      ),
      h('div', { style: style.row },
        h('button', { type: 'button', style: style.btn, disabled: !sendToChat || upload?.pending, onClick: doAiUpload }, t('action.upload')),
        upload?.pending ? h('span', { style: style.line }, t('result.pending'))
          : upload?.ok ? h('span', { style: style.ok }, upload.text)
          : upload?.ok === false ? h('span', { style: style.err }, upload.error)
          : h('span', { style: style.hint }, t('upload.hint')),
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
          h('span', { style: style.line },
            `${p.author ? p.author + ' · ' : ''}${p.version || '?'}${p.dshVersion ? ' · DSH ' + p.dshVersion : ''}`
            // 索引派生标记（v5 r2）：声明了 launchers 的包打标，详情弹窗里看完整兼容性徽标
            + (p.launcherRestricted ? ' · ⚠ ' + t('market.launcherRestricted') : '')),
        ),
        h('div', { style: style.row },
          h('button', { type: 'button', style: style.btnSmall, disabled: !rpc || detail?.pending, onClick: () => void doMarketDetail(p) }, t('market.detail')),
          h('button', { type: 'button', style: style.btnSmall, disabled: !rpc, onClick: () => doInstallFromMarket(p) }, t('action.install')),
        ),
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

  const renderLogo = () =>
    h('div', { style: style.logoTile },
      h('svg', { viewBox: '0 0 1024 1024', width: 52, height: 52, style: { display: 'block' } },
        h('path', { d: LOGO_PATH, fill: 'currentColor' }),
      ),
    );

  const renderAbout = () => {
    const updateLine = !update ? null : update.checking
      ? h('p', { style: { ...style.line, margin: 0 } }, t('about.checking'))
      : update.error
        ? h('p', { style: { ...style.err, margin: 0 } }, `${t('about.checkFailed')}：${update.error}`)
        : update.outdated
          ? h('div', { style: { ...style.row, justifyContent: 'center' } },
              h('p', { style: { margin: 0, fontSize: 12, lineHeight: '18px', color: '#e8a23a', fontWeight: 600 } },
                t('about.newVersion').replace('{latest}', update.latest).replace('{current}', update.current)),
              h('button', { type: 'button', style: style.btnSmall, onClick: () => openUrl(update.npmUrl || NPM_URL) }, t('about.viewNpm')),
            )
          : h('p', { style: { ...style.line, margin: 0 } }, `${t('about.upToDate')}（${update.latest}）`);

    return h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '24px 0' } },
      renderLogo(),
      h('div', { style: { fontSize: 16, fontWeight: 700, lineHeight: '24px', color: 'var(--dsw-alias-label-primary)' } }, MANAGER_PKG),
      h('p', { style: { ...style.line, margin: 0 } }, `${t('about.version')} ${VERSION}`),
      h('p', { style: { ...style.line, margin: 0, maxWidth: 440, textAlign: 'center' } }, t('about.desc')),
      h('p', { style: { ...style.line, margin: 0, maxWidth: 440, textAlign: 'center', fontStyle: 'italic', color: 'var(--dsw-alias-label-primary)' } }, t('about.philosophy')),
      h('div', { style: { ...style.row, justifyContent: 'center' } },
        h('button', { type: 'button', style: style.btn, onClick: () => doCheckUpdate() }, t('about.checkUpdate')),
      ),
      updateLine,
      // —— 网络（代理设置：覆盖环境变量，保存即生效）——
      h('div', { style: { ...style.group, width: '100%', maxWidth: 440, paddingTop: 14, borderTop: '1px solid var(--dsw-alias-border-l2)' } },
        h('p', { style: style.groupTitle }, t('group.network')),
        h('div', { style: style.field },
          h('span', { style: style.fieldLabel }, t('field.proxyMode')),
          h('div', { style: style.row },
            ['auto', 'direct', 'manual'].map((m) =>
              h('button', {
                key: m, type: 'button',
                style: proxyMode === m ? { ...style.tab, ...style.tabActive } : style.tab,
                onClick: () => setProxyMode(m),
              }, t('proxyMode.' + m)),
            ),
          ),
        ),
        proxyMode === 'manual'
          ? h('label', { style: style.field },
              h('span', { style: style.fieldLabel }, t('field.proxy')),
              h('input', {
                style: style.input, value: proxy,
                placeholder: 'http://127.0.0.1:7890',
                onInput: (e) => setProxy(e.target.value),
              }),
            )
          : null,
        h('p', { style: style.hint }, t('hint.proxy')),
        h('div', { style: style.row },
          h('button', { type: 'button', style: style.btn, disabled: !rpc, onClick: doSaveProxy }, t('action.save')),
        ),
      ),
      h('div', { style: { ...style.row, justifyContent: 'center' } },
        h('button', { type: 'button', style: style.btnSmall, onClick: () => openUrl(AUTHOR_URL) }, `${t('about.author')} ${AUTHOR}`),
        h('button', { type: 'button', style: style.btnSmall, onClick: () => openUrl(REPO_URL) }, t('about.repo')),
        h('button', { type: 'button', style: style.btnSmall, onClick: () => openUrl(REPO_URL) }, `⭐ ${t('about.star')}`),
      ),
      // —— 生态（DSH-PackForge 名下其它项目）——
      h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: '100%', maxWidth: 440, paddingTop: 14, borderTop: '1px solid var(--dsw-alias-border-l2)' } },
        h('p', { style: style.groupTitle }, t('about.ecosystem')),
        h('div', { style: { ...style.row, justifyContent: 'center' } },
          h('button', { type: 'button', style: style.btnSmall, onClick: () => openUrl(SPEC_URL) }, t('about.ecosystem.spec')),
          h('button', { type: 'button', style: style.btnSmall, onClick: () => openUrl(APP_URL) }, t('about.ecosystem.app')),
          h('button', { type: 'button', style: style.btnSmall, onClick: () => openUrl(MARKET_URL) }, t('about.ecosystem.market')),
        ),
      ),
      // —— 版权说明 ——
      h('p', { style: { ...style.hint, margin: '4px 0 0', textAlign: 'center', maxWidth: 440 } }, t('about.copyright')),
    );
  };

  const content = tab === 'manage' ? renderManage() : tab === 'export' ? renderExport() : tab === 'market' ? renderMarket() : renderAbout();

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
        confirm.hasManager ? null : h('div', { style: style.group },
          h('span', { style: style.fieldLabel }, t('confirm.managerSource')),
          h('label', { key: 'npm', style: style.row },
            h('input', {
              type: 'radio', name: 'managerSource', checked: managerSource === 'npm',
              style: { width: 14, height: 14, cursor: 'pointer', accentColor: '#4b7bec' },
              onChange: () => setManagerSource('npm'),
            }),
            h('span', { style: style.line }, t('confirm.source.npm')),
          ),
          h('label', { key: 'copy', style: style.row },
            h('input', {
              type: 'radio', name: 'managerSource', checked: managerSource === 'copy',
              style: { width: 14, height: 14, cursor: 'pointer', accentColor: '#4b7bec' },
              onChange: () => setManagerSource('copy'),
            }),
            h('span', { style: style.line }, t('confirm.source.copy')),
          ),
        ),
        h('p', { style: style.hint }, t('confirm.hintRestart')),
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

  // —— 安装确认弹窗（v5 r2 §8.4 判定表第 4 行）：pack/view 预检出 warn 级 launchers 警告时弹出 ——
  // 复用切换确认弹窗的 overlay / modal / warn 样式；取消 = 放弃安装，确认 = 照常安装（警告放行）。
  const renderInstallConfirm = () => {
    if (!installConfirm) return null;
    const warnings = installConfirm.warnings ?? [];
    return h('div', { style: style.overlay, onClick: () => setInstallConfirm(null) },
      h('div', { style: style.modal, onClick: (e) => e.stopPropagation() },
        h('h3', { style: style.modalTitle }, t('installConfirm.title')),
        h('p', { style: style.hint }, t('installConfirm.hint')),
        ...warnings.map((w, i) =>
          h('div', { key: i, style: style.warn },
            h('span', { style: style.warnIcon }, '!'),
            h('span', null, w.message),
          )),
        h('div', { style: style.confirmBtns },
          h('button', { type: 'button', style: style.btn, onClick: () => setInstallConfirm(null) }, t('confirm.cancel')),
          h('button', { type: 'button', style: style.btnPrimary, onClick: confirmInstall }, t('installConfirm.ok')),
        ),
      ),
    );
  };

  // —— 市场详情弹窗（v5 r2）：懒加载 manifest 的兼容性徽标 + README ——
  // 徽标文案沿 style.line（冲突项复用 warn 警示框）；README 复用任务日志的滚动样式。
  const renderDetail = () => {
    if (!detail) return null;
    const close = () => setDetail(null);
    const pack = detail.pack ?? {};
    return h('div', { style: style.overlay, onClick: close },
      h('div', { style: { ...style.modal, maxWidth: 560 }, onClick: (e) => e.stopPropagation() },
        h('h3', { style: style.modalTitle }, t('market.detailTitle')),
        detail.pending
          ? h('p', { style: style.line }, t('market.loading'))
          : detail.error
            ? h('p', { style: style.err }, `${t('market.error')}：${detail.error}`)
            : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 } },
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
                  h('span', { style: style.listName }, pack.displayName || pack.name || detail.manifest?.name || ''),
                  pack.description ? h('span', { style: style.line }, pack.description) : null,
                  h('span', { style: style.line },
                    `${pack.author ? pack.author + ' · ' : ''}${pack.version || '?'}${pack.dshVersion ? ' · DSH ' + pack.dshVersion : ''}`),
                ),
                // v5 r2 兼容性徽标：需启动器 ≥ x / 声明冲突 / 兼容 DSH 版本集（离线包徽标已随基线移除）
                (detail.badges ?? []).length
                  ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                      detail.badges.map((b, i) => b.kind === 'launcher-conflict'
                        ? h('div', { key: i, style: style.warn },
                            h('span', { style: style.warnIcon }, '!'),
                            h('span', null, badgeText(b)))
                        : h('p', { key: i, style: style.line }, '· ' + badgeText(b))))
                  : h('p', { style: style.line }, t('market.r2.none')),
                detail.readme
                  ? h('pre', { style: { ...style.taskLog, maxHeight: 260 } }, detail.readme)
                  : null,
              ),
        h('div', { style: style.confirmBtns },
          h('button', { type: 'button', style: style.btn, onClick: close }, t('tasks.close')),
          detail.pending || detail.error ? null
            : h('button', {
                type: 'button', style: style.btnPrimary, disabled: !rpc,
                onClick: () => { const p = detail.pack; setDetail(null); void doInstallFromMarket(p); },
              }, t('action.install')),
        ),
      ),
    );
  };

  // —— 任务中心内嵌面板：就地渲染内存里的任务（task/list 轮询），替代旧版独立 electron/WPF 小窗 ——
  const TASK_STATUS = {
    queued: ['排队中', '#e8a23a'],
    running: ['进行中', '#6ab7ff'],
    done: ['完成', '#2ea44f'],
    failed: ['失败', '#d3383a'],
  };
  const taskDotStyle = (status) =>
    status === 'done' ? { borderColor: '#2ea44f', background: '#2ea44f', color: '#fff' }
      : status === 'failed' ? { borderColor: '#d3383a', background: '#d3383a', color: '#fff' }
        : status === 'running' ? { borderColor: '#6ab7ff', color: '#6ab7ff' }
          : {};

  const renderTasks = () => {
    const cards = taskList.map((t) => {
      const [stLabel, stColor] = TASK_STATUS[t.status] || ['?', '#9a9ba3'];
      const log = t.log || [];
      const stages = t.stages || [];
      return h('li', { key: t.id, style: style.taskCard },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
          h('span', { style: style.taskTitle }, t.title || '任务'),
          h('span', { style: { flex: '0 0 auto', fontSize: 12, fontWeight: 600, color: stColor } }, stLabel),
        ),
        stages.length
          ? h('div', { style: style.taskTimeline },
              stages.map((s) =>
                h('span', { key: s.id, style: style.taskStep },
                  h('span', { style: { ...style.taskDot, ...taskDotStyle(s.status) } }, s.status === 'done' ? '✓' : s.status === 'failed' ? '✗' : ''),
                  h('span', null, s.label),
                ),
              ),
            )
          : null,
        t.error ? h('p', { style: style.err }, '错误：' + t.error) : null,
        log.length
          ? h('pre', { style: style.taskLog }, (t.logTruncated ? '…（已截断，仅保留最后 ' + log.length + ' 行）\n' : '') + log.join('\n'))
          : null,
      );
    });
    return h('div', { style: style.taskPanel },
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('h3', { style: style.groupTitle }, t('action.tasks')),
        h('button', { type: 'button', style: style.btnSmall, onClick: doOpenTasks, title: t('tasks.close') }, '✕'),
      ),
      taskList.length === 0 ? h('p', { style: style.line }, t('tasks.empty')) : h('ul', { style: style.list }, cards),
    );
  };

  return h(Fragment, null,
    h('div', { style: style.section },
    h('div', { style: style.tabs },
      ['manage', 'export', 'market', 'about'].map((id) => h('button', {
        key: id, type: 'button',
        style: tab === id ? { ...style.tab, ...style.tabActive } : style.tab,
        onClick: () => { setTab(id); if (id === 'market' && market === null) void loadMarket(); },
      }, t('tab.' + id))),
    ),
    tasksOpen ? renderTasks() : null,
    content,
    tab === 'manage' ? h('p', { style: style.hint }, t('hint.restart')) : null,
    result
      ? h('p', { style: result.ok === false ? style.err : style.ok },
          result.pending ? t('result.pending') : (result.text ?? result.error))
      : null,
    ),
    renderConfirm(),
    renderDialog(),
    renderInstallConfirm(),
    renderDetail(),
  );
}
