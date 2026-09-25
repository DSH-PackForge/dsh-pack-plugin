// 宿主 RPC：ctx.connection.rpc.handle 注册 + endpoint 分发 + 结果封装。
//
// 结果形状 = ConnectionRpcHandlerResult（已从官方 @deepseek-ai/dsh-client-connection 确证）：
//   { ok:true, value } | { ok:false, error:{ code, message, details } }
// 客户端 ctx.connection.rpc.call 拿到对称的 ConnectionRpcResult。
import { ENDPOINTS } from './endpoints.js';
import { CHANNEL } from './channel.js';

export const ok = (value) => ({ ok: true, value });
export const fail = (code, message, details = {}) => ({
  ok: false,
  error: { code, message, details: details ?? {} },
});

/**
 * 注册 '/dsh-pack' 通道：设置面板 UI 的静默直连入口（不经模型、不进聊天栏）。
 * @returns 注销函数；connection 服务不可用时返回 null。
 */
export function registerRpc(ctx, runtime) {
  const rpc = ctx?.connection?.rpc;
  if (!rpc || typeof rpc.handle !== 'function') return null;

  const dispose = rpc.handle(CHANNEL, async (endpoint, payload, signal, peer) => {
    const handler = ENDPOINTS[endpoint];
    if (!handler) return fail('no-such-endpoint', `未知端点：${endpoint}`);
    try {
      return ok(await handler({ ctx, runtime, payload: payload ?? {}, signal, peer }));
    } catch (err) {
      return fail('endpoint-error', err?.message ?? String(err), { stack: err?.stack });
    }
  });

  ctx.on('dispose', () => {
    try {
      dispose?.();
    } catch {
      // 注销失败不阻断卸载
    }
  });
  return dispose;
}
