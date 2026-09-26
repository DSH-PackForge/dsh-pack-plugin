import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import { ENDPOINTS } from '../src/endpoints.js';
import { getHost, setHost } from '../src/host.js';

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
