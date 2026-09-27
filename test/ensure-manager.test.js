import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureManagerInProfile, checkManagerInProfile } from '../src/ensure-manager.js';

const MANAGER = '@dsh-packforge/dsh-pack-plugin';

/** 搭一个带「激活 profile（desktop）已装管理器（自包含 bundle）」的最小 home 夹具。 */
async function buildFixture() {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-pack-mgr-'));
  const profilesDir = path.join(home, 'profiles');
  const src = path.join(profilesDir, 'desktop');
  const mgrDir = path.join(src, 'node_modules', ...MANAGER.split('/'));
  await fsp.mkdir(mgrDir, { recursive: true });
  await fsp.writeFile(path.join(mgrDir, 'package.json'), JSON.stringify({ name: MANAGER, version: '0.1.0' }));
  await fsp.writeFile(path.join(src, 'package.json'), JSON.stringify({
    name: 'dsh-profile-desktop',
    dependencies: { [MANAGER]: '^0.1.0' },
    dsh: { profile: { bundles: [MANAGER] } },
  }, null, 2));
  return { home, runtime: { profilesDir } };
}

async function writeMinimalTarget(profilesDir, name) {
  const dir = path.join(profilesDir, name);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'package.json'), JSON.stringify({
    name: `dsh-profile-${name}`, private: true, dependencies: {}, dsh: { profile: { bundles: [] } },
  }, null, 2));
  return dir;
}

test('ensureManagerInProfile：迁装管理器本体并登记进 package.json（幂等）', async () => {
  const { home, runtime } = await buildFixture();
  try {
    const dir = await writeMinimalTarget(runtime.profilesDir, 'newpack');

    const r = await ensureManagerInProfile(runtime, 'newpack');
    assert.equal(r.installed, true);

    const pkg = JSON.parse(await fsp.readFile(path.join(dir, 'package.json'), 'utf8'));
    assert.equal(pkg.dependencies[MANAGER], '^0.1.0');
    assert.ok(pkg.dsh.profile.bundles.includes(MANAGER));

    const exists = (p) => fsp.stat(p).then(() => true, () => false);
    assert.ok(await exists(path.join(dir, 'node_modules', ...MANAGER.split('/'), 'package.json')));
    assert.equal(await checkManagerInProfile(runtime, 'newpack'), true);

    // 幂等：已装则不再重复迁装
    assert.equal((await ensureManagerInProfile(runtime, 'newpack')).installed, false);
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});

test('ensureManagerInProfile：来源 profile 无管理器 → 抛错', async () => {
  const { home, runtime } = await buildFixture();
  try {
    await fsp.rm(path.join(runtime.profilesDir, 'desktop', 'node_modules', ...MANAGER.split('/')), { recursive: true, force: true });
    await writeMinimalTarget(runtime.profilesDir, 'newpack');
    await assert.rejects(() => ensureManagerInProfile(runtime, 'newpack'), /没有 @dsh-packforge/);
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});
