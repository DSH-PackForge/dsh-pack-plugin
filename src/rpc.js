// 宿主 RPC：在 webServer 上挂 /dsh-pack 前缀路由，自行解析 connection 的
// client-request 信封、分发到 endpoint、回对称的 server-response。
//
// 为什么不走 ctx.connection.rpc.handle(channel, handler)：
//   官方 HostConnectionService.rpc.handle 内部把 owner 固定成 this.ctx（connection
//   插件自身 context，只 inject 了 credentials），register() 里访问 owner.webServer
//   会拿到 undefined → 抛 TypeError → fiber 直接 FAILED（插件列表显示「异常」）。
//   而 /api 拦截又被 gateway 独占（intercept 一条通道只允许一个 owner）。所以第三方
//   bundle 唯一稳的直连通道，是自己 inject webServer 并注册一个前缀路由。
//
// 结果形状与客户端 ctx.connection.rpc.call 完全对称（官方 @deepseek-ai/dsh-client-connection 确证）：
//   { ok:true, value } | { ok:false, error:{ code, message, details } }
import { ENDPOINTS } from './endpoints.js';
import { CHANNEL } from './channel.js';
import { BALL_SCRIPT_PATH, readBallAsset } from './ball-host.js';

export const ok = (value) => ({ ok: true, value });
export const fail = (code, message, details = {}) => ({
  ok: false,
  error: { code, message, details: details ?? {} },
});

// 与官方 endpointFromPath 同构：去掉通道前缀取相对 endpoint（允许 profile/list 这类多段）。
const endpointFromPath = (url, channel) => {
  let pathname;
  try {
    pathname = new URL(url, 'http://x').pathname;
  } catch {
    return undefined;
  }
  if (!pathname.startsWith(`${channel}/`)) return undefined;
  const endpoint = pathname.slice(channel.length + 1);
  const segments = endpoint.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..' || !/^[A-Za-z0-9_$.-]+$/.test(s))) return undefined;
  return endpoint;
};

// 读 POST 体（JSON），带 64 MiB 上限。
const readJsonBody = (req) => new Promise((resolve, reject) => {
  let size = 0;
  const chunks = [];
  req.on('data', (c) => {
    size += c.length;
    if (size > 64 * 1024 * 1024) {
      reject(new Error('请求体过大'));
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    if (raw === '') return resolve({});
    try {
      resolve(JSON.parse(raw));
    } catch (e) {
      reject(e); // 坏 JSON 转成 reject，由外层统一回 400，绝不同步抛错崩宿主
    }
  });
  req.on('error', reject);
});

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

/**
 * 注册 '/dsh-pack' 通道：设置面板 UI 的静默直连入口（不经模型、不进聊天栏）。
 * @returns 注销函数；webServer 服务不可用时返回 null。
 */
export function registerRpc(ctx, runtime) {
  const ws = ctx?.webServer;
  if (!ws || typeof ws.register !== 'function') return null;

  const route = {
    kind: 'prefix',
    path: CHANNEL,
    handler: async (req, res) => {
      // 复用 connection 的 Host/Origin + 浏览器鉴权栅栏（与 /api 同策略）。
      const rejection = ctx?.connection?.requestRejection?.(req);
      if (rejection) {
        res.writeHead(rejection);
        res.end(rejection === 401 ? 'unauthorized' : 'forbidden');
        return;
      }
      // GET 只服务悬浮球脚本（同一 prefix 路由，不新增路由以免撞 duplicate 检查）：
      // /dsh-pack/ball.js → lib/ball.js 产物。no-store 避免升级后浏览器仍用旧球。
      if (req.method === 'GET') {
        const pathname = (() => {
          try { return new URL(req.url ?? '', 'http://x').pathname; } catch { return ''; }
        })();
        if (pathname === BALL_SCRIPT_PATH) {
          const asset = await readBallAsset();
          if (!asset) {
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('ball.js 未构建：请先运行 npm run bundle');
            return;
          }
          res.writeHead(200, {
            'content-type': 'application/javascript; charset=utf-8',
            'cache-control': 'no-store',
          });
          res.end(asset.bytes);
          return;
        }
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('method not allowed');
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('method not allowed');
        return;
      }
      const endpoint = endpointFromPath(req.url ?? '', CHANNEL);
      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        json(res, 400, {
          type: 'server-response', rpcId: 'invalid-request',
          result: fail('gateway/bad-request', 'invalid client-request message', { issues: [] }),
        });
        return;
      }
      const rpcId = typeof body?.rpcId === 'string' ? body.rpcId : 'invalid-request';
      if (body?.type !== 'client-request' || typeof body?.method !== 'string') {
        json(res, 200, {
          type: 'server-response', rpcId,
          result: fail('gateway/bad-request', 'invalid client-request message', { issues: [] }),
        });
        return;
      }
      const handler = ENDPOINTS[endpoint];
      const payload = body?.payload ?? {};
      let result;
      if (endpoint === undefined || handler === undefined) {
        result = fail('no-such-endpoint', `未知端点：${body.method}`);
      } else if (body.method !== endpoint) {
        result = fail('gateway/bad-request',
          `method ${JSON.stringify(body.method)} does not match endpoint ${JSON.stringify(endpoint)}`, { issues: [] });
      } else {
        try {
          result = ok(await handler({ ctx, runtime, payload, signal: undefined, peer: undefined }));
        } catch (err) {
          result = fail('endpoint-error', err?.message ?? String(err), { stack: err?.stack });
        }
      }
      json(res, 200, { type: 'server-response', rpcId, result });
    },
  };

  // 随 fiber 生命周期自动卸载（webserver.register 返回同步 disposer，effect 会接住）。
  ctx.effect(() => ws.register(route), `dsh-pack: ${CHANNEL} rpc channel`);
  return () => {};
}
