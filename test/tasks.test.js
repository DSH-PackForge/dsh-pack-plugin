import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createTask, get, list, setTitle, progressBridge, logSink, finish, enqueue } from '../src/tasks.js';

// 给个真实临时 home，让快照镜像落到 os.tmpdir（不影响断言，仅覆盖路径派生分支）。
const home = path.join(os.tmpdir(), 'dsh-pack-task-test-home');

test('createTask：初始形状（queued + 按 kind 建阶段）', () => {
  const id = createTask({ kind: 'install', title: '装一个包', home });
  const t = get(id);
  assert.equal(t.id, id);
  assert.equal(t.kind, 'install');
  assert.equal(t.title, '装一个包');
  assert.equal(t.status, 'queued');
  assert.deepEqual(t.stages.map((s) => s.id), ['download', 'extract', 'install', 'files']);
  assert.ok(t.stages.every((s) => s.status === 'pending'));
  assert.equal(t.log.length, 0);
  assert.equal(t.logTruncated, false);
  assert.equal(t.error, null);
});

test('createTask：export 建导出阶段', () => {
  const id = createTask({ kind: 'export', home });
  assert.deepEqual(get(id).stages.map((s) => s.id), ['scan', 'manifest', 'collect', 'pack', 'write']);
});

test('progressBridge：推进阶段、更新 label、忽略未知阶段、不回退已完成阶段', () => {
  const id = createTask({ kind: 'export', home });
  const p = progressBridge(id);

  p('scan', '扫描文件');
  let t = get(id);
  assert.equal(t.stages[0].status, 'running');
  assert.equal(t.stages[0].label, '扫描文件');
  assert.equal(t.current, 'scan');

  p('done', '收尾'); // 未知阶段静默跳过
  t = get(id);
  assert.equal(t.stages.some((s) => s.id === 'done'), false);

  finish(id, { ok: true });
  t = get(id);
  assert.ok(t.stages.every((s) => s.status === 'done'));

  p('scan', '再扫'); // 已完成阶段不回退
  assert.equal(get(id).stages[0].status, 'done');
});

test('logSink：按行切分 + finish 强刷半行 + 去 \\r', () => {
  const id = createTask({ kind: 'install', home });
  const sink = logSink(id);
  sink('a\nb\r\nc'); // c 无换行 → 留 _pending
  assert.deepEqual(get(id).log, ['a', 'b']);

  finish(id, { ok: true });
  assert.deepEqual(get(id).log, ['a', 'b', 'c']);
});

test('finish：ok → 全阶段 done；fail → current 标 failed、其余 running 标 done', () => {
  const okId = createTask({ kind: 'install', home });
  progressBridge(okId)('download');
  finish(okId, { ok: true, result: { profileName: 'x' } });
  const okT = get(okId);
  assert.equal(okT.status, 'done');
  assert.ok(okT.stages.every((s) => s.status === 'done'));
  assert.deepEqual(okT.result, { profileName: 'x' });

  const badId = createTask({ kind: 'install', home });
  const p = progressBridge(badId);
  p('download');
  p('install');
  finish(badId, { ok: false, error: '炸了' });
  const badT = get(badId);
  assert.equal(badT.status, 'failed');
  assert.equal(badT.error, '炸了');
  assert.equal(badT.stages.find((s) => s.id === 'download').status, 'done');
  assert.equal(badT.stages.find((s) => s.id === 'install').status, 'failed');
  assert.equal(badT.stages.find((s) => s.id === 'files').status, 'pending');
});

test('enqueue：全局串行（上一个 settle 后跑下一个，失败不阻断）', async () => {
  const order = [];
  const p1 = enqueue(async () => { order.push('a'); await new Promise((r) => setTimeout(r, 30)); order.push('a2'); });
  const p2 = enqueue(async () => { order.push('b'); });
  const p3 = enqueue(async () => { order.push('c'); throw new Error('x'); });
  const p4 = enqueue(async () => { order.push('d'); });
  await Promise.all([p1, p2, p3.catch(() => {}), p4]);
  assert.deepEqual(order, ['a', 'a2', 'b', 'c', 'd']);
});

test('list：公开视图不含内部字段', () => {
  const id = createTask({ kind: 'install', title: 'T', home });
  logSink(id)('x\n');
  const views = list();
  const v = views.find((x) => x.id === id);
  assert.ok(v);
  assert.equal('_pending' in v, false);
  assert.equal('logBytes' in v, false);
  assert.deepEqual(v.log, ['x']);
});

test('setTitle 更新标题', () => {
  const id = createTask({ kind: 'install', title: 'a', home });
  setTitle(id, 'b');
  assert.equal(get(id).title, 'b');
});
