import test from 'node:test';
import assert from 'node:assert/strict';
import { NodeHost } from '../src/host-node.js';

const host = new NodeHost();

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
