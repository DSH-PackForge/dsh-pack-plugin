// 客户端 RPC：ctx.connection.rpc.call 的薄封装（与宿主 rpc.js 对称）。
//
// 结果形状与宿主一致（官方 @deepseek-ai/dsh-client-connection 确证）：
//   ConnectionRpcResult = { ok:true, value } | { ok:false, error:{ code, message, details } }
import { CHANNEL } from './channel.js';

/** 构造 UI 用的 rpc 调用器；connection 服务不可用时返回 null（UI 据此停摆，不拖垮 DSH）。 */
export function createRpc(ctx) {
  const rpc = ctx?.connection?.rpc;
  if (!rpc || typeof rpc.call !== 'function') return null;
  return {
    call: (endpoint, payload, signal) => rpc.call(CHANNEL, endpoint, payload ?? {}, signal),
  };
}
