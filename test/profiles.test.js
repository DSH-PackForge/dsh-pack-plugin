import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deleteProfile } from '../src/profiles.js';

const exists = (p) => fsp.stat(p).then(() => true, () => false);

/** 搭一个带 profile 目录 + skills/.agent-presets 换指 slot 的最小 home。 */
async function buildHome(name) {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-pack-del-'));
  await fsp.mkdir(path.join(home, 'profiles', name), { recursive: true });
  await fsp.writeFile(path.join(home, 'profiles', name, 'package.json'), '{}');
  await fsp.mkdir(path.join(home, '.dsh-pack', 'skills', name), { recursive: true });
  await fsp.writeFile(path.join(home, '.dsh-pack', 'skills', name, 'foo.md'), 'x');
  await fsp.mkdir(path.join(home, '.dsh-pack', 'agent-presets', name, 'bar'), { recursive: true });
  await fsp.writeFile(path.join(home, '.dsh-pack', 'agent-presets', name, 'bar', 'agent.cordis.yml'), 'y');
  return home;
}

test('deleteProfile：连同 skills/.agent-presets 换指 slot 一起清除', async () => {
  const home = await buildHome('mypack');
  try {
    await deleteProfile(home, 'mypack');

    assert.equal(await exists(path.join(home, 'profiles', 'mypack')), false);
    assert.equal(await exists(path.join(home, '.dsh-pack', 'skills', 'mypack')), false);
    assert.equal(await exists(path.join(home, '.dsh-pack', 'agent-presets', 'mypack')), false);
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});

test('deleteProfile：保留名 desktop / default 拒绝删除', async () => {
  const home = await buildHome('mypack');
  try {
    await assert.rejects(() => deleteProfile(home, 'desktop'), /不能删除/);
    await assert.rejects(() => deleteProfile(home, 'default'), /不能删除/);
    // 其它 profile 的 slot 不受影响
    assert.equal(await exists(path.join(home, '.dsh-pack', 'skills', 'mypack')), true);
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});
