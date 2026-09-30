// lockfile 本地化改写测试（v5 r3 §8.3 两支 + 闭包条目）。
//
// 夹具直接照抄真 pnpm 11.7.0 写出的形态（见 release_log）：registry 节点的键带版本且省略
// `version` 字段；git 节点的键是 codeload URL 且 `resolution` 里带 `gitHosted`。
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  integrityOf, findImporterDep, findPackageNodes,
  localizeDirectNpm, localizeDirectGit, localizeClosureNode,
} from '../src/core/lockfile.js';

const REGISTRY_LOCK = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: false
  excludeLinksFromLockfile: false

importers:

  .:
    dependencies:
      '@hellosz/dsh-pets':
        specifier: ^0.3.1
        version: 0.3.1
      dsh-pet:
        specifier: 0.2.0-local.1
        version: 0.2.0-local.1(@deepseek-ai/cordis@4.0.1)

packages:

  '@hellosz/dsh-pets@0.3.1':
    resolution: {integrity: sha512-AAA}
    engines: {node: '>=22'}

  dsh-pet@0.2.0-local.1:
    resolution: {integrity: sha512-BBB}
    engines: {node: '>=20'}

snapshots:

  '@hellosz/dsh-pets@0.3.1': {}

  dsh-pet@0.2.0-local.1:
    dependencies:
      '@deepseek-ai/cordis': 4.0.1
`;

const GIT_SHA = 'a2c7df00b27c2de9f2b0915d3bd5f1acc4d02c68';
const GIT_URL = `https://codeload.github.com/swaylq/dsh-wildmon/tar.gz/${GIT_SHA}`;
const GIT_LOCK = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: false

importers:

  .:
    dependencies:
      dsh-wildmon:
        specifier: github:swaylq/dsh-wildmon#${GIT_SHA}
        version: ${GIT_URL}

packages:

  dsh-wildmon@${GIT_URL}:
    resolution: {gitHosted: true, integrity: sha512-GGG, tarball: ${GIT_URL}}
    version: 0.1.0

snapshots:

  dsh-wildmon@${GIT_URL}: {}
