// v5 r2 launchers 安装端判定测试（v3 §8.4 六行判定表 / launcher-registry §3 / v5 §14）：
// - normalizeLaunchers：简式糖（true / "ver" / false）→ 全式归一；
// - compareLauncherVersions：按 . 分段数值比较、缺段补 0、无 prerelease 语义；
// - judgeLaunchers：判定表全六行 + 三态缺省；
// - installPack 端到端：警告放行不硬拒 + result.launchers 透出 + 日志留痕（pnpm 以 stub 替身）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeLaunchers, compareLauncherVersions } from '../src/core/manifest.js';
import { judgeLaunchers, installPack } from '../src/core/install.js';
import { buildDspack, encodeText } from '../src/core/dspack.js';

/* ------------------- 测试工具 ------------------- */

/** 基于 node:fs 的 Host 替身（core 是 DI 边界，测试直接注入真实 fs 能力）。 */
function fsHost(extra = {}) {
  return {
    joinPath: (...p) => path.join(...p),
    resolvePath: (...p) => path.resolve(...p),
    homedir: () => os.homedir(),
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
    async mkdir(p) { await fsp.mkdir(p, { recursive: true }); },
    async rm(p, o = {}) { await fsp.rm(p, { recursive: o.recursive !== false, force: true }); },
    async mkdtemp(prefix) { return await fsp.mkdtemp(path.join(os.tmpdir(), prefix)); },
    async move(from, to) { await fsp.mkdir(path.dirname(to), { recursive: true }); await fsp.rename(from, to); },
    ...extra,
  };
}

/** 最小合法 v5 profile manifest（可叠加 launchers）。 */
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

/** 打一个最小 .dspack（profile 形态、无 vendor/），写到 home 下并返回路径。 */
async function writePack(home, manifest) {
  const zip = buildDspack({
    'dspack.json': encodeText(JSON.stringify({ format: 'dspack', version: 3 })),
    'manifest.json': encodeText(JSON.stringify(manifest)),
  });
  const packPath = path.join(home, 'demo-1.0.0.dspack');
  await fsp.writeFile(packPath, zip);
  return packPath;
}

/* ------------------- normalizeLaunchers（简式 → 全式归一） ------------------- */

test('normalizeLaunchers：三型简式糖 → 全式', () => {
  assert.deepEqual(
    normalizeLaunchers({ dshl: true, hdsl: '0.1.1.2', 'official-desktop': false }),
    {
      dshl: { supported: true },
      hdsl: { supported: true, minVersion: '0.1.1.2' },
      'official-desktop': { supported: false },
    },
  );
});

test('normalizeLaunchers：全式原样保留（supported 缺省视为 true）', () => {
  assert.deepEqual(
    normalizeLaunchers({
      'dsh-cli': { supported: false, reason: '需要 GUI' },
      'dsh-packforge-app': { minVersion: '1.2.0', reason: '提示' },
      dshl: { supported: true, minVersion: '0.1.1', reason: 'x' },
    }),
    {
      'dsh-cli': { supported: false, reason: '需要 GUI' },
      'dsh-packforge-app': { supported: true, minVersion: '1.2.0', reason: '提示' },
      dshl: { supported: true, minVersion: '0.1.1', reason: 'x' },
    },
  );
});

test('normalizeLaunchers：缺省 / 非对象 / 非法条目 → 空 map 或跳过', () => {
  assert.deepEqual(normalizeLaunchers(undefined), {});
  assert.deepEqual(normalizeLaunchers(null), {});
  assert.deepEqual(normalizeLaunchers('nope'), {});
  assert.deepEqual(normalizeLaunchers([1, 2]), {});
  // 非法条目（结构错误由 validateLaunchers 把关，纯函数只做容错跳过）
  assert.deepEqual(normalizeLaunchers({ dshl: 42, hdsl: null, 'dsh-cli': [] }), {});
});

/* ------------------- compareLauncherVersions（launcher-registry §3） ------------------- */

test('compareLauncherVersions：缺段补 0 —— 0.1.1.2 ≥ 0.1.1', () => {
  assert.ok(compareLauncherVersions('0.1.1.2', '0.1.1') > 0); // 0.1.1.2 vs 0.1.1.0
  assert.equal(compareLauncherVersions('0.1.1.0', '0.1.1'), 0);
  assert.ok(compareLauncherVersions('0.1.1', '0.1.1.2') < 0);
});

