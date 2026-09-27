// DSH host 插件入口（cordis 面）—— 纯方案 B：仅 UI + 后端，不做 AI 驱动。
//
// 契约（已从官方源码确证）：
//   - 第三方 bundle 的宿主→客户端直连 RPC 只能自己 inject webServer 挂前缀路由
//     （ctx.connection.rpc.handle 在官方实现里 owner 绑死 connection 自身 ctx，拿不到
//     webServer，会抛错；/api 拦截又被 gateway 独占）—— 详见 rpc.js 顶部注释。
//   - ctx.profileContext 直接给出 home/当前 profile 事实（零猜路径）。
import { resolveRuntime } from './runtime.js';
import { registerRpc } from './rpc.js';
import { getHost } from './host.js';
import { readState } from './profiles.js';

export const name = 'dspack-host';

export const inject = ['connection', 'webServer'];

export function apply(ctx) {
  // UI ↔ 后端直连 RPC（设置面板按钮走这里，静默、不进聊天栏）。
  const runtime = resolveRuntime(ctx);
  registerRpc(ctx, runtime);
  // 启动时把已存配置里的代理地址应用到 NodeHost（设置项覆盖环境变量）；读不到/异常不阻塞启动。
  void (async () => {
    try {
      const state = await readState(runtime.home);
      getHost().setProxy(state?.config?.proxy);
    } catch { /* 忽略 */ }
  })();
}