`;

const BLOB = 'vendor-blobs/dsh-pet/dsh-pet-0.2.0-local.1.tgz';

test('integrityOf：产出 pnpm 用的 sha512-<base64>', () => {
  const bytes = new TextEncoder().encode('hello');
  const want = `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}`;
  assert.equal(integrityOf(bytes, crypto.createHash), want);
});

test('findImporterDep：读出 specifier / version（含 peer 后缀形态）', () => {
  const dep = findImporterDep(REGISTRY_LOCK, 'dsh-pet');
  assert.equal(dep.importer, '.');
  assert.equal(dep.specifier, '0.2.0-local.1');
  assert.equal(dep.version, '0.2.0-local.1(@deepseek-ai/cordis@4.0.1)');
  assert.equal(findImporterDep(REGISTRY_LOCK, 'no-such-dep'), null);
});

test('findPackageNodes：按包名定位（git 节点键里是 URL，只能靠包名找）', () => {
  const npm = findPackageNodes(REGISTRY_LOCK, 'dsh-pet');
  assert.equal(npm.length, 1);
  assert.equal(npm[0].key, 'dsh-pet@0.2.0-local.1');
  assert.equal(npm[0].gitHosted, false);
  assert.equal(npm[0].integrity, 'sha512-BBB');

  const git = findPackageNodes(GIT_LOCK, 'dsh-wildmon');
  assert.equal(git.length, 1);
  assert.equal(git[0].gitHosted, true);
  assert.equal(git[0].tarball, GIT_URL);
  assert.equal(git[0].version, '0.1.0');
});

test('支 A：四处同步改 file:，并补回 version 字段（键不再携带版本）', () => {
  const { text, changes } = localizeDirectNpm(REGISTRY_LOCK, {
    name: 'dsh-pet', version: '0.2.0-local.1', blobRel: BLOB, integrity: 'sha512-NEW',
  });
  const lines = text.split('\n');
  // ① importer specifier 带 ./、version 不带
  assert.ok(text.includes('        specifier: file:./vendor-blobs/dsh-pet/dsh-pet-0.2.0-local.1.tgz'));
  assert.ok(text.includes('        version: file:vendor-blobs/dsh-pet/dsh-pet-0.2.0-local.1.tgz'));
  // ② packages 键 + resolution（integrity 覆盖、tarball 指本地）
  assert.ok(text.includes('  dsh-pet@file:vendor-blobs/dsh-pet/dsh-pet-0.2.0-local.1.tgz:'));
  assert.ok(text.includes('    resolution: {integrity: sha512-NEW, tarball: file:vendor-blobs/dsh-pet/dsh-pet-0.2.0-local.1.tgz}'));
  // ④ version 字段补回，且插在 resolution 之后
  const resIdx = lines.findIndex((l) => l.includes('resolution: {integrity: sha512-NEW'));
  assert.equal(lines[resIdx + 1].trim(), 'version: 0.2.0-local.1');
  // ③ snapshots 键同步
  assert.ok(text.includes('  dsh-pet@file:vendor-blobs/dsh-pet/dsh-pet-0.2.0-local.1.tgz:'));
  assert.equal(changes.length, 6, JSON.stringify(changes));
  // 别的依赖与区块一字未动
  assert.ok(text.includes("  '@hellosz/dsh-pets@0.3.1':\n    resolution: {integrity: sha512-AAA}"));
  assert.ok(text.includes('  dsh-pet@0.2.0-local.1:') === false, '旧键应已消失');
  assert.ok(text.includes('lockfileVersion'), '头部字段保留');
});

test('支 A：节点已带 version 时不重复插入', () => {
  const withVersion = REGISTRY_LOCK.replace(
    '  dsh-pet@0.2.0-local.1:\n    resolution: {integrity: sha512-BBB}',
    '  dsh-pet@0.2.0-local.1:\n    resolution: {integrity: sha512-BBB}\n    version: 0.2.0-local.1',
  );
  const { text, changes } = localizeDirectNpm(withVersion, {
    name: 'dsh-pet', version: '0.2.0-local.1', blobRel: BLOB, integrity: 'sha512-NEW',
  });
  // importer.version 已被改写成 file:，故全文只剩节点里那一条 version 行
  assert.equal(text.split('\n').filter((l) => l.trim() === 'version: 0.2.0-local.1').length, 1);
  assert.ok(!changes.some((c) => c.endsWith('.version') && c.startsWith("packages[")));
});

test('支 B：只改 resolution.tarball，gitHosted / 键 / integrity 全不动', () => {
  const { text, changes } = localizeDirectGit(GIT_LOCK, { name: 'dsh-wildmon', blobRel: 'vendor-blobs/dsh-wildmon/dsh-wildmon.tgz' });
  assert.deepEqual(changes, [`packages['dsh-wildmon@${GIT_URL}'].resolution.tarball`]);
  assert.ok(text.includes(`  dsh-wildmon@${GIT_URL}:`), '键保持 codeload URL（改键会破坏 git 指示符）');
  assert.ok(text.includes('gitHosted: true'), 'gitHosted 保留');
  assert.ok(text.includes('integrity: sha512-GGG'), 'integrity 保留');
  assert.ok(text.includes('tarball: file:vendor-blobs/dsh-wildmon/dsh-wildmon.tgz'));
  assert.ok(text.includes(`        version: ${GIT_URL}`), 'importer 段不动');
});

test('闭包条目：只改该节点的 resolution.tarball', () => {
  const lock = `lockfileVersion: '9.0'

