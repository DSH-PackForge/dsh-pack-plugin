// v5 r2 市场透传测试（manifest v5 §12/§13/§14 + index 契约 §3/§6.5）：
// - pickR2Fields：launchers / vendored / dshVersions「有什么带什么」，缺失不设键；
// - r2Badges：r2 字段 → 结构化展示徽标（需启动器 ≥ x / 冲突 / 内嵌 N 个依赖 / 兼容 DSH 版本集）；
// - normalizeMarketPack：索引条目携带 r2 字段时宽容透传 + launcherRestricted 派生标记；
// - fetchMarketPackDetail：懒加载 manifest 的 r2 字段带出；
// - endpoints pack/view：launchersWarnings 透出（warn / info / 静默三分支，与 pack/install 同参）；
// - endpoints pack/market-detail：manifest + README + r2 + badges。
import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pickR2Fields, r2Badges, normalizeMarketPack, fetchMarketPackDetail, parseLaunchersRegistry, fetchLaunchersRegistry, BUILTIN_LAUNCHERS } from '../src/core/market.js';
import { buildDspack, encodeText } from '../src/core/dspack.js';
import { ENDPOINTS } from '../src/endpoints.js';
import { getHost, setHost } from '../src/host.js';

/* ------------------- 测试工具（风格同 launchers.test.js） ------------------- */

/** 基于 node:fs 的 Host 替身（core 是 DI 边界，测试直接注入真实 fs 能力）。 */
function fsHost(extra = {}) {
  return {
    joinPath: (...p) => path.join(...p),
    resolvePath: (...p) => path.resolve(...p),
    homedir: () => os.homedir(),
    async readTextFile(p) { try { return await fsp.readFile(p, 'utf8'); } catch { return null; } },
    async readFile(p) { try { return new Uint8Array(await fsp.readFile(p)); } catch { return null; } },
    async stat(p) {
      try {
        const s = await fsp.stat(p);
        return { size: s.size, isFile: s.isFile(), isDirectory: s.isDirectory(), isSymbolicLink: s.isSymbolicLink() };
      } catch { return null; }
    },
    async rm(p, o = {}) { await fsp.rm(p, { recursive: o.recursive !== false, force: true }).catch(() => {}); },
    async mkdtemp(prefix) { return await fsp.mkdtemp(path.join(os.tmpdir(), prefix)); },
    ...extra,
  };
}

/** 最小合法 v5 profile manifest（可叠加 r2 字段）。 */
function baseManifest(extra = {}) {
  return {
    manifestVersion: 5,
    type: 'profile',
    name: 'demo',
    version: '1.0.0',
    profileName: 'demo',
    bundles: [],
    dependencies: {},
    ...extra,
  };
}

/** 打一个最小 .dspack（profile 形态），写到指定路径。 */
async function writePack(packPath, manifest) {
  const zip = buildDspack({
    'dspack.json': encodeText(JSON.stringify({ format: 'dspack', version: 3 })),
    'manifest.json': encodeText(JSON.stringify(manifest)),
  });
  await fsp.writeFile(packPath, zip);
  return packPath;
}

/* ------------------- pickR2Fields（r2 字段透传） ------------------- */

test('pickR2Fields：三个 r2 字段有什么带什么（其余字段不透传）', () => {
  const vendored = { 'dsh-pet': { version: '0.2.0', sha256: 'a'.repeat(64), size: 1, path: 'vendor/x.tgz' } };
  assert.deepEqual(
    pickR2Fields({
      name: 'demo',
      launchers: { dshl: true },
      vendored,
      dshVersions: ['0.1.1-rc.2', '0.1.0'],
    }),
    { launchers: { dshl: true }, vendored, dshVersions: ['0.1.1-rc.2', '0.1.0'] },
  );
});

