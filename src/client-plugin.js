// DSH 客户端插件入口：只做「设置面板 section」，UI 经 ctx.connection.rpc 直连宿主（静默，不进聊天栏）。
//
// 纯 UI + 后端模型：这里不再 import 任何 core / node 内建；宿主 endpoint 层承担全部业务逻辑。
import { registerSettingsSection } from './settings.js';
import { createRpc } from './client-rpc.js';

export const name = 'dsh-packforge';

export const inject = ['slots', 'locale', 'connection'];

export function apply(ctx) {
  const rpc = createRpc(ctx);
  registerSettingsSection(ctx, { rpc });
}
