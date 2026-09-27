// DSH 客户端插件入口：只做「设置面板 section」，UI 经 ctx.connection.rpc 直连宿主（静默，不进聊天栏）。
//
// 纯 UI + 后端模型：这里不再 import 任何 core / node 内建；宿主 endpoint 层承担全部业务逻辑。
import { registerSettingsSection } from './settings.js';
import { createRpc } from './client-rpc.js';

export const name = 'dsh-packforge';

export const inject = ['slots', 'locale', 'connection', 'sessions', 'uiWorkspace'];

export function apply(ctx) {
  // 临时验证日志：确认 client 面被浏览器 shell 挂载 + 服务注入到位。
  console.error('[dsh-pack][client] apply slots=' + (!!ctx?.slots) + ' locale=' + (!!ctx?.locale) + ' connection=' + (!!ctx?.connection) + ' rpc=' + (!!ctx?.connection?.rpc) + ' sessions=' + (!!ctx?.sessions) + ' uiWorkspace=' + (!!ctx?.uiWorkspace));
  const rpc = createRpc(ctx);
  registerSettingsSection(ctx, { rpc, sendToChat: makeSendToChat(ctx) });
}

// 导出页「上传到 GitHub」用的 sendToChat：新建会话 → 切到该会话视图 → 借 session scope 直接
// 把 prompt 发进聊天栏（避免 conversation.send 在 root context 上的 scope 报错）。
// 任一关键服务缺失（DSH 版本过低 / 注入未到）时返回 null，设置页按钮据此禁用并提示。
function makeSendToChat(ctx) {
  const sessions = ctx?.sessions;
  const uiWorkspace = ctx?.uiWorkspace;
  if (!sessions
    || typeof sessions.create !== 'function'
    || typeof sessions.using !== 'function'
    || typeof sessions.scope !== 'function'
    || !uiWorkspace
    || typeof uiWorkspace.openSession !== 'function') {
    return null;
  }
  return async (text) => {
    const created = await sessions.create({});
    if (!created?.ok) throw new Error(created?.error?.message ?? '创建会话失败');
    const id = created.value?.sessionId;
    if (!id) throw new Error('创建会话未返回 sessionId');
    uiWorkspace.openSession(id);
    await sessions.using(id, { source: 'dspack' }, async () => {
      const scoped = sessions.scope(id);
      const conversation = scoped?.conversation;
      if (!conversation || typeof conversation.send !== 'function') throw new Error('conversation 服务不可用');
      await conversation.send(text);
    });
  };
}