test('pickR2Fields：缺省 / 非法 → 空对象或跳过（宽容消费，不抛错）', () => {
  assert.deepEqual(pickR2Fields(undefined), {});
  assert.deepEqual(pickR2Fields(null), {});
  assert.deepEqual(pickR2Fields('nope'), {});
  assert.deepEqual(pickR2Fields({ name: 'x', bundles: [] }), {});
  // 类型不符的 r2 字段静默跳过；dshVersions 只留非空字符串项
  assert.deepEqual(pickR2Fields({ launchers: [], vendored: 'x', dshVersions: [42, '', '  '] }), {});
});

/* ------------------- r2Badges（市场详情徽标） ------------------- */

test('r2Badges：launchers 简式/全式归一 → 需求/冲突徽标 + vendored 计数 + dshVersions', () => {
  const badges = r2Badges({
    launchers: {
      'official-desktop': '0.2.0',                          // 简式版本 → 需 ≥ 0.2.0
      dshl: { supported: false, reason: '补丁层冲突' },       // 全式冲突（带原因）
      'dsh-cli': false,                                      // 简式冲突（无原因）
      'dsh-packforge-app': true,                             // 纯支持 → 不产生徽标
    },
    vendored: { a: {}, b: {}, c: {} },
    dshVersions: ['0.1.0', '0.1.1-rc.2'],
  });
  assert.deepEqual(badges, [
    { kind: 'launcher-require', id: 'official-desktop', minVersion: '0.2.0' },
    { kind: 'launcher-conflict', id: 'dshl', reason: '补丁层冲突' },
    { kind: 'launcher-conflict', id: 'dsh-cli', reason: '' },
    { kind: 'vendored', count: 3 },
    { kind: 'dsh-versions', versions: ['0.1.0', '0.1.1-rc.2'] },
  ]);
});

test('r2Badges：无 r2 字段 / 纯支持 → 空列表（通用包）', () => {
  assert.deepEqual(r2Badges(undefined), []);
  assert.deepEqual(r2Badges({}), []);
  assert.deepEqual(r2Badges({ launchers: { dshl: true } }), []); // supported:true 无 minVersion
});

/* ------------------- normalizeMarketPack（索引条目宽容透传） ------------------- */

test('normalizeMarketPack：条目携带 r2 字段时透传 + launcherRestricted 派生标记', () => {
  const p = normalizeMarketPack({
    name: 'demo',
    version: '1.0.0',
    displayName: 'Demo',
    downloadUrl: 'https://x/y.dspack',
    sha256: 'f'.repeat(64),
    size: 10,
    launcherRestricted: true,
    launchers: { dshl: '0.1.0' },
    vendored: { 'dsh-pet': {} },
    dshVersions: ['0.1.0'],
  });
  assert.equal(p.launcherRestricted, true);
  assert.deepEqual(p.launchers, { dshl: '0.1.0' });
  assert.deepEqual(p.vendored, { 'dsh-pet': {} });
  assert.deepEqual(p.dshVersions, ['0.1.0']);
});

test('normalizeMarketPack：无 r2 字段的条目 → launcherRestricted=false，不设 r2 键', () => {
  const p = normalizeMarketPack({
    name: 'demo',
    version: '1.0.0',
    downloadUrl: 'https://x/y.dspack',
    sha256: 'f'.repeat(64),
    size: 10,
  });
  assert.equal(p.launcherRestricted, false);
  assert.ok(!('launchers' in p));
  assert.ok(!('vendored' in p));
  assert.ok(!('dshVersions' in p));
});

/* ------------------- fetchMarketPackDetail（懒加载 manifest r2 带出） ------------------- */

