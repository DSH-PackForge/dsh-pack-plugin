// resolvePackSource 输入归一化测试：
// - Windows「复制路径」会把路径套一对双引号；不剥掉会被 path.resolve 当成相对路径
//   拼到 cwd 后面 → 「找不到整合包文件：cwd\"C:\…\x.dspack"」。
// - 单引号、首尾空白同理；URL 剥引号后仍走下载分支。
import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolvePackSource } from '../src/core/install.js';

/** 基于 node:fs 的 Host 替身（风格同 launchers.test.js 的 fsHost）。 */
function fsHost(extra = {}) {
  return {
    joinPath: (...p) => path.join(...p),
    resolvePath: (...p) => path.resolve(...p),
    async stat(p) {
      try {
        const s = await fsp.stat(p);
        return { size: s.size, isFile: s.isFile(), isDirectory: s.isDirectory() };
      } catch {
        return null;
      }
    },
    async mkdtemp(prefix) { return await fsp.mkdtemp(path.join(os.tmpdir(), prefix)); },
    async download() {},
    ...extra,
  };
}

test('resolvePackSource：双引号包裹的绝对路径 → 剥引号后正确解析（不拼 cwd）', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-src-'));
  const pack = path.join(dir, 'demo pack.dspack');
  await fsp.writeFile(pack, 'x');
  try {
    const { path: resolved, tempDir } = await resolvePackSource(fsHost(), `"${pack}"`);
    assert.equal(resolved, pack);
    assert.equal(tempDir, null);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('resolvePackSource：首尾空白 + 单引号包裹 → 同样归一化', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-src-'));
  const pack = path.join(dir, 'demo.dspack');
  await fsp.writeFile(pack, 'x');
  try {
    const { path: resolved } = await resolvePackSource(fsHost(), `  '${pack}'  `);
    assert.equal(resolved, pack);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('resolvePackSource：缺失文件 → 抛「找不到整合包文件」且路径不含引号', async () => {
  const host = fsHost();
  await assert.rejects(
    () => resolvePackSource(host, '"C:\\nope\\missing.dspack"'),
    /找不到整合包文件/,
  );
  // 错误信息里的路径应已剥掉引号（不再出现 cwd + 引号拼接）。
  try {
    await resolvePackSource(host, '"C:\\nope\\missing.dspack"');
  } catch (error) {
    assert.ok(!error.message.includes('"'), `错误信息仍含引号：${error.message}`);
  }
});

test('resolvePackSource：URL 带引号 → 剥引号后走下载分支', async () => {
  let downloadedUrl;
  let wroteDest;
  const host = fsHost({
    async download(url, dest) {
      downloadedUrl = url;
      wroteDest = dest;
    },
  });
  const { path: dest, tempDir } = await resolvePackSource(host, '"https://example.com/x.dspack"');
  assert.equal(downloadedUrl, 'https://example.com/x.dspack');
  assert.equal(dest, wroteDest);
  assert.ok(tempDir);
});
