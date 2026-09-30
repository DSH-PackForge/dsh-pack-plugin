// git 坐标内嵌的 tarball 布局兼容测试（v5 §8.1：git 原件 = codeload 归档，顶层 `<repo>-<sha>/`）。
//
// 为什么要单独钉住：阶段 0 会读 tarball 内 package.json 核对 name/version（§11.1.4、§12 约束 4）。
// 早先只认 npm 布局 `package/package.json`，于是**换成 codeload 原件后，自家 git 内嵌条目会被
// 全部判成「package.json 缺失」而拒装**——这条用例就是那个回归。
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildTarball } from '../src/core/tar.js';
import { resolveVendoredPlan } from '../src/core/vendored.js';

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const host = { sha256: async (b) => sha256(b) };
const dec = (s) => new TextEncoder().encode(s);

const base = (extra) => ({
  manifestVersion: 5, type: 'profile', name: 'demo', version: '1.0.0', profileName: 'demo', bundles: [], ...extra,
});

/** codeload 形态归档：顶层 `<repo>-<sha>/`（不是 npm 的 `package/`）。 */
function codeloadTarball(repo, sha, files) {
  const root = `${repo}-${sha}`;
  return buildTarball(Object.fromEntries(Object.entries(files).map(([k, v]) => [`${root}/${k}`, v])));
}

const SHA = 'a2c7df00b27c2de9f2b0915d3bd5f1acc4d02c68';

test('阶段 0：codeload 布局（git 原件）也能核对 name/version', async () => {
  const tgz = codeloadTarball('dsh-pet', SHA, {
    'package.json': JSON.stringify({ name: 'dsh-pet', version: '0.2.0' }),
    'index.js': 'module.exports = 1;\n',
  });
  const manifest = base({
    dependencies: { 'vendor:dsh-pet': '0.2.0' },
    vendored: { 'vendor:dsh-pet': { version: '0.2.0', sha256: sha256(tgz), size: tgz.length, path: 'vendor/g/dsh-pet.tgz', reason: 'local-modified' } },
  });
  const plan = await resolveVendoredPlan(host, manifest, { 'vendor/g/dsh-pet.tgz': tgz });
  assert.equal(plan.active, true);
  assert.equal(plan.byCoord.get('vendor:dsh-pet').pkgName, 'dsh-pet');
});

test('阶段 0：codeload 布局 + 子目录 git 坐标（lockfile 里 &path:）下探一层核对', async () => {
  const tgz = codeloadTarball('mono', SHA, {
    'package.json': JSON.stringify({ name: 'mono-root', version: '9.9.9' }), // 仓库根 ≠ 子包
    'packages/sub/package.json': JSON.stringify({ name: 'sub-pkg', version: '1.2.3' }),
  });
  const lock = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      sub-pkg:
        specifier: github:o/mono#${SHA}&path:packages/sub
        version: https://codeload.github.com/o/mono/tar.gz/${SHA}

packages:

  sub-pkg@https://codeload.github.com/o/mono/tar.gz/${SHA}:
    resolution: {gitHosted: true, integrity: sha512-x, tarball: https://codeload.github.com/o/mono/tar.gz/${SHA}}
    version: 1.2.3

snapshots:

  sub-pkg@https://codeload.github.com/o/mono/tar.gz/${SHA}: {}
`;
  const manifest = base({
    dependencies: { 'vendor:sub-pkg': '1.2.3' },
    vendored: { 'vendor:sub-pkg': { version: '1.2.3', sha256: sha256(tgz), size: tgz.length, path: 'vendor/g/sub.tgz', reason: 'local-modified' } },
  });
  const plan = await resolveVendoredPlan(host, manifest, { 'vendor/g/sub.tgz': tgz, 'pnpm-lock.yaml': dec(lock) });
  assert.equal(plan.byCoord.get('vendor:sub-pkg').pkgName, 'sub-pkg');
});

test('阶段 0：codeload 布局但包名/版本与声明不符 → 仍然拒装', async () => {
  const tgz = codeloadTarball('dsh-pet', SHA, { 'package.json': JSON.stringify({ name: 'someone-else', version: '0.2.0' }) });
  const manifest = base({
    dependencies: { 'vendor:dsh-pet': '0.2.0' },
    vendored: { 'vendor:dsh-pet': { version: '0.2.0', sha256: sha256(tgz), size: tgz.length, path: 'vendor/g/x.tgz' } },
  });
  await assert.rejects(
    () => resolveVendoredPlan(host, manifest, { 'vendor/g/x.tgz': tgz }),
    /包名.*与键不符/,
  );

  const tgz2 = codeloadTarball('dsh-pet', SHA, { 'package.json': JSON.stringify({ name: 'dsh-pet', version: '9.9.9' }) });
  const manifest2 = base({
    dependencies: { 'vendor:dsh-pet': '0.2.0' },
    vendored: { 'vendor:dsh-pet': { version: '0.2.0', sha256: sha256(tgz2), size: tgz2.length, path: 'vendor/g/y.tgz' } },
  });
  await assert.rejects(
    () => resolveVendoredPlan(host, manifest2, { 'vendor/g/y.tgz': tgz2 }),
    /版本.*不一致/,
  );
});

test('阶段 0：没有任何 package.json 的 tarball → 拒装（布局兼容不等于放宽）', async () => {
  const tgz = buildTarball({ 'index.js': 'module.exports = 1;\n' });
  const manifest = base({
    dependencies: { 'vendor:dsh-pet': '0.2.0' },
    vendored: { 'vendor:dsh-pet': { version: '0.2.0', sha256: sha256(tgz), size: tgz.length, path: 'vendor/g/z.tgz' } },
  });
  await assert.rejects(
    () => resolveVendoredPlan(host, manifest, { 'vendor/g/z.tgz': tgz }),
    /package\.json 缺失/,
  );
});