test('fetchMarketPackDetail：详情 manifest 的 r2 字段带出（r2 = pickR2Fields）', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-mkt-'));
  try {
    const manifest = baseManifest({
      launchers: { dshl: '0.1.0' },
      vendored: { 'dsh-pet': { version: '0.2.0', sha256: 'a'.repeat(64), size: 1, path: 'vendor/x.tgz' } },
      dshVersions: ['0.1.0'],
    });
    await fsp.mkdir(path.join(home, 'packs', 'o.r'), { recursive: true });
    await fsp.writeFile(path.join(home, 'packs', 'o.r', 'manifest.json'), JSON.stringify(manifest));
    await fsp.writeFile(path.join(home, 'packs', 'o.r', 'README.md'), '# demo');
    const d = await fetchMarketPackDetail(fsHost(), path.join(home, 'index.json'), { id: 'o.r' });
    assert.equal(d.dir, 'o.r');
    assert.equal(d.manifest.name, 'demo');
    assert.equal(d.readme, '# demo');
    assert.deepEqual(d.r2, {
      launchers: { dshl: '0.1.0' },
      vendored: { 'dsh-pet': { version: '0.2.0', sha256: 'a'.repeat(64), size: 1, path: 'vendor/x.tgz' } },
      dshVersions: ['0.1.0'],
    });
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});

/* ------------------- endpoints：pack/view launchersWarnings ------------------- */

test('pack/view：launchersWarnings 透出（warn / info / 静默三分支）', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-view-'));
  const real = getHost();
  const prevVer = process.env.DSH_VERSION;
  try {
    const warnPath = await writePack(path.join(home, 'warn.dspack'), baseManifest({
      launchers: { 'official-desktop': { supported: false, reason: '与桌面端补丁层冲突' } },
    }));
    const infoPath = await writePack(path.join(home, 'info.dspack'), baseManifest({
      launchers: { 'official-desktop': '9.9.9' },
    }));
    setHost(fsHost({ async sha256() { return '0'.repeat(64); } }));

    // supported:false → warn（v3 §8.4 判定表第 4 行：显示 reason）
    delete process.env.DSH_VERSION;
    const w = await ENDPOINTS['pack/view']({ payload: { source: warnPath } });
    assert.equal(w.valid, true);
    assert.equal(w.launchersWarnings.length, 1);
    assert.equal(w.launchersWarnings[0].level, 'warn');
    assert.ok(w.launchersWarnings[0].message.includes('与桌面端补丁层冲突'));

    // 版本未知（DSH_VERSION 缺省）→ info 轻提示（判定表第 3 行）
    const i = await ENDPOINTS['pack/view']({ payload: { source: infoPath } });
    assert.equal(i.launchersWarnings.length, 1);
    assert.equal(i.launchersWarnings[0].level, 'info');
    assert.ok(i.launchersWarnings[0].message.includes('版本未知'));

    // 版本自报达标（99.0 ≥ 9.9.9）→ 静默（判定表第 2 行）
    process.env.DSH_VERSION = '99.0';
    const s = await ENDPOINTS['pack/view']({ payload: { source: infoPath } });
    assert.deepEqual(s.launchersWarnings, []);
  } finally {
    if (prevVer === undefined) delete process.env.DSH_VERSION; else process.env.DSH_VERSION = prevVer;
    setHost(real);
    await fsp.rm(home, { recursive: true, force: true });
  }
});

test('pack/view：launchers 缺省（r1 包）→ launchersWarnings 为空', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-view2-'));
  const real = getHost();
  try {
    const packPath = await writePack(path.join(home, 'plain.dspack'), baseManifest());
    setHost(fsHost({ async sha256() { return '0'.repeat(64); } }));
    const r = await ENDPOINTS['pack/view']({ payload: { source: packPath } });
    assert.equal(r.valid, true);
    assert.deepEqual(r.launchersWarnings, []);
  } finally {
    setHost(real);
    await fsp.rm(home, { recursive: true, force: true });
  }
});

/* ------------------- endpoints：pack/market-detail ------------------- */

