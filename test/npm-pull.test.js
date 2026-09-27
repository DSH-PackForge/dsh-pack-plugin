import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'fflate';
import { untar } from '../src/core/tar.js';
import { ensureManagerInProfile } from '../src/ensure-manager.js';
import { setHost } from '../src/host.js';

const MANAGER = '@dsh-packforge/dsh-pack-plugin';

/** 造一个最小 ustar 文件条目（header + 数据 + 512 对齐）。untar 不校验 magic/checksum。 */
function tarFile(name, text) {
  const header = new Uint8Array(512);
  header.set(new TextEncoder().encode(name), 0);
  const size = new TextEncoder().encode(text).length;
  header.set(new TextEncoder().encode(`${size.toString(8).padStart(11, '0')}\0`), 124);
  header[156] = 0x30; // typeflag '0'
  const data = new TextEncoder().encode(text);
  const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
  padded.set(data);
  const out = new Uint8Array(512 + padded.length);
  out.set(header, 0);
  out.set(padded, 512);
  return out;
}

/** 拼一个 gzip+tar（末尾两个零块）。 */
function buildTarball(files) {
  const parts = Object.entries(files).map(([n, c]) => tarFile(n, c));
  const end = new Uint8Array(1024);
  const total = parts.reduce((s, p) => s + p.length, 0) + end.length;
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { buf.set(p, off); off += p.length; }
  buf.set(end, off);
  return gzipSync(buf);
}

test('untar：解出 package/ 下文件', () => {
  const tgz = buildTarball({
    'package/package.json': '{"name":"x"}',
    'package/src/index.js': 'export {}',
  });
  const out = untar(tgz);
  assert.equal(new TextDecoder().decode(out['package/package.json']), '{"name":"x"}');
  assert.equal(new TextDecoder().decode(out['package/src/index.js']), 'export {}');
});

test('ensureManagerInProfile source=npm：从 registry 拉最新，登记 ^version（自包含，不碰来源）', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-pack-npm-'));
  const profilesDir = path.join(home, 'profiles');
  try {
    // 来源（desktop）：npm 路径自包含，完全不读来源 profile，给个最小目录即可。
    const src = path.join(profilesDir, 'desktop');
    await fsp.mkdir(src, { recursive: true });
    await fsp.writeFile(path.join(src, 'package.json'), JSON.stringify({ name: 'dsh-profile-desktop', dependencies: {}, dsh: { profile: { bundles: [MANAGER] } } }, null, 2));
    // 目标：缺管理器的最小 profile。
    const target = path.join(profilesDir, 'newpack');
    await fsp.mkdir(target, { recursive: true });
    await fsp.writeFile(path.join(target, 'package.json'), JSON.stringify({ name: 'dsh-profile-newpack', private: true, dependencies: {}, dsh: { profile: { bundles: [] } } }, null, 2));

    const tarball = buildTarball({
      'package/package.json': JSON.stringify({ name: MANAGER, version: '9.9.9' }),
      'package/src/index.js': 'export const x = 1;',
    });

    setHost({
      async download(url, dest) {
        if (url.endsWith('/latest')) {
          await fsp.writeFile(dest, JSON.stringify({ version: '9.9.9', dist: { tarball: 'https://registry.npmjs.org/@dsh-packforge/dsh-pack-plugin/-/dsh-pack-plugin-9.9.9.tgz' } }));
        } else {
          await fsp.writeFile(dest, tarball);
        }
      },
      async readTextFile(p) { return await fsp.readFile(p, 'utf8'); },
      async readFile(p) { return new Uint8Array(await fsp.readFile(p)); },
    });

    const r = await ensureManagerInProfile({ profilesDir }, 'newpack', { source: 'npm' });
    assert.equal(r.installed, true);
    assert.equal(r.spec, '^9.9.9');
    assert.equal(r.source, 'npm');

    const pkg = JSON.parse(await fsp.readFile(path.join(target, 'package.json'), 'utf8'));
    assert.equal(pkg.dependencies[MANAGER], '^9.9.9');
    assert.ok(pkg.dsh.profile.bundles.includes(MANAGER));

    const mgrPkg = JSON.parse(await fsp.readFile(path.join(target, 'node_modules', ...MANAGER.split('/'), 'package.json'), 'utf8'));
    assert.equal(mgrPkg.version, '9.9.9');
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});

test('ensureManagerInProfile source=npm：拉取最新失败 → 次之回退复制', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-pack-npm-fb-'));
  const profilesDir = path.join(home, 'profiles');
  try {
    // 来源（desktop）：装上管理器（copy 回退的来源，自包含 bundle）。
    const src = path.join(profilesDir, 'desktop');
    const mgrDir = path.join(src, 'node_modules', ...MANAGER.split('/'));
    await fsp.mkdir(mgrDir, { recursive: true });
    await fsp.writeFile(path.join(mgrDir, 'package.json'), JSON.stringify({ name: MANAGER, version: '0.1.0' }));
    await fsp.writeFile(path.join(src, 'package.json'), JSON.stringify({ name: 'dsh-profile-desktop', dependencies: { [MANAGER]: '^0.1.0' }, dsh: { profile: { bundles: [MANAGER] } } }, null, 2));
    // 目标：缺管理器的最小 profile。
    const target = path.join(profilesDir, 'newpack');
    await fsp.mkdir(target, { recursive: true });
    await fsp.writeFile(path.join(target, 'package.json'), JSON.stringify({ name: 'dsh-profile-newpack', private: true, dependencies: {}, dsh: { profile: { bundles: [] } } }, null, 2));

    // npm 拉取直接失败（未发布 / 网络不通）。
    setHost({
      async download() { throw new Error('registry unreachable'); },
      async readTextFile(p) { return await fsp.readFile(p, 'utf8'); },
      async readFile(p) { return new Uint8Array(await fsp.readFile(p)); },
    });

    const r = await ensureManagerInProfile({ profilesDir }, 'newpack', { source: 'npm' });
    assert.equal(r.installed, true);
    assert.equal(r.source, 'copy');
    assert.equal(r.spec, '^0.1.0');

    const pkg = JSON.parse(await fsp.readFile(path.join(target, 'package.json'), 'utf8'));
    assert.equal(pkg.dependencies[MANAGER], '^0.1.0');
    const mgrPkg = JSON.parse(await fsp.readFile(path.join(target, 'node_modules', ...MANAGER.split('/'), 'package.json'), 'utf8'));
    assert.equal(mgrPkg.version, '0.1.0');
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});