packages:

  esbuild@0.25.12:
    resolution: {integrity: sha512-EEE}
  other@1.0.0:
    resolution: {integrity: sha512-FFF, tarball: https://registry.npmjs.org/other/-/other-1.0.0.tgz}
`;
  const { text, changes } = localizeClosureNode(lock, { key: 'esbuild@0.25.12', blobRel: 'vendor-blobs/esbuild/esbuild-0.25.12.tgz' });
  assert.deepEqual(changes, [`packages['esbuild@0.25.12'].resolution.tarball`]);
  assert.ok(text.includes('resolution: {integrity: sha512-EEE, tarball: file:vendor-blobs/esbuild/esbuild-0.25.12.tgz}'));
  assert.ok(text.includes('tarball: https://registry.npmjs.org/other/-/other-1.0.0.tgz'), '别的节点不动');
  // 已有 tarball 的节点：就地替换而不追加第二个键（注意 again 基于原 lock，esbuild 仍无 tarball）
  const again = localizeClosureNode(lock, { key: 'other@1.0.0', blobRel: 'vendor-blobs/other/other-1.0.0.tgz' });
  assert.equal(again.text.match(/tarball:/g).length, 1, '就地替换，不会出现第二个 tarball 键');
  assert.ok(again.text.includes('resolution: {integrity: sha512-FFF, tarball: file:vendor-blobs/other/other-1.0.0.tgz}'));
  assert.ok(again.text.includes('resolution: {integrity: sha512-EEE}'), '别的节点不动');
});

test('同名多节点 → 拒装（不猜改哪个）', () => {
  // 第二个节点必须落在 packages: 区块内（追加到文件末尾会跑进 snapshots:）
  const dup = REGISTRY_LOCK.replace('\nsnapshots:', '\n  dsh-pet@0.3.0:\n    resolution: {integrity: sha512-CCC}\n\nsnapshots:');
  assert.throws(
    () => localizeDirectNpm(dup, { name: 'dsh-pet', version: '0.2.0-local.1', blobRel: BLOB, integrity: 'sha512-NEW' }),
    /命中 2 个/,
  );
  const dupGit = GIT_LOCK.replace('\nsnapshots:', '\n  dsh-wildmon@https://codeload.github.com/swaylq/dsh-wildmon/tar.gz/bbbb:\n    resolution: {gitHosted: true, integrity: sha512-HHH, tarball: https://codeload.github.com/swaylq/dsh-wildmon/tar.gz/bbbb}\n\nsnapshots:');
  assert.throws(() => localizeDirectGit(dupGit, { name: 'dsh-wildmon', blobRel: 'x.tgz' }), /命中 2 个/);
});

test('缺 importer / 缺节点 → 明确报错（不产出半成品 lockfile）', () => {
  assert.throws(() => localizeDirectNpm(REGISTRY_LOCK, { name: 'not-there', version: '1.0.0', blobRel: BLOB, integrity: 'x' }), /没有依赖/);
  assert.throws(() => localizeDirectGit(GIT_LOCK, { name: 'not-there', blobRel: 'x.tgz' }), /没有 gitHosted 节点/);
  assert.throws(() => localizeClosureNode(GIT_LOCK, { key: 'nope@1.0.0', blobRel: 'x.tgz' }), /没有节点/);
});

test('支 A：内联空节点（`key: {}`）的 snapshots 键也要改名', () => {
  // pnpm 把空节点写成内联 `{}`；块解析若要求以 ':' 结尾就会漏改它（实测踩过）
  const lock = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      fflate:
        specifier: 0.8.3
        version: 0.8.3

packages:

  'fflate@0.8.3':
    resolution: {integrity: sha512-OLD}

snapshots:

  'fflate@0.8.3': {}
`;
  const { text } = localizeDirectNpm(lock, {
    name: 'fflate', version: '0.8.3', blobRel: 'vendor-blobs/fflate/fflate-0.8.3.tgz', integrity: 'sha512-NEW',
  });
  assert.ok(text.includes("  'fflate@file:vendor-blobs/fflate/fflate-0.8.3.tgz': {}"), '内联 {} 要保留，键要改名');
  assert.ok(!text.includes("'fflate@0.8.3': {}"), '旧快照键应消失');
  assert.ok(text.includes('    version: 0.8.3'), '补回节点 version');
});

test('CRLF lockfile 保持 CRLF（不擅自换行风格）', () => {
  const crlf = REGISTRY_LOCK.replace(/\n/g, '\r\n');
  const { text } = localizeDirectNpm(crlf, { name: 'dsh-pet', version: '0.2.0-local.1', blobRel: BLOB, integrity: 'sha512-NEW' });
  assert.ok(text.includes('\r\n'));
  assert.ok(!/[^\r]\n/.test(text), '不应出现裸 LF');
});
