// DSH host 插件入口（cordis 面）—— 纯方案 B：仅 UI + 后端，不做 AI 驱动。
//
// 0.1.7 原生契约（已从官方 .d.ts / 源码确证）：
//   - ctx.connection.rpc.handle(channel, handler) 提供客户端→宿主直连 RPC（UI 静默调用，不进聊天栏）；
//   - ctx.profileContext 直接给出 home/当前 profile 事实（零猜路径）。
import { resolveRuntime } from './runtime.js';
import { registerRpc } from './rpc.js';

export const name = 'dspack-host';

export const inject = ['connection'];

export function apply(ctx) {
  // UI ↔ 后端直连 RPC（设置面板按钮走这里，静默、不进聊天栏）。
  registerRpc(ctx, resolveRuntime(ctx));
}
