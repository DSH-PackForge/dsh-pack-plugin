// 打包端 r3 能力测试：codeload 原件取件 / 上游探测三态 / 离线可装性自检。
import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildTarball } from '../src/core/tar.js';
import {
  codeloadUrl, fetchCodeloadTarball, probeNpmUpstream, coverageOfVendored, collectVendoredForExport,
} from '../src/core/vendored.js';

const dec = (s) => new TextEncoder().encode(s);
const SHA = 'a2c7df00b27c2de9f2b0915d3bd5f1acc4d02c68';
const GIT_COORD = 'github:o/other-theme';

/** codeload 形态归档（顶层 `<repo>-<sha>/`）。 */
function codeloadTarball(version) {
  return buildTarball({
    [`other-theme-${SHA}/package.json`]: JSON.stringify({ name: 'other-theme', version, main: 'index.js' }),
    [`other-theme-${SHA}/index.js`]: 'export const t = 1;\n',
  });
}

/** 最小 Host 替身：文件系统 + 可编排的 download。 */
function makeHost({ routes = {}, write = {} } = {}) {
  const calls = { download: [] };
  return {
    calls,
    joinPath: (...p) => path.join(...p),
    resolvePath: (...p) => path.resolve(...p),
    async readTextFile(p) { try { return await fsp.readFile(p, 'utf8'); } catch { return null; } },
    async writeTextFile(p, t) { await fsp.mkdir(path.dirname(p), { recursive: true }); await fsp.writeFile(p, t, 'utf8'); },
    async readFile(p) { try { return new Uint8Array(await fsp.readFile(p)); } catch { return null; } },
    async writeFile(p, d) { await fsp.mkdir(path.dirname(p), { recursive: true }); await fsp.writeFile(p, d); },
    async stat(p) { try { const s = await fsp.stat(p); return { size: s.size, isFile: s.isFile(), isDirectory: s.isDirectory() }; } catch { return null; } },
    async readdir(p) {
      try {
        const es = await fsp.readdir(p, { withFileTypes: true });
        return es.map((e) => ({ name: e.name, abs: path.join(p, e.name), type: e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other' }));
      } catch { return null; }
    },
    async mkdir(p) { await fsp.mkdir(p, { recursive: true }); },
    async rm(p, o = {}) { await fsp.rm(p, { recursive: o.recursive !== false, force: true }); },
    async mkdtemp(prefix) { return await fsp.mkdtemp(path.join(os.tmpdir(), prefix)); },
    async sha256(d) { return crypto.createHash('sha256').update(d).digest('hex'); },
    async sha512(d) { return crypto.createHash('sha512').update(d).digest('base64'); },
    async download(url, dest) {
      calls.download.push(url);
      for (const [needle, payload] of Object.entries(routes)) {
        if (url.includes(needle)) {
          if (payload instanceof Error) throw payload;
          await fsp.mkdir(path.dirname(dest), { recursive: true });
          await fsp.writeFile(dest, payload);
          return;
        }
      }
      void write;
      throw new Error('404 Not Found');
    },
  };
}

test('codeloadUrl / fetchCodeloadTarball：抓到原件就原样返回；未钉 sha 不联网', async () => {
  const tgz = codeloadTarball('1.2.3');
  const host = makeHost({ routes: { 'codeload.github.com': tgz } });

  assert.equal(codeloadUrl('o', 'other-theme', SHA), `https://codeload.github.com/o/other-theme/tar.gz/${SHA}`);
  const bytes = await fetchCodeloadTarball(host, GIT_COORD, SHA);
  assert.equal(bytes.length, tgz.length);
  assert.equal(host.calls.download[0], codeloadUrl('o', 'other-theme', SHA));

  const logs = [];
  const unpinned = await fetchCodeloadTarball(host, GIT_COORD, 'latest', (s) => logs.push(s));
  assert.equal(unpinned, null);
  assert.equal(host.calls.download.length, 1, '未钉 sha 不应发起下载');
  assert.match(logs.join('\n'), /未钉死 commit sha/);
});

test('fetchCodeloadTarball：取不到返回 null（由调用方回落重打包）', async () => {
  const host = makeHost({ routes: { 'codeload.github.com': new Error('ETIMEDOUT') } });
  const logs = [];
  assert.equal(await fetchCodeloadTarball(host, GIT_COORD, SHA, (s) => logs.push(s)), null);
  assert.match(logs.join('\n'), /codeload 原件取件失败/);
});

test('probeNpmUpstream：三态——200 元数据=exists / 404=missing / 其它=unknown', async () => {
  const meta = dec(JSON.stringify({ name: 'dsh-pet', version: '0.2.0' }));
  assert.equal(await probeNpmUpstream(makeHost({ routes: { registry: meta } }), 'dsh-pet', '0.2.0'), 'exists');
  assert.equal(await probeNpmUpstream(makeHost({ routes: { registry: new Error('404 Not Found') } }), 'dsh-pet', '0.2.0'), 'missing');
  const logs = [];
  assert.equal(await probeNpmUpstream(makeHost({ routes: { registry: new Error('ETIMEDOUT') } }), 'dsh-pet', '0.2.0', undefined, (s) => logs.push(s)), 'unknown');
  assert.match(logs.join('\n'), /保守内嵌/);
});

test('collectVendoredForExport：git 坐标优先内嵌 codeload 原件（版本取自归档，不记 reason）', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-codeload-export-'));
  try {
    const dir = path.join(home, 'profiles', 'demo');
    await fsp.mkdir(path.join(dir, 'node_modules', 'other-theme'), { recursive: true });
    await fsp.writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-demo', dependencies: { 'other-theme': `github:o/other-theme#${SHA}` },
    }));
    // node_modules 里放一份「本地版本」，用来证明没走重打包（原件版本 1.2.3 ≠ 本地 9.9.9）
    await fsp.writeFile(path.join(dir, 'node_modules', 'other-theme', 'package.json'), JSON.stringify({ name: 'other-theme', version: '9.9.9' }));

    const tgz = codeloadTarball('1.2.3');
    const host = makeHost({ routes: { 'codeload.github.com': tgz } });
    const r = await collectVendoredForExport(host, [dir], { [GIT_COORD]: SHA }, { [GIT_COORD]: undefined }, { log: () => {} });

    assert.deepEqual(Object.keys(r.dependencies), ['vendor:other-theme']);
    assert.equal(r.dependencies['vendor:other-theme'], '1.2.3', '版本取自原件归档（不是本地重打包的 9.9.9-local.N）');
    const entry = r.vendored['vendor:other-theme'];
    assert.equal(entry.version, '1.2.3');
    assert.equal(entry.reason, undefined, '原件与上游一致 → 不记 reason');
    assert.equal(r.entries[entry.path].length, tgz.length, '嵌入的正是原件字节');
    assert.match(r.notes.join('\n'), /codeload 原件/);
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});

