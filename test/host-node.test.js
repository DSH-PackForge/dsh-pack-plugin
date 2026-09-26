import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NodeHost } from '../src/host-node.js';

const host = new NodeHost();

/** 起一个本地 HTTP server，返回 { port, close, hits } 供下载测试用。 */
async function startServer(handler) {
  let hits = 0;
  const server = http.createServer((req, res) => { hits += 1; handler(req, res, hits); });
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