test('pack/market-detail：懒加载 manifest + README + r2 + 结构化徽标', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-mktd-'));
  const real = getHost();
  try {
    const manifest = baseManifest({
      launchers: { dshl: '0.1.0', 'official-desktop': { supported: false, reason: 'x' } },
      vendored: { a: {}, b: {} },
      dshVersions: ['0.1.0'],
    });
    await fsp.mkdir(path.join(home, 'packs', 'o.r'), { recursive: true });
    await fsp.writeFile(path.join(home, 'packs', 'o.r', 'manifest.json'), JSON.stringify(manifest));
    await fsp.writeFile(path.join(home, 'packs', 'o.r', 'README.md'), '# demo');
    setHost(fsHost());
    const r = await ENDPOINTS['pack/market-detail']({
      payload: { indexPath: path.join(home, 'index.json'), pack: { id: 'o.r', name: 'demo' } },
    });
    assert.equal(r.dir, 'o.r');
    assert.equal(r.manifest.name, 'demo');
    assert.equal(r.readme, '# demo');
    assert.deepEqual(r.r2, {
      launchers: manifest.launchers,
      vendored: { a: {}, b: {} },
      dshVersions: ['0.1.0'],
    });
    assert.deepEqual(r.badges, [
      { kind: 'launcher-require', id: 'dshl', minVersion: '0.1.0' },
      { kind: 'launcher-conflict', id: 'official-desktop', reason: 'x' },
      { kind: 'vendored', count: 2 },
      { kind: 'dsh-versions', versions: ['0.1.0'] },
    ]);
  } finally {
    setHost(real);
    await fsp.rm(home, { recursive: true, force: true });
  }
});

test('pack/market-detail：缺市场条目 → 抛错', async () => {
  const real = getHost();
  try {
    setHost(fsHost());
    await assert.rejects(() => ENDPOINTS['pack/market-detail']({ payload: {} }), /缺少市场条目/);
  } finally {
    setHost(real);
  }
});

/* ------------------- 启动器注册表（机器可读版，launcher-registry 头部） ------------------- */

test('parseLaunchersRegistry：合法 JSON → [{id, name}]；结构非法 / 无有效条目 → null', () => {
  const ok = parseLaunchersRegistry({
    schemaVersion: 1,
    launchers: [
      { id: 'dshl', name: 'DSHL · DeepSeek Harness Launcher', url: 'x', desc: 'y' },
      { id: 'official-desktop' }, // 无 name → 回落 id
      { bad: 1 }, // 无 id → 跳过
      { id: 'Not-Kebab' }, // 非 kebab-case → 跳过
    ],
  });
  assert.deepEqual(ok, [
    { id: 'dshl', name: 'DSHL · DeepSeek Harness Launcher' },
    { id: 'official-desktop', name: 'official-desktop' },
  ]);

  assert.equal(parseLaunchersRegistry(null), null);
  assert.equal(parseLaunchersRegistry({}), null); // 无 launchers[]
  assert.equal(parseLaunchersRegistry({ launchers: [] }), null); // 空表 → 回落
  assert.equal(parseLaunchersRegistry({ launchers: [{ bad: 1 }] }), null);
});

test('fetchLaunchersRegistry：拉取成功 → registry；失败 / 坏 JSON → 回落内置清单', async () => {
  const real = getHost();
  try {
    const host = fsHost({
      async download(url, dest) {
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.writeFile(dest, JSON.stringify({
          schemaVersion: 1,
          launchers: [{ id: 'dshl', name: 'DSHL' }, { id: 'hdsl', name: 'HDSL' }],
        }));
        void url;
      },
    });
    const r = await fetchLaunchersRegistry(host);
    assert.equal(r.source, 'registry');
    assert.deepEqual(r.launchers, [{ id: 'dshl', name: 'DSHL' }, { id: 'hdsl', name: 'HDSL' }]);

    const badJson = fsHost({
      async download(url, dest) {
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.writeFile(dest, 'not json');
        void url;
      },
    });
    const r2 = await fetchLaunchersRegistry(badJson);
    assert.equal(r2.source, 'builtin');
    assert.deepEqual(r2.launchers, BUILTIN_LAUNCHERS);

    const netFail = fsHost({ async download() { throw new Error('连接超时'); } });
    const r3 = await fetchLaunchersRegistry(netFail);
    assert.equal(r3.source, 'builtin');
    // 内置清单含新认领的 hdsl（与 specs/launcher-registry.md §1 表同步）
    assert.ok(BUILTIN_LAUNCHERS.some((l) => l.id === 'hdsl'));
  } finally {
    setHost(real);
  }
});
