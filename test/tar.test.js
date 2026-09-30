// tar（ustar）工具测试：`untar` 仍是运行时依赖（ensure-manager / 迁移辅助都会用它解 npm tarball）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTarball, untar } from '../src/core/tar.js';

test('buildTarball/untar：互逆 round-trip（含 ustar 头）', () => {
  const tgz = buildTarball({
    'package/package.json': '{"name":"x","version":"1.0.0"}',
    'package/src/index.js': 'export const x = 1;',
  });
  const out = untar(tgz);
  assert.equal(new TextDecoder().decode(out['package/package.json']), '{"name":"x","version":"1.0.0"}');
  assert.equal(new TextDecoder().decode(out['package/src/index.js']), 'export const x = 1;');
});

test('untar：嵌套路径原样保留，目录条目不入结果', () => {
  const tgz = buildTarball({
    'package/a/b/c.txt': 'deep',
    'package/empty.txt': '',
  });
  const out = untar(tgz);
  assert.equal(new TextDecoder().decode(out['package/a/b/c.txt']), 'deep');
  assert.ok(!Object.keys(out).some((k) => k.endsWith('/')), '目录条目不应出现在结果里');
  const empty = out['package/empty.txt'];
  assert.ok(empty === undefined || empty.length === 0, '空文件要么不入结果、要么长度为 0');
});
