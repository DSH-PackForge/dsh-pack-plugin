import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ENDPOINTS } from '../src/endpoints.js';
import { getHost, setHost } from '../src/host.js';
import { enqueue } from '../src/tasks.js';

const require = createRequire(import.meta.url);
const VERSION = require('../package.json').version;
const MANAGER = '@dsh-packforge/dsh-pack-plugin';

test('plugin/check-update：有更新 → outdated=true', async () => {
  const real = getHost();
  try {
    setHost({
      async download(url, dest) { await fsp.writeFile(dest, JSON.stringify({ version: '9.9.9' })); },
      async readTextFile(p) { return await fsp.readFile(p, 'utf8'); },
    });
    const r = await ENDPOINTS['plugin/check-update']({});
    assert.equal(r.current, VERSION);
    assert.equal(r.latest, '9.9.9');
    assert.equal(r.outdated, true);
    assert.equal(r.npmUrl, `https://www.npmjs.com/package/${MANAGER}`);
  } finally {
    setHost(real);
  }
});

test('plugin/check-update：已是最新 → outdated=false', async () => {
  const real = getHost();
  try {
    setHost({
      async download(url, dest) { await fsp.writeFile(dest, JSON.stringify({ version: VERSION })); },
      async readTextFile(p) { return await fsp.readFile(p, 'utf8'); },
    });
    const r = await ENDPOINTS['plugin/check-update']({});
    assert.equal(r.latest, VERSION);
    assert.equal(r.outdated, false);
  } finally {
    setHost(real);
  }
});

test('plugin/check-update：包未发布 → 抛错', async () => {
  const real = getHost();
  try {
    setHost({
      async download(url, dest) { await fsp.writeFile(dest, JSON.stringify({})); },
      async readTextFile(p) { return await fsp.readFile(p, 'utf8'); },
    });
    await assert.rejects(() => ENDPOINTS['plugin/check-update']({}), /尚未发布/);
  } finally {
    setHost(real);
  }
});

test('plugin/open-url：仅 http/https，且交给系统打开', async () => {
  const real = getHost();
  try {
    let opened = null;
    setHost({
      async exec(cmd, args) { opened = { cmd, args }; return {}; },
    });
    await assert.rejects(
      () => ENDPOINTS['plugin/open-url']({ payload: { url: 'file:///etc/passwd' } }),
      /仅支持 http\/https/,
    );
    const r = await ENDPOINTS['plugin/open-url']({ payload: { url: 'https://github.com/x/y' } });
    assert.equal(r.opened, true);
    assert.deepEqual(opened.args, ['https://github.com/x/y']);
  } finally {
    setHost(real);
  }
});

test('profile/create：新 profile 写入官方基线 bundle（base + web-app）+ 管理器', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-create-'));
  const profilesDir = path.join(home, 'profiles');
  try {
    // 搭「激活 profile（desktop）已装管理器 + fflate」夹具，供 ensureManagerInProfile 的 copy 来源。
    const src = path.join(profilesDir, 'desktop');
    const mgrDir = path.join(src, 'node_modules', ...MANAGER.split('/'));
    await fsp.mkdir(mgrDir, { recursive: true });
    await fsp.writeFile(path.join(mgrDir, 'package.json'), JSON.stringify({ name: MANAGER, version: '0.1.0' }));
    await fsp.mkdir(path.join(src, 'node_modules', 'fflate'), { recursive: true });
    await fsp.writeFile(path.join(src, 'node_modules', 'fflate', 'package.json'), JSON.stringify({ name: 'fflate', version: '0.8.2' }));
    await fsp.writeFile(path.join(src, 'package.json'), JSON.stringify({
      name: 'dsh-profile-desktop',
      dependencies: { [MANAGER]: '^0.1.0' },
      dsh: { profile: { bundles: [MANAGER] } },
    }, null, 2));

    const runtime = { home, profilesDir };
    const r = await ENDPOINTS['profile/create']({ runtime, payload: { name: 'newpack' } });
    assert.ok(r.taskId);

    // 串行队列：压一个 no-op 兜底，等上面的创建任务先跑完再断言落盘结果。
    await enqueue(async () => {});

    const pkg = JSON.parse(await fsp.readFile(path.join(profilesDir, 'newpack', 'package.json'), 'utf8'));
    assert.deepEqual(pkg.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', MANAGER]);
    assert.equal(pkg.dependencies[MANAGER], '^0.1.0');
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});
