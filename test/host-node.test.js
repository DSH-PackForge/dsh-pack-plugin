import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NodeHost, resolvePnpmEntry } from '../src/host-node.js';

const host = new NodeHost();

/** 起一个本地 HTTP server，返回 { port, close, hits } 供下载测试用。 */
async function startServer(handler) {
  let hits = 0;
  const server = http.createServer((req, res) => { hits += 1; handler(req, res, hits); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, hits: () => hits, close: () => new Promise((r) => server.close(r)) };
}

/** 起一个极简 HTTP 正向代理：收到绝对 URI 请求后转发到目标，记录 hits（证明请求确实经过它）。 */
async function startProxy() {
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    let target;
    try { target = new URL(req.url); } catch { res.writeHead(400); res.end(); return; }
    const upstream = http.request({
      host: target.hostname, port: target.port || 80,
      path: target.pathname + target.search, method: req.method,
    }, (up) => {
      res.writeHead(up.statusCode ?? 200, up.headers);
      up.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, hits: () => hits, close: () => new Promise((r) => server.close(r)) };
}

test('exec：onOutput 捕获 stdout/stderr（pipe），不直通终端', async () => {
  let out = '';
  const r = await host.exec('echo', ['hello-task-center'], {
    onOutput: (chunk) => { out += chunk; },
  });
  assert.equal(r.status, 0);
  assert.equal(r.error, undefined);
  assert.match(out, /hello-task-center/);
});

test('exec：不传 onOutput 时走 inherit（命令正常退出、不捕获）', async () => {
  const r = await host.exec('echo', ['hello-no-capture']);
  assert.equal(r.status, 0);
  assert.equal(r.error, undefined);
});

test('exec：命令不存在 → error', async () => {
  const r = await host.exec('dsh-pack-nodefinitely-not-a-cmd-xyz', ['x']);
  // Windows shell:true 下找不到命令也是非零退出或 spawn error，都归一为 status 非 0 或 error。
  assert.ok(r.status !== 0 || r.error, JSON.stringify(r));
});

test('download：瞬时断连自动重试后成功', async () => {
  const srv = await startServer((_req, res, hits) => {
    if (hits === 1) { res.destroy(); return; } // 第一次：模拟连接被重置
    res.writeHead(200);
    res.end('pack-bytes');
  });
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-dl-'));
  try {
    const dest = path.join(dir, 'pack.dspack');
    await host.download(`http://127.0.0.1:${srv.port}/pack.dspack`, dest);
    assert.equal(await fsp.readFile(dest, 'utf8'), 'pack-bytes');
    assert.equal(srv.hits(), 2); // 重试了一次
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
    await srv.close();
  }
});

test('download：设置代理后经代理转发（不直连）', async () => {
  const srv = await startServer((_req, res) => { res.writeHead(200); res.end('via-proxy'); });
  const proxy = await startProxy();
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-dl-'));
  try {
    host.setProxy(`http://127.0.0.1:${proxy.port}`);
    const dest = path.join(dir, 'pack.dspack');
    await host.download(`http://127.0.0.1:${srv.port}/pack.dspack`, dest);
    assert.equal(await fsp.readFile(dest, 'utf8'), 'via-proxy');
    assert.equal(proxy.hits(), 1); // 请求确实走了代理
  } finally {
    host.setProxy(null);
    await fsp.rm(dir, { recursive: true, force: true });
    await proxy.close();
    await srv.close();
  }
});

test('download：setProxy("direct") 覆盖显式代理，强制直连', async () => {
  const srv = await startServer((_req, res) => { res.writeHead(200); res.end('direct-bytes'); });
  const proxy = await startProxy();
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-dl-'));
  try {
    // 先设显式代理，确认走代理
    host.setProxy(`http://127.0.0.1:${proxy.port}`);
    const a = path.join(dir, 'a');
    await host.download(`http://127.0.0.1:${srv.port}/p`, a);
    assert.equal(proxy.hits(), 1);

    // 再切成 direct，应绕过代理直连（proxy 命中数不变）
    host.setProxy('direct');
    const b = path.join(dir, 'b');
    await host.download(`http://127.0.0.1:${srv.port}/p`, b);
    assert.equal(await fsp.readFile(b, 'utf8'), 'direct-bytes');
    assert.equal(proxy.hits(), 1);
  } finally {
    host.setProxy(null);
    await fsp.rm(dir, { recursive: true, force: true });
    await proxy.close();
    await srv.close();
  }
});

test('proxyStatus：描述走哪个代理 / 还是直连', () => {
  host.setProxy('http://127.0.0.1:7890');
  assert.deepEqual(host.proxyStatus(), { kind: 'manual', url: 'http://127.0.0.1:7890' });

  host.setProxy('direct');
  assert.deepEqual(host.proxyStatus(), { kind: 'direct', url: null });

  host.setProxy(null);
});

test('download：HTTP 404 不重试直接抛错', async () => {
  const srv = await startServer((_req, res) => { res.writeHead(404); res.end(); });
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-dl-'));
  try {
    await assert.rejects(
      () => host.download(`http://127.0.0.1:${srv.port}/nope`, path.join(dir, 'out')),
      /HTTP 404/,
    );
    assert.equal(srv.hits(), 1); // 非瞬时错误，不重试
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
    await srv.close();
  }
});

test('resolvePnpmEntry：env 覆盖优先', () => {
  assert.equal(
    resolvePnpmEntry({ env: { DSH_DESKTOP_PNPM_ENTRY: '/x/pnpm.mjs' }, resourcesPath: '/res' }),
    '/x/pnpm.mjs',
  );
});

test('resolvePnpmEntry：resourcesPath 标准布局', () => {
  assert.equal(
    resolvePnpmEntry({ env: {}, resourcesPath: '/res' }),
    path.join('/res', 'runtime', 'pnpm', 'bin', 'pnpm.mjs'),
  );
});

test('resolvePnpmEntry：两者皆无 → null（回退 PATH）', () => {
  assert.equal(resolvePnpmEntry({ env: {}, resourcesPath: undefined }), null);
});

test('pnpm：复用 DSH 自带运行时（ELECTRON_RUN_AS_NODE=1 + 代理透传 + 日志标注层级）', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-pnpm-'));
  const prev = process.env.DSH_DESKTOP_PNPM_ENTRY;
  try {
    const entry = path.join(dir, 'fake-pnpm.mjs');
    await fsp.writeFile(entry, 'console.log(JSON.stringify({ argv: process.argv.slice(2), runAsNode: process.env.ELECTRON_RUN_AS_NODE ?? null, httpsProxy: process.env.HTTPS_PROXY ?? null }));');
    process.env.DSH_DESKTOP_PNPM_ENTRY = entry;
    host.setProxy('http://127.0.0.1:9');

    let out = '';
    const r = await host.pnpm(['install', '--frozen-lockfile'], {
      cwd: dir,
      onOutput: (chunk) => { out += chunk; },
    });
    assert.equal(r.status, 0);
    assert.equal(r.error, undefined);
    const lines = out.trim().split('\n');
    assert.equal(lines.length, 2);
    assert.match(lines[0], /DSH_DESKTOP_PNPM_ENTRY/); // 日志首行标出用了哪一级
    const parsed = JSON.parse(lines[1]);
    assert.deepEqual(parsed.argv, ['install', '--frozen-lockfile']);
    assert.equal(parsed.runAsNode, '1');
    assert.equal(parsed.httpsProxy, 'http://127.0.0.1:9');
  } finally {
    if (prev === undefined) delete process.env.DSH_DESKTOP_PNPM_ENTRY; else process.env.DSH_DESKTOP_PNPM_ENTRY = prev;
    host.setProxy(null);
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('pnpm：无自带运行时 → 日志标注 PATH 回退', async () => {
  const prev = process.env.DSH_DESKTOP_PNPM_ENTRY;
  if (prev !== undefined) delete process.env.DSH_DESKTOP_PNPM_ENTRY;
  try {
    let out = '';
    // 本机无论是否装了 pnpm，日志都应先标出「使用 PATH 上的 pnpm」（不断言退出结果）。
    await host.pnpm(['--version'], { onOutput: (chunk) => { out += chunk; } });
    assert.match(out, /使用 PATH 上的 pnpm/);
  } finally {
    if (prev !== undefined) process.env.DSH_DESKTOP_PNPM_ENTRY = prev;
  }
});