test('compareLauncherVersions：逐段数值比较（非字典序）', () => {
  assert.ok(compareLauncherVersions('0.10.0', '0.9.9') > 0); // 10 > 9（字典序会判反）
  assert.ok(compareLauncherVersions('1.0', '0.99.99') > 0);
  assert.ok(compareLauncherVersions('2.0.0', '10.0.0') < 0); // 数值比 2 < 10
  assert.equal(compareLauncherVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareLauncherVersions('1', '1.0.0.0'), 0); // 全缺段补 0
});

test('compareLauncherVersions：不做 prerelease 语义（rc 后缀就当普通分段解析）', () => {
  // 规范明确：不做 rc 等预发布语义——"0.1.1-rc.2" 按 . 切成 [0,1,'1-rc'→1,2]，
  // 与 [0,1,1] 比较：第 4 段 2 > 0 → 更新。没有「rc 低于正式版」的特殊排序。
  assert.ok(compareLauncherVersions('0.1.1-rc.2', '0.1.1') > 0);
  assert.equal(compareLauncherVersions('0.1.1-rc.2', '0.1.1.2'), 0);
  assert.equal(compareLauncherVersions('0.1.1-rc', '0.1.1'), 0); // '1-rc' 段 parseInt 截断为 1
});

/* ------------------- judgeLaunchers（v3 §8.4 六行判定表） ------------------- */

// 判定表第 1 行：supported:true，无 minVersion → 静默
test('judgeLaunchers：supported:true 无 minVersion → 静默', () => {
  const w = judgeLaunchers(normalizeLaunchers({ 'official-desktop': true }), 'official-desktop', '0.0.1');
  assert.deepEqual(w, []);
});

// 判定表第 2 行：supported:true，版本 ≥ minVersion → 静默
test('judgeLaunchers：supported:true 且版本达标 → 静默', () => {
  const w = judgeLaunchers(
    normalizeLaunchers({ 'official-desktop': '0.1.1' }),
    'official-desktop',
    '0.1.1.2', // 缺段补 0：0.1.1.2 ≥ 0.1.1.0
  );
  assert.deepEqual(w, []);
});

// 判定表第 3 行：supported:true，版本不足 / 版本未知 → 轻提示
test('judgeLaunchers：版本不足 → 轻提示「需要 <id> ≥ <ver>」', () => {
  const w = judgeLaunchers(normalizeLaunchers({ 'official-desktop': '0.2.0' }), 'official-desktop', '0.1.1');
  assert.equal(w.length, 1);
  assert.equal(w[0].level, 'info');
  assert.ok(w[0].message.includes('需要 official-desktop ≥ 0.2.0'));
  assert.ok(w[0].message.includes('0.1.1')); // 显示当前版本
});

test('judgeLaunchers：版本未知（启动器无法自报）→ 轻提示放行', () => {
  const w = judgeLaunchers(normalizeLaunchers({ 'official-desktop': '0.2.0' }), 'official-desktop', null);
  assert.equal(w.length, 1);
  assert.equal(w[0].level, 'info');
  assert.ok(w[0].message.includes('版本未知'));
});

// 判定表第 4 行：supported:false → 重警告（显示 reason）
test('judgeLaunchers：supported:false → 重警告显示 reason', () => {
  const w = judgeLaunchers(
    normalizeLaunchers({ 'official-desktop': { supported: false, reason: '与桌面端注入的补丁层冲突' } }),
    'official-desktop',
    '9.9.9',
  );
  assert.equal(w.length, 1);
  assert.equal(w[0].level, 'warn');
  assert.ok(w[0].message.includes('official-desktop'));
  assert.ok(w[0].message.includes('与桌面端注入的补丁层冲突'));
});

test('judgeLaunchers：supported:false 无 reason → 重警告（缺省文案）', () => {
  const w = judgeLaunchers(normalizeLaunchers({ dshl: false }), 'dshl', '1.0.0');
  assert.equal(w.length, 1);
  assert.equal(w[0].level, 'warn');
  assert.ok(w[0].message.includes('未提供原因'));
});

// 判定表第 5 行：未列出，map 无任何 supported:true（纯黑名单）→ 静默
test('judgeLaunchers：未列出 + 纯黑名单 → 静默', () => {
  const w = judgeLaunchers(
    normalizeLaunchers({ 'official-desktop': false, 'dsh-cli': { supported: false, reason: 'x' } }),
    'dshl',
    '0.1.0',
  );
  assert.deepEqual(w, []);
});

