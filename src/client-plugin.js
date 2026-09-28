// DSH 客户端插件入口：设置面板 section + 悬浮球兜底挂载，UI 经 ctx.connection.rpc 直连宿主（静默，不进聊天栏）。
//
// 纯 UI + 后端模型：这里不再 import 任何 core / node 内建；宿主 endpoint 层承担全部业务逻辑。
import { registerSettingsSection } from './settings.js';
import { createRpc } from './client-rpc.js';
import { mountBall } from './ball.js';

export const name = 'dsh-packforge';

export const inject = ['slots', 'locale', 'connection', 'sessions', 'uiWorkspace'];

export function apply(ctx) {
  // 临时验证日志：确认 client 面被浏览器 shell 挂载 + 服务注入到位。
  console.error('[dsh-pack][client] apply slots=' + (!!ctx?.slots) + ' locale=' + (!!ctx?.locale) + ' connection=' + (!!ctx?.connection) + ' rpc=' + (!!ctx?.connection?.rpc) + ' sessions=' + (!!ctx?.sessions) + ' uiWorkspace=' + (!!ctx?.uiWorkspace));
  const rpc = createRpc(ctx);
  registerSettingsSection(ctx, { rpc, sendToChat: makeSendToChat(ctx) });
  mountBallFallback();
}

// 悬浮球的第二道保险：正常情况由宿主注入 index.html 后自己挂（那条路不经过任何前端插件，
// 更抗「别人把 UI 拆了」）；这里只是万一注入行没落地（比如桌面壳的注入表在宿主启动时就收集
// 完了）时补一个。mountBall 以 window.__dspackBall 为幂等守卫，重复调用只会拿回既有句柄，
// 不会挂出两个球；点击动作默认就是「打开官方设置页」。
function mountBallFallback() {
  try {
    mountBall();
  } catch (error) {
    console.error('[dsh-pack][client] 悬浮球挂载失败（不影响设置面板）:', error);
  }
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
    // sessions.create 成功直接返回 sessionId（字符串），失败抛 SessionCreateError。
    const id = await sessions.create({});
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