test('coverageOfVendored：闭包收齐=complete；漏传递依赖=missing；认 git/file: 版本段', () => {
  const tgz = buildTarball({ 'package/package.json': '{"name":"dsh-pet","version":"0.2.0"}' });
  const entries = { 'vendor/npm__dsh-pet/dsh-pet-0.2.0.tgz': tgz };
  const vendored = { 'vendor:dsh-pet': { version: '0.2.0', sha256: 'a'.repeat(64), size: tgz.length, path: 'vendor/npm__dsh-pet/dsh-pet-0.2.0.tgz' } };
  const lock = (keys) => `lockfileVersion: '9.0'\n\npackages:\n\n${keys.map((k) => `  '${k}':\n    resolution: {integrity: sha512-x}\n`).join('\n')}`;

  const ok = coverageOfVendored(vendored, entries, lock(['dsh-pet@0.2.0']));
  assert.equal(ok.complete, true);
  assert.equal(ok.total, 1);

  const partial = coverageOfVendored(vendored, entries, lock(['dsh-pet@0.2.0', 'fflate@0.8.2']));
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.missing, ['fflate@0.8.2']);

  // 版本不符不算覆盖（同名不同版本）
  assert.deepEqual(coverageOfVendored(vendored, entries, lock(['dsh-pet@0.3.0'])).missing, ['dsh-pet@0.3.0']);
  // git / file: 版本段按包名命中
  assert.equal(coverageOfVendored(vendored, entries, lock(['dsh-pet@github:o/r#abc'])).complete, true);

  assert.equal(coverageOfVendored(vendored, entries, null), null, '无 lockfile → 无法判定');
  assert.equal(coverageOfVendored({}, entries, lock(['dsh-pet@0.2.0'])), null, '无内嵌条目 → 无法判定');
});