// 判定表第 6 行：未列出，map 有 supported:true（白名单）→ 轻提示列出支持项
test('judgeLaunchers：未列出 + 白名单 → 轻提示列出支持项', () => {
  const w = judgeLaunchers(
    normalizeLaunchers({ dshl: true, hdsl: '0.1.0', 'official-desktop': false }),
    'dsh-cli',
    '1.0.0',
  );
  assert.equal(w.length, 1);
  assert.equal(w[0].level, 'info');
  assert.ok(w[0].message.includes('dshl'));
  assert.ok(w[0].message.includes('hdsl'));
  assert.ok(!w[0].message.includes('official-desktop')); // supported:false 不进支持列表
  assert.ok(w[0].message.includes('dsh-cli')); // 提示未声明当前启动器
});

// 三态缺省：launchers 整个缺省 = 通用包（现状不变）
test('judgeLaunchers：launchers 缺省 → 通用包，静默', () => {
  assert.deepEqual(judgeLaunchers(normalizeLaunchers(undefined), 'official-desktop', null), []);
  assert.deepEqual(judgeLaunchers({}, 'official-desktop', '1.0.0'), []);
});

/* ------------------- installPack 端到端（警告放行不硬拒 + 透出） ------------------- */

test('installPack：supported:false → 只警告不拒，result.launchers 透出且日志留痕', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-lch-'));
  const profilesRoot = path.join(home, 'profiles');
  try {
    const manifest = baseManifest({
      launchers: { 'official-desktop': { supported: false, reason: '该包与桌面端绑定补丁冲突' } },
    });
    const packPath = await writePack(home, manifest);

    const logs = [];
    const host = fsHost({
      async pnpm() { return { status: 0 }; },
    });
    const r = await installPack(host, {
      source: packPath,
      profilesRoot,
      force: true,
      onOutput: (s) => logs.push(s),
    });

    // 安装成功（警告放行不硬拒）
    assert.equal(r.installed, true);
    assert.equal(r.profileName, 'demo');
    // result.launchers：selfId 缺省 official-desktop，warnings 携带重警告与 reason
    assert.equal(r.launchers.selfId, 'official-desktop');
    assert.equal(r.launchers.warnings.length, 1);
    assert.equal(r.launchers.warnings[0].level, 'warn');
    assert.ok(r.launchers.warnings[0].message.includes('该包与桌面端绑定补丁冲突'));
    // 日志留痕：逐条警告 + 「launchers 警告已放行」
    const all = logs.join('');
    assert.ok(all.includes('launchers 警告：'));
    assert.ok(all.includes('launchers 警告已放行'));
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});

test('installPack：launcherId/launcherVersion 覆盖 + 版本不足轻提示；无警告时不留放行日志', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-lch2-'));
  const profilesRoot = path.join(home, 'profiles');
  try {
    const manifest = baseManifest({
      launchers: { dshl: '0.2.0', 'official-desktop': true },
    });
    const packPath = await writePack(home, manifest);

    // 覆盖 selfId 为 dshl、版本 0.1.1（< 0.2.0）→ 轻提示
    const logs = [];
    const host = fsHost({ async pnpm() { return { status: 0 }; } });
    const r = await installPack(host, {
      source: packPath,
      profilesRoot,
      force: true,
      launcherId: 'dshl',
      launcherVersion: '0.1.1',
      onOutput: (s) => logs.push(s),
    });
    assert.equal(r.launchers.selfId, 'dshl');
    assert.equal(r.launchers.warnings.length, 1);
    assert.equal(r.launchers.warnings[0].level, 'info');
    assert.ok(r.launchers.warnings[0].message.includes('需要 dshl ≥ 0.2.0'));
    assert.ok(logs.join('').includes('launchers 警告已放行'));

    // 版本达标（0.1.1.2 ≥ 0.2.0? 否——用 0.2.1）→ 静默，且无「已放行」留痕（无警告可放）
    const logs2 = [];
    const r2 = await installPack(host, {
      source: packPath,
      profilesRoot,
      force: true,
      launcherId: 'dshl',
      launcherVersion: '0.2.1',
      onOutput: (s) => logs2.push(s),
    });
    assert.deepEqual(r2.launchers.warnings, []);
    assert.ok(!logs2.join('').includes('launchers 警告已放行'));
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});

test('installPack：launchers 缺省（r1 包）→ result.launchers.warnings 为空，安装不变', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-lch3-'));
  const profilesRoot = path.join(home, 'profiles');
  try {
    const packPath = await writePack(home, baseManifest());
    const host = fsHost({ async pnpm() { return { status: 0 }; } });
    const r = await installPack(host, { source: packPath, profilesRoot, force: true });
    assert.equal(r.installed, true);
    assert.equal(r.launchers.selfId, 'official-desktop');
    assert.deepEqual(r.launchers.warnings, []);
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});
