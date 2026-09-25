// DSH 客户端插件入口：只做「设置面板 section」，UI 经 ctx.connection.rpc 直连宿主（静默，不进聊天栏）。
//
// 纯 UI + 后端模型：这里不再 import 任何 core / node 内建；宿主 endpoint 层承担全部业务逻辑。
import { registerSettingsSection } from './settings.js';
import { createRpc } from './client-rpc.js';

export const name = 'dsh-packforge';

export const inject = ['slots', 'locale', 'connection'];

export function apply(ctx) {
  // 临时验证日志：确认 client 面被浏览器 shell 挂载 + 服务注入到位。
  console.error('[dsh-pack][client] apply slots=' + (!!ctx?.slots) + ' locale=' + (!!ctx?.locale) + ' connection=' + (!!ctx?.connection) + ' rpc=' + (!!ctx?.connection?.rpc));
  const rpc = createRpc(ctx);
  registerSettingsSection(ctx, { rpc });
}
