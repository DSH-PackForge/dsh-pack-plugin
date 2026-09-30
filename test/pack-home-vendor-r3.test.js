// dshhome（packHome）内嵌路径的 r3 测试。
//
// 为什么单开一个文件：这条路径此前**没有任何测试**，于是 pack.js 里的 dshhome 分支一直停在 r2 键
// （用坐标查 vendored / dependencies），r3 换成 `vendor:<包名>` 后直接查不到 → 打包前强校验必失败。
// 这里把它钉住，并覆盖我承诺的「同一包名两个来源 → 拒绝导出」。
import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { packHome } from '../src/core/pack.js';
import { validateManifest } from '../src/core/manifest.js';

/** node:fs 支撑的 Host 替身（core 是 DI 边界）。 */
function fsHost() {
  return {
    joinPath: (...p) => path.join(...p),
    resolvePath: (...p) => path.resolve(...p),
    homedir: () => os.homedir(),
    cwd: () => process.cwd(),
    async readTextFile(p) { try { return await fsp.readFile(p, 'utf8'); } catch { return null; } },
    async writeTextFile(p, t) { await fsp.mkdir(path.dirname(p), { recursive: true }); await fsp.writeFile(p, t, 'utf8'); },
    async readFile(p) { try { return new Uint8Array(await fsp.readFile(p)); } catch { return null; } },
    async writeFile(p, d) { await fsp.mkdir(path.dirname(p), { recursive: true }); await fsp.writeFile(p, d); },
    async stat(p) {
      try {
        const s = await fsp.stat(p);
        return { size: s.size, isFile: s.isFile(), isDirectory: s.isDirectory(), isSymbolicLink: s.isSymbolicLink() };
      } catch { return null; }
    },
    async readdir(p) {
      try {
        const es = await fsp.readdir(p, { withFileTypes: true });
        return es.map((e) => ({
          name: e.name,
          abs: path.join(p, e.name),
          type: e.isSymbolicLink() ? 'symlink' : e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other',
        }));
      } catch { return null; }
    },
    async mkdir(p) { await fsp.mkdir(p, { recursive: true }); },
    async rm(p, o = {}) { await fsp.rm(p, { recursive: o.recursive !== false, force: true }); },
    async mkdtemp(prefix) { return await fsp.mkdtemp(path.join(os.tmpdir(), prefix)); },
    async sha256(data) { const c = await import('node:crypto'); return c.createHash('sha256').update(data).digest('hex'); },
    async sha512(data) { const c = await import('node:crypto'); return c.createHash('sha512').update(data).digest('base64'); },
    async move(from, to) { await fsp.mkdir(path.dirname(to), { recursive: true }); await fsp.rename(from, to); },
  };
}

/** 建一个 profile：package.json 依赖 + 已安装的 node_modules/<pkg>。 */
async function writeProfile(home, name, deps, installed) {
  const dir = path.join(home, 'profiles', name);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'package.json'), JSON.stringify({
    name: `dsh-profile-${name}`, private: true, dependencies: deps,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
  }, null, 2));
  for (const [pkg, version] of Object.entries(installed)) {
    const pdir = path.join(dir, 'node_modules', pkg);
    await fsp.mkdir(pdir, { recursive: true });
    await fsp.writeFile(path.join(pdir, 'package.json'), JSON.stringify({ name: pkg, version, main: 'index.js' }));
    await fsp.writeFile(path.join(pdir, 'index.js'), 'export const x = 1;\n');
  }
  return dir;
}

const LOCK = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: false

importers:

  .:
    dependencies:
      dsh-pet:
        specifier: 0.2.0
        version: 0.2.0

packages:

  dsh-pet@0.2.0:
    resolution: {integrity: sha512-AAA}

snapshots:

  dsh-pet@0.2.0: {}
`;

test('packHome（dshhome）：内嵌依赖改写为 vendor:<包名>，不写顶层 dependencies', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-home-r3-'));
  try {
    await writeProfile(home, 'alpha', { 'dsh-pet': '^0.2.0' }, { 'dsh-pet': '0.2.0' });
    await fsp.writeFile(path.join(home, 'pnpm-lock.yaml'), LOCK, 'utf8');
    await fsp.writeFile(path.join(home, 'AGENTS.md'), '# fixture\n', 'utf8');

    const out = path.join(home, 'out');
    // registry 指向死端口：强制走「node_modules 重打包」这条确定性路径，不联网
    const r = await packHome(fsHost(), { name: 'home-fixture', dir: home }, {
      name: 'home-fixture', version: '1.0.0', vendor: 'full', registry: 'http://127.0.0.1:9/',
      defaultProfile: 'alpha', out, force: true,
    });

    const unit = r.manifest.profiles.alpha;
    const keys = Object.keys(unit.dependencies);
    assert.deepEqual(keys, ['vendor:dsh-pet'], `内嵌键应带前缀：${JSON.stringify(unit.dependencies)}`);
    assert.match(unit.dependencies['vendor:dsh-pet'], /^0\.2\.0/, '值 = 精确版本（重打包后可能带 -local.N）');
    assert.equal(r.manifest.dependencies, undefined, 'dshhome 形态不得写顶层 dependencies');
    assert.equal(r.manifest.vendored['vendor:dsh-pet'].version, unit.dependencies['vendor:dsh-pet'], '三处一致：dependencies 值 = vendored.version');
    assert.ok(Object.values(r.manifest.vendored).some((v) => String(v.path).startsWith('vendor/')), 'vendored[].path 应指向归档内 vendor/');
    // 打包前强校验已通过（否则 packHome 会抛）；再显式核一遍
    assert.deepEqual(validateManifest(r.manifest, { lockText: LOCK }), []);
    await assert.doesNotReject(() => fsp.stat(r.output));
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});

test('packHome（dshhome）：同一包名两个来源 → 拒绝导出（vendored 键只带包名，装不下）', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-home-conflict-'));
  try {
    await writeProfile(home, 'alpha', { 'dsh-pet': '^0.2.0' }, { 'dsh-pet': '0.2.0' });
    // 另一个 profile 用 git 坐标拿同一个包名 —— 内嵌后两者都想占 `vendor:dsh-pet`
    await writeProfile(home, 'beta', { 'dsh-pet': 'github:someone/dsh-pet#abc1234' }, { 'dsh-pet': '0.2.0' });
    await fsp.writeFile(path.join(home, 'pnpm-lock.yaml'), LOCK, 'utf8');

    await assert.rejects(
      () => packHome(fsHost(), { name: 'home-conflict', dir: home }, {
        name: 'home-conflict', version: '1.0.0', vendor: 'full', registry: 'http://127.0.0.1:9/',
        defaultProfile: 'alpha', out: path.join(home, 'out'), force: true,
      }),
      /同一包名/,
    );
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});
