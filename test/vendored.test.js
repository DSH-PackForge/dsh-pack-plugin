// v5 r2（vendored / dshVersions / launchers）消费侧测试：
// - manifest 校验（结构 + 对账 + 版本一致性）；
// - resolveVendoredPlan 阶段 0 预检（sha256/size、未登记拒装、方言归一、显式优先）；
// - resolveDshVersion 交集决策；
// - installPack 端到端（file: 改写 + --prefer-offline + 方言直挂，pnpm 以 stub 替身）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { gzipSync } from 'fflate';
import { validateManifest } from '../src/core/manifest.js';
import { resolveVendoredPlan, isDialectSpec, lockfilePackageNames, lockfilePackageEntries, computeOfflineCoverage, listProfileDependencies, collectVendoredForExport, coordFromDirName, expandVendorSelection } from '../src/core/vendored.js';
import { resolveDshVersion, installPack } from '../src/core/install.js';
import { packProfile } from '../src/core/pack.js';
import { buildDspack, encodeText, parseDspack } from '../src/core/dspack.js';
import { buildTarball, untar } from '../src/core/tar.js';

/* ------------------- 测试工具 ------------------- */

/** 造一个最小 ustar 文件条目（与 npm-pull.test.js 同款）。 */
function tarFile(name, text) {
  const header = new Uint8Array(512);
  header.set(new TextEncoder().encode(name), 0);
  const data = new TextEncoder().encode(text);
  header.set(new TextEncoder().encode(`${data.length.toString(8).padStart(11, '0')}\0`), 124);
  header[156] = 0x30;
  const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
  padded.set(data);
  const out = new Uint8Array(512 + padded.length);
  out.set(header, 0);
  out.set(padded, 512);
  return out;
}

/** 拼 gzip+tar 的活儿交给 src/core/tar.js 的 buildTarball（互逆测试见文末）。 */

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

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
    async sha256(data) { return sha256(data); },
    async sha256File(p) { return sha256(await fsp.readFile(p)); },
    async move(from, to) { await fsp.mkdir(path.dirname(to), { recursive: true }); await fsp.rename(from, to); },
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
    dependencies: { 'dsh-pet': '0.2.0-local.1' },
    ...extra,
  };
}

/* ------------------- manifest 校验（r2 字段） ------------------- */

test('validateManifest：r2 三字段结构合法 → 通过', () => {
  const m = baseManifest({
    dshVersions: ['0.1.1-rc.2', '0.1.0'],
    launchers: { dshl: true, 'official-desktop': '0.1.1', 'dsh-cli': { supported: false, reason: 'x' } },
    vendored: {
      'dsh-pet': {
        version: '0.2.0-local.1', sha256: 'a'.repeat(64), size: 100,
        path: 'vendor/npm__dsh-pet/dsh-pet-0.2.0-local.1.tgz', reason: 'local-modified',
      },
    },
  });
  assert.deepEqual(validateManifest(m), []);
});

test('validateManifest：r1 包（无 r2 字段）照旧通过——前向兼容', () => {
  assert.deepEqual(validateManifest(baseManifest()), []);
});

test('validateManifest：vendored 对账失败 / 版本不一致 / 字段非法', () => {
  const bad1 = baseManifest({ vendored: { 'not-a-dep': { version: '1.0.0', sha256: 'a'.repeat(64), size: 1, path: 'vendor/x.tgz' } } });
  assert.ok(validateManifest(bad1).some((e) => e.includes('不在 dependencies')));

  const bad2 = baseManifest({
    vendored: { 'dsh-pet': { version: '9.9.9', sha256: 'a'.repeat(64), size: 1, path: 'vendor/x.tgz' } },
  });
  assert.ok(validateManifest(bad2).some((e) => e.includes('不一致')));

  const bad3 = baseManifest({
    vendored: { 'dsh-pet': { version: '0.2.0-local.1', sha256: 'xyz', size: 0, path: 'outside/x.tgz', reason: 'nope' } },
  });
  const errs = validateManifest(bad3);
  assert.ok(errs.some((e) => e.includes('sha256')));
  assert.ok(errs.some((e) => e.includes('size')));
  assert.ok(errs.some((e) => e.includes('vendor/')));
  assert.ok(errs.some((e) => e.includes('reason')));
});

test('validateManifest：dshVersions 空数组 / 重复 / 不含 dshVersion', () => {
  assert.ok(validateManifest(baseManifest({ dshVersions: [] })).some((e) => e.includes('dshVersions')));
  const dup = validateManifest(baseManifest({ dshVersions: ['1.0.0', '1.0.0'] }));
  assert.ok(dup.some((e) => e.includes('重复')));
  const notIn = validateManifest(baseManifest({ dshVersion: '0.2.0', dshVersions: ['1.0.0'] }));
  assert.ok(notIn.some((e) => e.includes('必须 ∈ dshVersions')));
});

test('validateManifest：launchers 全式未知字段 / 类型错误', () => {
  const bad = baseManifest({ launchers: { dshl: { supported: 'yes', extra: 1 } } });
  const errs = validateManifest(bad);
  assert.ok(errs.some((e) => e.includes('未知字段「extra」')));
  assert.ok(errs.some((e) => e.includes('supported')));
  // 未注册 ID 不拒绝（launcher-registry §2：警告不拦截）
  assert.deepEqual(validateManifest(baseManifest({ launchers: { 'who-is-this': true } })), []);
});

/* ------------------- resolveVendoredPlan（阶段 0 预检） ------------------- */

function makeVendorPack(manifest, vendorFiles = {}, extraEntries = {}) {
  return {
    ...manifest,
    __entries: {
      'dspack.json': encodeText(JSON.stringify({ format: 'dspack', version: 3 })),
      'manifest.json': encodeText(JSON.stringify(manifest)),
      ...Object.fromEntries(Object.entries(vendorFiles).map(([k, v]) => [`vendor/${k}`, v])),
      ...extraEntries,
    },
  };
}

test('resolveVendoredPlan：r1 包 → inactive，行为不变', async () => {
  const plan = await resolveVendoredPlan(fsHost(), baseManifest(), {});
  assert.equal(plan.active, false);
});

test('resolveVendoredPlan：显式条目校验通过并附上字节', async () => {
  const tgz = buildTarball({ 'package/package.json': '{"name":"dsh-pet","version":"0.2.0-local.1"}' });
  const m = baseManifest({
    vendored: { 'dsh-pet': { version: '0.2.0-local.1', sha256: sha256(tgz), size: tgz.length, path: 'vendor/npm__dsh-pet/dsh-pet-0.2.0-local.1.tgz' } },
  });
  const entries = { 'vendor/npm__dsh-pet/dsh-pet-0.2.0-local.1.tgz': tgz };
  const plan = await resolveVendoredPlan(fsHost(), m, entries);
  assert.equal(plan.active, true);
  const e = plan.byCoord.get('dsh-pet');
  assert.equal(e.sha256, sha256(tgz));
  assert.equal(e.bytes.length, tgz.length);
});

test('resolveVendoredPlan：sha256 / size 不符 → 装前拒装', async () => {
  const tgz = buildTarball({ 'package/package.json': '{"name":"dsh-pet"}' });
  const badSha = baseManifest({
    vendored: { 'dsh-pet': { version: '0.2.0-local.1', sha256: 'f'.repeat(64), size: tgz.length, path: 'vendor/x.tgz' } },
  });
  await assert.rejects(
    () => resolveVendoredPlan(fsHost(), badSha, { 'vendor/x.tgz': tgz }),
    /sha256 校验失败/,
  );
  const badSize = baseManifest({
    vendored: { 'dsh-pet': { version: '0.2.0-local.1', sha256: sha256(tgz), size: tgz.length + 1, path: 'vendor/x.tgz' } },
  });
  await assert.rejects(
    () => resolveVendoredPlan(fsHost(), badSize, { 'vendor/x.tgz': tgz }),
    /size 不符/,
  );
});

test('resolveVendoredPlan：vendor/ 未登记文件 / 非 .tgz / tarball 缺失 → 拒装', async () => {
  const tgz = buildTarball({ 'package/package.json': '{"name":"dsh-pet"}' });
  const m = baseManifest({
    vendored: { 'dsh-pet': { version: '0.2.0-local.1', sha256: sha256(tgz), size: tgz.length, path: 'vendor/a.tgz' } },
  });
  await assert.rejects(
    () => resolveVendoredPlan(fsHost(), m, { 'vendor/a.tgz': tgz, 'vendor/stray.tgz': tgz }),
    /未登记文件/,
  );
  await assert.rejects(
    () => resolveVendoredPlan(fsHost(), m, { 'vendor/a.tgz': tgz, 'vendor/b.txt': tgz }),
    /只允许 \.tgz/,
  );
  await assert.rejects(
    () => resolveVendoredPlan(fsHost(), m, {}),
    /tarball 缺失/,
  );
});

test('resolveVendoredPlan：vendored key 不在 dependencies → 对账失败', async () => {
  const tgz = buildTarball({ 'package/package.json': '{"name":"x"}' });
  const m = baseManifest({
    dependencies: { 'other-pkg': '1.0.0' },
    vendored: { 'dsh-pet': { version: '0.2.0-local.1', sha256: sha256(tgz), size: tgz.length, path: 'vendor/x.tgz' } },
  });
  await assert.rejects(() => resolveVendoredPlan(fsHost(), m, { 'vendor/x.tgz': tgz }), /对账失败/);
});

test('resolveVendoredPlan：DSHL 方言（vendor: spec + vendor.json）→ 隐式条目；显式 vendored 优先', async () => {
  const tgz = buildTarball({ 'package/package.json': '{"name":"dsh-pet","version":"0.2.0"}' });
  const dialect = baseManifest({ dependencies: { 'dsh-pet': 'vendor:dsh-pet-0.2.0.tgz' } });
  const entries = {
    'vendor/vendor.json': encodeText(JSON.stringify({
      packages: [{ file: 'dsh-pet-0.2.0.tgz', name: 'dsh-pet', sha256: sha256(tgz) }],
    })),
    'vendor/dsh-pet-0.2.0.tgz': tgz,
  };
  const plan = await resolveVendoredPlan(fsHost(), dialect, entries);
  assert.equal(plan.active, true);
  const e = plan.byCoord.get('dsh-pet');
  assert.ok(e, '方言条目应按包名归一');
  assert.equal(e.dialect, true);
  assert.equal(e.path, 'vendor/dsh-pet-0.2.0.tgz');
  assert.ok(isDialectSpec('vendor:x.tgz'));
  assert.ok(!isDialectSpec('0.2.0'));

  // 显式 vendored{} 与方言并存：显式优先（§8.5）
  const both = baseManifest({
    dependencies: { 'dsh-pet': 'vendor:dsh-pet-0.2.0.tgz' },
    vendored: { 'dsh-pet': { version: 'vendor:dsh-pet-0.2.0.tgz', sha256: sha256(tgz), size: tgz.length, path: 'vendor/dsh-pet-0.2.0.tgz' } },
  });
  const plan2 = await resolveVendoredPlan(fsHost(), both, entries);
  assert.equal(plan2.byCoord.get('dsh-pet').dialect, undefined);
});

test('resolveVendoredPlan：dshhome 形态对账聚合各 profile 依赖', async () => {
  const tgz = buildTarball({ 'package/package.json': '{"name":"dsh-pet"}' });
  const m = {
    manifestVersion: 5,
    type: 'dshhome',
    name: 'home-pack',
    version: '1.0.0',
    defaultProfile: 'a',
    profiles: {
      a: { bundles: [], dependencies: { 'dsh-pet': '0.2.0' } },
      b: { bundles: [], dependencies: {} },
    },
    vendored: { 'dsh-pet': { version: '0.2.0', sha256: sha256(tgz), size: tgz.length, path: 'vendor/x.tgz' } },
  };
  const plan = await resolveVendoredPlan(fsHost(), m, { 'vendor/x.tgz': tgz });
  assert.equal(plan.active, true);
});

/* ------------------- resolveDshVersion（r2 §13 决策） ------------------- */

test('resolveDshVersion：dshVersion 命中优先 → 集合内最新 → 无交集 null', () => {
  // dshVersion 已装：直接命中
  assert.deepEqual(
    resolveDshVersion({ dshVersion: '0.1.0', dshVersions: ['0.1.0', '0.2.0'] }, ['0.2.0', '0.1.0']),
    { version: '0.1.0', source: 'dshVersion' },
  );
  // dshVersion 未装、集合交集非空：取交集内最新（同段号时正式版 > 预发布）
  assert.deepEqual(
    resolveDshVersion({ dshVersion: '0.1.0', dshVersions: ['0.1.0', '0.2.0', '0.2.0-rc.1'] }, ['0.2.0', '0.2.0-rc.1']),
    { version: '0.2.0', source: 'dshVersions' },
  );
  // 交集内最高版本带 rc 后缀但段号更新 → 仍是「最新」（semver 序）
  assert.deepEqual(
    resolveDshVersion({ dshVersion: '0.1.0', dshVersions: ['0.1.0', '0.2.0', '0.3.0-rc.1'] }, ['0.2.0', '0.3.0-rc.1']),
    { version: '0.3.0-rc.1', source: 'dshVersions' },
  );
  // 无 dshVersion、只有集合
  assert.deepEqual(
    resolveDshVersion({ dshVersions: ['0.1.0', '0.2.0'] }, ['0.2.0']),
    { version: '0.2.0', source: 'dshVersions' },
  );
  // 无交集
  assert.equal(resolveDshVersion({ dshVersion: '0.9.9', dshVersions: ['0.9.9'] }, ['0.1.0']), null);
  // 两者全缺省
  assert.equal(resolveDshVersion({}, ['0.1.0']), null);
});

/* ------------------- installPack 端到端（pnpm stub） ------------------- */

test('installPack：显式 vendored → vendor-blobs 落盘 + package.json file: 改写 + --prefer-offline', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-vend-'));
  const profilesRoot = path.join(home, 'profiles');
  try {
    const tgz = buildTarball({
      'package/package.json': JSON.stringify({ name: 'dsh-pet', version: '0.2.0-local.1' }),
    });
    const manifest = baseManifest({
      dshVersion: '',
      vendored: {
        'dsh-pet': {
          version: '0.2.0-local.1', sha256: sha256(tgz), size: tgz.length,
          path: 'vendor/npm__dsh-pet/dsh-pet-0.2.0-local.1.tgz', reason: 'local-modified',
        },
      },
    });
    const zip = buildDspack({
      'dspack.json': encodeText(JSON.stringify({ format: 'dspack', version: 3 })),
      'manifest.json': encodeText(JSON.stringify(manifest)),
      'vendor/npm__dsh-pet/dsh-pet-0.2.0-local.1.tgz': tgz,
    });
    const packPath = path.join(home, 'demo-1.0.0.dspack');
    await fsp.writeFile(packPath, zip);

    const calls = [];
    const host = fsHost({
      async pnpm(args, o) { calls.push({ args, cwd: o?.cwd }); return { status: 0 }; },
    });
    const r = await installPack(host, { source: packPath, profilesRoot, force: true });

    // vendor-blobs 实体落盘 + package.json spec 改写（坐标子目录防不同坐标同名 tarball 碰撞）
    const target = path.join(profilesRoot, 'demo');
    const pkg = JSON.parse(await fsp.readFile(path.join(target, 'package.json'), 'utf8'));
    assert.equal(pkg.dependencies['dsh-pet'], 'file:vendor-blobs/dsh-pet/npm__dsh-pet/dsh-pet-0.2.0-local.1.tgz');
    const blob = await fsp.readFile(path.join(target, 'vendor-blobs', 'dsh-pet', 'npm__dsh-pet', 'dsh-pet-0.2.0-local.1.tgz'));
    assert.equal(blob.length, tgz.length);
    // pnpm 走 --prefer-offline（r2 统一算法），且不再带 --frozen-lockfile
    assert.equal(calls.length, 1);
    assert.ok(calls[0].args.includes('--prefer-offline'));
    assert.ok(!calls[0].args.includes('--frozen-lockfile'));
    // 结果摘要
    assert.equal(r.vendored.active, true);
    assert.deepEqual(r.vendored.used, ['dsh-pet']);
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});

test('installPack：DSHL 方言 → 依赖剔除 + tarball 直挂 node_modules + 对账可见', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-dialect-'));
  const profilesRoot = path.join(home, 'profiles');
  try {
    const tgz = buildTarball({
      'package/package.json': JSON.stringify({ name: 'dsh-pet', version: '0.2.0', dsh: { bundle: { patch: 'p.yml' } } }),
      'package/p.yml': 'plugins: []',
    });
    const manifest = baseManifest({
      dependencies: { 'dsh-pet': 'vendor:dsh-pet-0.2.0.tgz' },
      bundles: ['dsh-pet'],
    });
    const zip = buildDspack({
      'dspack.json': encodeText(JSON.stringify({ format: 'dspack', version: 3 })),
      'manifest.json': encodeText(JSON.stringify(manifest)),
      'vendor/vendor.json': encodeText(JSON.stringify({
        packages: [{ file: 'dsh-pet-0.2.0.tgz', name: 'dsh-pet', sha256: sha256(tgz) }],
      })),
      'vendor/dsh-pet-0.2.0.tgz': tgz,
    });
    const packPath = path.join(home, 'demo-1.0.0.dspack');
    await fsp.writeFile(packPath, zip);

    const calls = [];
    const host = fsHost({
      async pnpm(args, o) { calls.push({ args, cwd: o?.cwd }); return { status: 0 }; },
    });
    const r = await installPack(host, { source: packPath, profilesRoot, force: true });

    // 方言依赖从重建的 package.json 中剔除（不传给 pnpm）
    const target = path.join(profilesRoot, 'demo');
    const pkg = JSON.parse(await fsp.readFile(path.join(target, 'package.json'), 'utf8'));
    assert.equal(pkg.dependencies['dsh-pet'], undefined);
    // 直挂进 node_modules（须发生在层栈对账之前——对账能读到 dsh.bundle.patch 即证明顺序正确）
    const mounted = JSON.parse(await fsp.readFile(path.join(target, 'node_modules', 'dsh-pet', 'package.json'), 'utf8'));
    assert.equal(mounted.name, 'dsh-pet');
    assert.deepEqual(r.reconcile.missing, []);
    assert.deepEqual(r.vendored.mounted, ['dsh-pet']);
    assert.ok(calls[0].args.includes('--prefer-offline'));
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});

test('installPack：vendor/ 损坏（sha 不符）→ 阶段 0 拒装，不落任何文件', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-bad-'));
  const profilesRoot = path.join(home, 'profiles');
  try {
    const tgz = buildTarball({ 'package/package.json': '{"name":"dsh-pet"}' });
    const manifest = baseManifest({
      vendored: { 'dsh-pet': { version: '0.2.0-local.1', sha256: '0'.repeat(64), size: tgz.length, path: 'vendor/x.tgz' } },
    });
    const zip = buildDspack({
      'dspack.json': encodeText(JSON.stringify({ format: 'dspack', version: 3 })),
      'manifest.json': encodeText(JSON.stringify(manifest)),
      'vendor/x.tgz': tgz,
    });
    const packPath = path.join(home, 'demo-1.0.0.dspack');
    await fsp.writeFile(packPath, zip);

    const host = fsHost({ async pnpm() { throw new Error('不应执行到 pnpm'); } });
    await assert.rejects(
      () => installPack(host, { source: packPath, profilesRoot, force: true }),
      /sha256 校验失败/,
    );
    // 目标 profile 目录不应被创建（装前发现优于装到一半）
    assert.equal(await fsp.stat(path.join(profilesRoot, 'demo')).then(() => true, () => false), false);
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});

/* ------------------- 闭包完整性 → 严格离线（v3 §8.3） ------------------- */

/** 最小 pnpm-lock 文本（packages:/snapshots: 各列若干包）。 */
function lockfile(packages, snapshots = []) {
  const pkgLines = packages.map((p) => `  '${p}':\n    resolution: {integrity: sha512-x}`).join('\n');
  const snapLines = snapshots.map((s) => `  '${s}':\n    dependencies:\n      fflate:\n        version: 0.8.3`).join('\n');
  return [
    "lockfileVersion: '9.0'",
    '',
    'importers:',
    '  .:',
    '    dependencies:',
    '      dsh-pet:',
    '        specifier: 0.2.0-local.1',
    '',
    'packages:',
    pkgLines,
    '',
    'snapshots:',
    snapLines,
    '',
  ].join('\n');
}

test('lockfilePackageNames：收集 packages/snapshots 条目名，忽略嵌套字段与 importers', () => {
  const text = lockfile(
    ['dsh-pet@0.2.0-local.1', '@scope/pkg@1.0.0', 'fflate@0.8.2'],
    ['dsh-pet@0.2.0-local.1'],
  );
  const names = lockfilePackageNames(text);
  assert.ok(names);
  assert.deepEqual([...names].sort(), ['@scope/pkg', 'dsh-pet', 'fflate']);
  // 嵌套字段（dependencies/version）与 importers 的 specifier 均不应混入
  assert.ok(!names.has('specifier'));
  assert.ok(!names.has('dependencies'));
  assert.ok(!names.has('fflate:'));
  // 无 packages 条目 → null
  assert.equal(lockfilePackageNames("lockfileVersion: '9.0'\nimporters:\n  .:\n"), null);
});

test('computeOfflineCoverage：完整闭包 → complete；缺传递依赖 → 列出缺失', async () => {
  const tgz = buildTarball({ 'package/package.json': '{"name":"dsh-pet"}' });
  const m = baseManifest({
    vendored: { 'dsh-pet': { version: '0.2.0-local.1', sha256: sha256(tgz), size: tgz.length, path: 'vendor/x.tgz' } },
  });
  const plan = await resolveVendoredPlan(fsHost(), m, { 'vendor/x.tgz': tgz });

  // lockfile 只有 dsh-pet → 闭包完整
  const full = computeOfflineCoverage(lockfile(['dsh-pet@0.2.0-local.1']), plan);
  assert.equal(full.complete, true);
  assert.deepEqual(full.missing, []);

  // lockfile 还要 fflate（dsh-pet 的传递依赖）→ 不完整
  const partial = computeOfflineCoverage(lockfile(['dsh-pet@0.2.0-local.1', 'fflate@0.8.2']), plan);
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.missing, ['fflate']);

  // git 坐标按包名折算匹配
  const gitTgz = buildTarball({ 'package/package.json': '{"name":"dafy-whale-theme"}' });
  const mg = baseManifest({
    dependencies: { 'github:DViridescent/dafy-whale-theme': '99e8c57' },
    vendored: { 'github:DViridescent/dafy-whale-theme': { version: '99e8c57', sha256: sha256(gitTgz), size: gitTgz.length, path: 'vendor/g.tgz' } },
  });
  const planG = await resolveVendoredPlan(fsHost(), mg, { 'vendor/g.tgz': gitTgz });
  assert.equal(computeOfflineCoverage(lockfile(["dafy-whale-theme@github:DViridescent/dafy-whale-theme#99e8c57"]), planG).complete, true);

  // r1 包 / 无 lockfile → null（保持 --prefer-offline 不升级）
  assert.equal(computeOfflineCoverage(lockfile(['x@1.0.0']), { active: false, byCoord: new Map() }), null);
  assert.equal(computeOfflineCoverage(null, plan), null);
});

test('installPack：闭包完整 → pnpm install --offline（严格离线）', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-offline-'));
  const profilesRoot = path.join(home, 'profiles');
  try {
    const tgz = buildTarball({ 'package/package.json': '{"name":"dsh-pet","version":"0.2.0-local.1"}' });
    const manifest = baseManifest({
      vendored: {
        'dsh-pet': { version: '0.2.0-local.1', sha256: sha256(tgz), size: tgz.length, path: 'vendor/npm__dsh-pet/dsh-pet-0.2.0-local.1.tgz' },
      },
    });
    const zip = buildDspack({
      'dspack.json': encodeText(JSON.stringify({ format: 'dspack', version: 3 })),
      'manifest.json': encodeText(JSON.stringify(manifest)),
      'pnpm-lock.yaml': encodeText(lockfile(['dsh-pet@0.2.0-local.1'])),
      'vendor/npm__dsh-pet/dsh-pet-0.2.0-local.1.tgz': tgz,
    });
    const packPath = path.join(home, 'demo-1.0.0.dspack');
    await fsp.writeFile(packPath, zip);

    const calls = [];
    const host = fsHost({ async pnpm(args, o) { calls.push({ args }); return { status: 0 }; } });
    const r = await installPack(host, { source: packPath, profilesRoot, force: true });

    assert.equal(calls.length, 1);
    assert.ok(calls[0].args.includes('--offline'), `应严格离线：${calls[0].args.join(' ')}`);
    assert.ok(!calls[0].args.includes('--prefer-offline'));
    assert.ok(!calls[0].args.includes('--frozen-lockfile'));
    assert.equal(r.vendored.offline, true);
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});

test('installPack：闭包不完整（缺传递依赖）→ 保持 --prefer-offline', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-partial-'));
  const profilesRoot = path.join(home, 'profiles');
  try {
    const tgz = buildTarball({ 'package/package.json': '{"name":"dsh-pet","version":"0.2.0-local.1"}' });
    const manifest = baseManifest({
      vendored: {
        'dsh-pet': { version: '0.2.0-local.1', sha256: sha256(tgz), size: tgz.length, path: 'vendor/npm__dsh-pet/dsh-pet-0.2.0-local.1.tgz' },
      },
    });
    const zip = buildDspack({
      'dspack.json': encodeText(JSON.stringify({ format: 'dspack', version: 3 })),
      'manifest.json': encodeText(JSON.stringify(manifest)),
      // fflate 是 dsh-pet 的传递依赖，未 vendored → 闭包不完整
      'pnpm-lock.yaml': encodeText(lockfile(['dsh-pet@0.2.0-local.1', 'fflate@0.8.2'])),
      'vendor/npm__dsh-pet/dsh-pet-0.2.0-local.1.tgz': tgz,
    });
    const packPath = path.join(home, 'demo-1.0.0.dspack');
    await fsp.writeFile(packPath, zip);

    const calls = [];
    const host = fsHost({ async pnpm(args) { calls.push({ args }); return { status: 0 }; } });
    const r = await installPack(host, { source: packPath, profilesRoot, force: true });

    assert.ok(calls[0].args.includes('--prefer-offline'));
    assert.ok(!calls[0].args.includes('--offline'));
    assert.equal(r.vendored.offline, false);
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});

/* ------------------- 导出侧（v3 §8.6 打包端义务） ------------------- */

test('buildTarball/untar：互逆 round-trip（含 ustar 头）', () => {
  const tgz = buildTarball({
    'package/package.json': '{"name":"x","version":"1.0.0"}',
    'package/src/index.js': 'export const x = 1;',
  });
  const out = untar(tgz);
  assert.equal(new TextDecoder().decode(out['package/package.json']), '{"name":"x","version":"1.0.0"}');
  assert.equal(new TextDecoder().decode(out['package/src/index.js']), 'export const x = 1;');
});

test('coordFromDirName：vendor-blobs 目录名反推坐标', () => {
  assert.equal(coordFromDirName('github__DViridescent__dafy-whale-theme'), 'github:DViridescent/dafy-whale-theme');
  assert.equal(coordFromDirName('@scope__pkg'), '@scope/pkg');
  assert.equal(coordFromDirName('dsh-pet'), 'dsh-pet');
  assert.equal(coordFromDirName('github__a__b__x', 'fallback'), 'fallback'); // 反推不出的回落
});

/** 造一个带三类依赖的 profile 目录（npm 精确版本 / git sha / file:vendor-blobs round-trip）。 */
async function makeProfileWithDeps(home) {
  const dir = path.join(home, 'profiles', 'demo');
  // npm 依赖（已安装，node_modules 有原件）
  await fsp.mkdir(path.join(dir, 'node_modules', 'dsh-pet'), { recursive: true });
  await fsp.writeFile(path.join(dir, 'node_modules', 'dsh-pet', 'package.json'), JSON.stringify({ name: 'dsh-pet', version: '0.2.0', main: 'index.js' }));
  await fsp.writeFile(path.join(dir, 'node_modules', 'dsh-pet', 'index.js'), 'export const pet = 1;');
  // git 依赖（独立包，node_modules 有原件）
  await fsp.mkdir(path.join(dir, 'node_modules', 'other-theme'), { recursive: true });
  await fsp.writeFile(path.join(dir, 'node_modules', 'other-theme', 'package.json'), JSON.stringify({ name: 'other-theme', version: '1.0.0' }));
  // vendor-blobs round-trip（git 坐标来源，版本已带 -local 后缀）
  const blobDir = path.join(dir, 'vendor-blobs', 'github__DViridescent__dafy-whale-theme');
  await fsp.mkdir(blobDir, { recursive: true });
  const blobTgz = buildTarball({ 'package/package.json': '{"name":"dafy-whale-theme","version":"0.3.0-local.1"}' });
  await fsp.writeFile(path.join(blobDir, 'dafy-whale-theme-0.3.0-local.1.tgz'), blobTgz);
  // profile package.json
  await fsp.writeFile(path.join(dir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-demo',
    dependencies: {
      'dsh-pet': '0.2.0',
      'other-theme': 'github:Other/theme#abcdef123',
      'whale-theme': 'file:vendor-blobs/github__DViridescent__dafy-whale-theme/dafy-whale-theme-0.3.0-local.1.tgz',
    },
    dsh: { profile: { bundles: [] } },
  }, null, 2));
  return { dir, blobTgz };
}

test('listProfileDependencies：三类依赖分类 + vendored 标记 + 已装检测', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-list-'));
  try {
    const { dir } = await makeProfileWithDeps(home);
    const deps = await listProfileDependencies(fsHost(), [dir]);
    const byName = Object.fromEntries(deps.map((d) => [d.pkgName, d]));

    assert.equal(byName['dsh-pet'].kind, 'npm');
    assert.equal(byName['dsh-pet'].version, '0.2.0');
    assert.equal(byName['dsh-pet'].installed, true);
    assert.equal(byName['dsh-pet'].vendored, false);

    assert.equal(byName['other-theme'].kind, 'git');
    assert.equal(byName['other-theme'].coord, 'github:Other/theme');
    assert.equal(byName['other-theme'].version, 'abcdef123');

    assert.equal(byName['whale-theme'].kind, 'vendored');
    assert.equal(byName['whale-theme'].vendored, true);
    // round-trip：file: spec 的坐标反推为 git 坐标，版本读自 tarball
    assert.equal(byName['whale-theme'].coord, 'github:DViridescent/dafy-whale-theme');
    assert.equal(byName['whale-theme'].version, '0.3.0-local.1');
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});

test('listProfileDependencies：npm 范围 spec 折算为已安装精确版本（^ 不进 tarball URL）', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-range-'));
  try {
    const dir = path.join(home, 'profiles', 'demo');
    await fsp.mkdir(path.join(dir, 'node_modules', 'dsh-pet'), { recursive: true });
    await fsp.writeFile(path.join(dir, 'node_modules', 'dsh-pet', 'package.json'), JSON.stringify({ name: 'dsh-pet', version: '0.2.0' }));
    await fsp.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'p', dependencies: { 'dsh-pet': '^0.2.0' } }));

    const deps = await listProfileDependencies(fsHost(), [dir]);
    const pet = deps.find((d) => d.pkgName === 'dsh-pet');
    assert.equal(pet.spec, '^0.2.0', '原声明保留在 spec');
    assert.equal(pet.version, '0.2.0', '范围 spec 应折算为已安装精确版本');

    // 取件 URL 用精确版本，不再带 ^（否则 registry 404 → 误回落 -local.1）
    const upstreamTgz = buildTarball({ 'package/package.json': '{"name":"dsh-pet","version":"0.2.0"}' });
    const host = fsHost({
      async download(url, dest) {
        assert.equal(url, 'https://registry.npmjs.org/dsh-pet/-/dsh-pet-0.2.0.tgz');
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.writeFile(dest, upstreamTgz);
      },
    });
    const vr = await collectVendoredForExport(host, [dir], { 'dsh-pet': '^0.2.0' }, { 'dsh-pet': 'explicit' });
    assert.equal(vr.vendored['dsh-pet'].version, '0.2.0');
    assert.equal(vr.dependencies['dsh-pet'], '0.2.0');
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});

test('collectVendoredForExport：vendor-blobs round-trip → 原字节复用，三处一致', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-exp-rt-'));
  try {
    const { dir, blobTgz } = await makeProfileWithDeps(home);
    const base = {
      'dsh-pet': '0.2.0',
      'whale-theme': 'file:vendor-blobs/github__DViridescent__dafy-whale-theme/dafy-whale-theme-0.3.0-local.1.tgz',
    };
    const vr = await collectVendoredForExport(fsHost(), [dir], base, {
      'github:DViridescent/dafy-whale-theme': 'local-modified',
    });

    const e = vr.vendored['github:DViridescent/dafy-whale-theme'];
    assert.ok(e, 'vendored 条目按坐标登记');
    assert.equal(e.version, '0.3.0-local.1');
    assert.equal(e.sha256, sha256(blobTgz));
    assert.equal(e.size, blobTgz.length);
    assert.equal(e.reason, 'local-modified');
    assert.ok(e.path.startsWith('vendor/github__DViridescent__dafy-whale-theme/'));
    assert.equal(vr.entries[e.path].length, blobTgz.length, '归档条目 = 原字节');
    // dependencies：旧 pkgName key（file: spec）删除，坐标 → tarball 版本
    assert.equal(vr.dependencies['whale-theme'], undefined);
    assert.equal(vr.dependencies['github:DViridescent/dafy-whale-theme'], '0.3.0-local.1');
    assert.equal(vr.dependencies['dsh-pet'], '0.2.0');
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});

test('collectVendoredForExport：npm 上游存活 → registry 原件，版本不变', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-exp-alive-'));
  try {
    const { dir } = await makeProfileWithDeps(home);
    const upstreamTgz = buildTarball({ 'package/package.json': '{"name":"dsh-pet","version":"0.2.0","dist":{}}' });
    const host = fsHost({
      async download(url, dest) {
        assert.ok(url.endsWith('/dsh-pet/-/dsh-pet-0.2.0.tgz'), `registry URL：${url}`);
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.writeFile(dest, upstreamTgz);
      },
    });
    const vr = await collectVendoredForExport(host, [dir], { 'dsh-pet': '0.2.0' }, { 'dsh-pet': 'explicit' });

    const e = vr.vendored['dsh-pet'];
    assert.equal(e.version, '0.2.0');
    assert.equal(e.sha256, sha256(upstreamTgz));
    assert.equal(vr.dependencies['dsh-pet'], '0.2.0');
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});

test('collectVendoredForExport：npm 上游消失 → 本地重打包 -local.1 后缀，三处一致', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-exp-dead-'));
  try {
    const { dir } = await makeProfileWithDeps(home);
    const host = fsHost({ async download() { throw new Error('HTTP 404'); } });
    const vr = await collectVendoredForExport(host, [dir], { 'dsh-pet': '0.2.0' }, { 'dsh-pet': 'upstream-missing' });

    const e = vr.vendored['dsh-pet'];
    assert.equal(e.version, '0.2.0-local.1');
    assert.ok(e.path.endsWith('dsh-pet-0.2.0-local.1.tgz'), e.path);
    // tarball 内 package.json version 与 vendored.version 一致（三处一致的包内侧）
    const tp = JSON.parse(new TextDecoder().decode(untar(vr.entries[e.path])['package/package.json']));
    assert.equal(tp.version, '0.2.0-local.1');
    // dependencies 值同步（三处一致的 manifest 侧）
    assert.equal(vr.dependencies['dsh-pet'], '0.2.0-local.1');
    // sha256/size 以重打包后的实际内容为准
    assert.equal(e.sha256, sha256(vr.entries[e.path]));
    assert.equal(e.size, vr.entries[e.path].length);
    assert.ok(vr.notes.some((n) => n.includes('dsh-pet')), '取件失败重打包应有提示');
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});

test('collectVendoredForExport：git 坐标 → node_modules 重打包（版本 = sha）；非法 reason / 未知坐标 → 报错', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-exp-git-'));
  try {
    const { dir } = await makeProfileWithDeps(home);
    const vr = await collectVendoredForExport(fsHost(), [dir],
      { 'github:Other/theme': 'abcdef123' },
      { 'github:Other/theme': 'explicit' });
    assert.equal(vr.vendored['github:Other/theme'].version, 'abcdef123');
    assert.equal(vr.dependencies['github:Other/theme'], 'abcdef123');

    // 非法 reason
    await assert.rejects(
      () => collectVendoredForExport(fsHost(), [dir], { 'dsh-pet': '0.2.0' }, { 'dsh-pet': 'nope' }),
      /reason「nope」非法/,
    );
    // 未知坐标
    await assert.rejects(
      () => collectVendoredForExport(fsHost(), [dir], { 'dsh-pet': '0.2.0' }, { 'ghost-pkg': 'explicit' }),
      /不在 profile 依赖中/,
    );
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});

test('packProfile：vendorCoords → 导出的 .dspack 含 vendor/ 与 manifest.vendored，dependencies 三处一致', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-pack-'));
  try {
    const { dir } = await makeProfileWithDeps(home);
    const host = fsHost({ async download() { throw new Error('HTTP 404'); } }); // 上游消失
    const r = await packProfile(host, { name: 'demo', dir }, {
      out: path.join(home, 'out'),
      force: true,
      vendorCoords: { 'dsh-pet': 'upstream-missing' },
    });

    // 默认档 auto：手动勾选 dsh-pet + round-trip 的 whale-theme 自动补选
    assert.deepEqual([...r.vendored].sort(), ['dsh-pet', 'github:DViridescent/dafy-whale-theme']);
    // 读回产物验证
    const { entries } = parseDspack(new Uint8Array(await fsp.readFile(r.output)));
    const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json']));
    const e = manifest.vendored['dsh-pet'];
    assert.equal(e.version, '0.2.0-local.1');
    assert.equal(e.reason, 'upstream-missing');
    assert.equal(manifest.dependencies['dsh-pet'], '0.2.0-local.1');
    const tgz = entries[e.path];
    assert.ok(tgz, `归档含 ${e.path}`);
    assert.equal(e.sha256, sha256(tgz));
    // 导出产物可被自家校验器通过（结构自洽）
    assert.deepEqual(validateManifest(manifest), []);
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});

/* ------------------- 导出侧：vendor 档位 + dshVersions / launchers ------------------- */

test('expandVendorSelection：off 清空 / auto 仅手动+round-trip（不联网探测） / full 全选', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-knob-'));
  try {
    const { dir } = await makeProfileWithDeps(home);

    // off：手动选择也被忽略
    const off = await expandVendorSelection(fsHost(), [dir], { 'dsh-pet': 'explicit' }, 'off');
    assert.deepEqual(off.selection, {});

    // auto：npm / git 依赖不自动补选（不联网探测）；round-trip 的 whale-theme 复用
    const auto = await expandVendorSelection(fsHost(), [dir], {}, 'auto');
    assert.deepEqual(auto.selection, { 'github:DViridescent/dafy-whale-theme': 'explicit' });
    assert.deepEqual(auto.probed, ['github:DViridescent/dafy-whale-theme']);

    // full：全部直接依赖（npm + git + round-trip）
    const full = await expandVendorSelection(fsHost(), [dir], {}, 'full');
    assert.ok(full.selection['dsh-pet']);
    assert.ok(full.selection['github:Other/theme']);
    assert.ok(full.selection['github:DViridescent/dafy-whale-theme']);
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});

test('packProfile：vendor=off 忽略手动勾选，不产生 vendor/', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-off-'));
  try {
    const { dir } = await makeProfileWithDeps(home);
    const r = await packProfile(fsHost(), { name: 'demo', dir }, {
      out: path.join(home, 'out'),
      force: true,
      vendor: 'off',
      vendorCoords: { 'dsh-pet': 'explicit' },
    });
    assert.deepEqual(r.vendored, []);
    const { entries } = parseDspack(new Uint8Array(await fsp.readFile(r.output)));
    assert.ok(!Object.keys(entries).some((k) => k.startsWith('vendor/')), 'off 档不应有 vendor/ 条目');
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});

test('packProfile：dshVersions + launchers 写入 manifest；dshVersion ∉ dshVersions → 导出报错', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-compat-'));
  try {
    const { dir } = await makeProfileWithDeps(home);
    const out = path.join(home, 'out');
    const r = await packProfile(fsHost(), { name: 'demo', dir }, {
      out,
      force: true,
      vendor: 'off',
      dshVersion: '0.1.0',
      dshVersions: ['0.1.0', '0.2.0'],
      launchers: {
        dshl: '0.1.1.2',
        'official-desktop': { supported: false, reason: 'uses native hooks' },
      },
    });
    const { entries } = parseDspack(new Uint8Array(await fsp.readFile(r.output)));
    const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json']));
    assert.deepEqual(manifest.dshVersions, ['0.1.0', '0.2.0']);
    assert.equal(manifest.launchers.dshl, '0.1.1.2');
    assert.deepEqual(manifest.launchers['official-desktop'], { supported: false, reason: 'uses native hooks' });
    assert.deepEqual(validateManifest(manifest), []);

    // dshVersion 不在 dshVersions 集合内 → 打包前强校验报错
    await assert.rejects(
      () => packProfile(fsHost(), { name: 'demo', dir }, {
        out, force: true, vendor: 'off',
        dshVersion: '0.9.9',
        dshVersions: ['0.1.0'],
      }),
      /必须 ∈ dshVersions/,
    );
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});

/* ------------------- full 档传递闭包收集（v3 §8.6 打包端义务 / §12 约束 1 闭包规则） ------------------- */

test('lockfilePackageEntries：name@version 解析（scoped / git / 别名 / 跨区块去重）', () => {
  const text = lockfile(
    ['dsh-pet@0.2.0-local.1', '@scope/pkg@1.0.0', 'fflate@0.8.2', 'theme@github:owner/repo#abc123'],
    ['dsh-pet@0.2.0-local.1', 'fflate@0.8.3', 'alias-pkg@npm:real@2.0.0'],
  );
  const entries = lockfilePackageEntries(text);
  assert.ok(entries);
  const by = Object.fromEntries(entries.map((e) => [`${e.name}@${e.version}`, e]));
  assert.deepEqual(by['@scope/pkg@1.0.0'], { name: '@scope/pkg', version: '1.0.0' });
  assert.deepEqual(by['fflate@0.8.2'], { name: 'fflate', version: '0.8.2' });
  // 同名不同版本（packages 与 snapshots 各一条）都保留
  assert.deepEqual(by['fflate@0.8.3'], { name: 'fflate', version: '0.8.3' });
  // git 条目：版本为 `github:...` 整段
  assert.deepEqual(by['theme@github:owner/repo#abc123'], { name: 'theme', version: 'github:owner/repo#abc123' });
  // 别名条目：name = 别名，version = `npm:real@x.y.z`
  assert.deepEqual(by['alias-pkg@npm:real@2.0.0'], { name: 'alias-pkg', version: 'npm:real@2.0.0' });
  // 同名同版本跨 packages/snapshots 去重：dsh-pet 只出现一次
  assert.equal(entries.filter((e) => e.name === 'dsh-pet').length, 1);
  // 无 packages 条目 → null
  assert.equal(lockfilePackageEntries("lockfileVersion: '9.0'\nimporters:\n  .:\n"), null);
  // lockfilePackageNames 仍是包名投影（既有调用方兼容）
  const names = lockfilePackageNames(text);
  assert.deepEqual([...names].sort(), ['@scope/pkg', 'alias-pkg', 'dsh-pet', 'fflate', 'theme']);
});

test('闭包条目对账放行：validateManifest opts.lockText / resolveVendoredPlan 读包内 lockfile', async () => {
  const petTgz = buildTarball({ 'package/package.json': '{"name":"dsh-pet","version":"0.2.0-local.1"}' });
  const fflateTgz = buildTarball({ 'package/package.json': '{"name":"fflate","version":"0.8.2"}' });
  const lock = lockfile(['dsh-pet@0.2.0-local.1', 'fflate@0.8.2']);
  const m = baseManifest({
    vendored: {
      'dsh-pet': { version: '0.2.0-local.1', sha256: sha256(petTgz), size: petTgz.length, path: 'vendor/npm__dsh-pet/dsh-pet-0.2.0-local.1.tgz' },
      // 闭包条目：key = npm 包名，不在 dependencies 中
      'fflate': { version: '0.8.2', sha256: sha256(fflateTgz), size: fflateTgz.length, path: 'vendor/fflate/fflate-0.8.2.tgz' },
    },
  });

  // 不带 lockText：闭包条目对账失败
  assert.ok(validateManifest(m).some((e) => e.includes('不在 dependencies ∪ lockfile packages')));
  // 带 lockText：闭包条目放行（无 dependencies 钉死版本 → 跳过版本一致性检查）
  assert.deepEqual(validateManifest(m, { lockText: lock }), []);
  // lockfile 中也无此包 → 仍失败
  const lockNoFflate = lockfile(['dsh-pet@0.2.0-local.1']);
  assert.ok(validateManifest(m, { lockText: lockNoFflate }).some((e) => e.includes('不在 dependencies ∪ lockfile packages')));

  // resolveVendoredPlan：读 entries['pnpm-lock.yaml'] 自动放行，闭包条目参与覆盖判定
  const entries = {
    'pnpm-lock.yaml': encodeText(lock),
    'vendor/npm__dsh-pet/dsh-pet-0.2.0-local.1.tgz': petTgz,
    'vendor/fflate/fflate-0.8.2.tgz': fflateTgz,
  };
  const plan = await resolveVendoredPlan(fsHost(), m, entries);
  assert.equal(plan.active, true);
  assert.equal(computeOfflineCoverage(lock, plan).complete, true);
  // 包内 lockfile 不含闭包条目 → 装前拒装
  await assert.rejects(
    () => resolveVendoredPlan(fsHost(), m, { ...entries, 'pnpm-lock.yaml': encodeText(lockNoFflate) }),
    /对账失败/,
  );
});

test('collectVendoredForExport：full 档闭包取件（registry 原件）→ vendor/ + sha/size + key = 包名', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-closure-'));
  try {
    const { dir } = await makeProfileWithDeps(home);
    const dshPetTgz = buildTarball({ 'package/package.json': '{"name":"dsh-pet","version":"0.2.0"}' });
    const fflateTgz = buildTarball({ 'package/package.json': '{"name":"fflate","version":"0.8.2"}' });
    const host = fsHost({
      async download(url, dest) {
        const tgz = url.includes('dsh-pet') ? dshPetTgz : fflateTgz;
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.writeFile(dest, tgz);
      },
    });
    const lock = lockfile(['dsh-pet@0.2.0', 'fflate@0.8.2']);
    const vr = await collectVendoredForExport(host, [dir], { 'dsh-pet': '0.2.0' }, { 'dsh-pet': 'explicit' }, {
      closure: true,
      lockText: lock,
    });

    // 直接依赖 dsh-pet：registry 原件，版本不变
    assert.equal(vr.vendored['dsh-pet'].version, '0.2.0');
    // 闭包条目 fflate：key = npm 包名，进 vendor/，sha/size 与原件一致
    const e = vr.vendored['fflate'];
    assert.ok(e, '闭包条目按包名登记');
    assert.equal(e.version, '0.8.2');
    assert.equal(e.sha256, sha256(fflateTgz));
    assert.equal(e.size, fflateTgz.length);
    assert.equal(e.path, 'vendor/fflate/fflate-0.8.2.tgz');
    assert.equal(vr.entries[e.path].length, fflateTgz.length, '归档条目 = 原件字节');
    // 闭包条目不进 dependencies（版本基准是 lockfile，非 manifest 钉死）
    assert.equal(vr.dependencies['fflate'], undefined);
    assert.equal(vr.dependencies['dsh-pet'], '0.2.0');
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});

test('collectVendoredForExport：闭包取件 .pnpm 重打包回退（保持 lockfile 版本）/ 双失败 skip + note', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-closure-pnpm-'));
  try {
    const { dir } = await makeProfileWithDeps(home);
    // .pnpm 虚拟 store：普通包 + scoped 包（目录名 `/` → `+` 编码）
    const store = path.join(dir, 'node_modules', '.pnpm');
    await fsp.mkdir(path.join(store, 'fflate@0.8.2', 'node_modules', 'fflate'), { recursive: true });
    await fsp.writeFile(path.join(store, 'fflate@0.8.2', 'node_modules', 'fflate', 'package.json'), '{"name":"fflate","version":"0.8.2"}');
    await fsp.writeFile(path.join(store, 'fflate@0.8.2', 'node_modules', 'fflate', 'index.js'), 'export const x = 1;');
    await fsp.mkdir(path.join(store, '@scope+util@1.0.0', 'node_modules', '@scope', 'util'), { recursive: true });
    await fsp.writeFile(path.join(store, '@scope+util@1.0.0', 'node_modules', '@scope', 'util', 'package.json'), '{"name":"@scope/util","version":"1.0.0"}');

    const deadHost = fsHost({ async download() { throw new Error('HTTP 404'); } });
    const lock = lockfile(['fflate@0.8.2', '@scope/util@1.0.0', 'left-pad@1.3.0']);
    const vr = await collectVendoredForExport(deadHost, [dir], {}, {}, { closure: true, lockText: lock });

    // fflate：.pnpm 重打包，**保持 lockfile 版本**（闭包条目不加 -local 后缀）
    const e = vr.vendored['fflate'];
    assert.ok(e, '.pnpm 命中应重打包');
    assert.equal(e.version, '0.8.2');
    const tp = JSON.parse(new TextDecoder().decode(untar(vr.entries[e.path])['package/package.json']));
    assert.equal(tp.version, '0.8.2');
    assert.equal(tp.name, 'fflate');
    assert.equal(e.sha256, sha256(vr.entries[e.path]));
    assert.equal(e.size, vr.entries[e.path].length);
    assert.ok(vr.notes.some((n) => n.includes('fflate') && n.includes('.pnpm')), '重打包回退应有提示');

    // scoped：经 `+` 编码命中 .pnpm
    const se = vr.vendored['@scope/util'];
    assert.ok(se, 'scoped 闭包条目应命中 .pnpm');
    assert.equal(se.version, '1.0.0');
    assert.ok(se.path.startsWith('vendor/__scope__util/'), `scoped 坐标编码：${se.path}`);
    assert.ok(se.path.endsWith('util-1.0.0.tgz'));

    // left-pad：registry 与 .pnpm 均无原件 → skip + note（宁缺勿错，coverage 如实判缺）
    assert.ok(!vr.vendored['left-pad']);
    assert.ok(vr.notes.some((n) => n.includes('left-pad') && n.includes('跳过')));
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});

test('packProfile：vendor=full → 直接依赖 + 闭包 vendor/，产物校验放行 + 覆盖判定 complete', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-full-'));
  try {
    const { dir } = await makeProfileWithDeps(home);
    const lock = lockfile([
      'dsh-pet@0.2.0',
      'other-theme@github:Other/theme#abcdef123',
      'dafy-whale-theme@0.3.0-local.1',
      'fflate@0.8.2',
    ]);
    await fsp.writeFile(path.join(dir, 'pnpm-lock.yaml'), lock);
    const dshPetTgz = buildTarball({ 'package/package.json': '{"name":"dsh-pet","version":"0.2.0"}' });
    const fflateTgz = buildTarball({ 'package/package.json': '{"name":"fflate","version":"0.8.2"}' });
    const host = fsHost({
      async download(url, dest) {
        const tgz = url.includes('dsh-pet') ? dshPetTgz : url.includes('fflate') ? fflateTgz : null;
        if (!tgz) throw new Error(`意外取件：${url}`);
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.writeFile(dest, tgz);
      },
    });
    const r = await packProfile(host, { name: 'demo', dir }, {
      out: path.join(home, 'out'),
      force: true,
      vendor: 'full',
    });

    // 三个直接依赖（npm / git / round-trip）+ 闭包 fflate
    assert.deepEqual([...r.vendored].sort(), ['dsh-pet', 'fflate', 'github:DViridescent/dafy-whale-theme', 'github:Other/theme']);

    // 读回产物验证
    const { entries } = parseDspack(new Uint8Array(await fsp.readFile(r.output)));
    const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json']));
    const e = manifest.vendored['fflate'];
    assert.ok(e, '闭包条目进 manifest.vendored');
    assert.equal(e.version, '0.8.2');
    assert.equal(e.sha256, sha256(fflateTgz));
    assert.equal(e.size, fflateTgz.length);
    assert.equal(entries[e.path].length, fflateTgz.length);
    assert.ok(entries['pnpm-lock.yaml'], 'lockfile 随包进归档（根机器文件）');
    // 导出产物可被自家校验器通过（闭包条目按 lockfile 放行）
    assert.deepEqual(validateManifest(manifest, { lockText: lock }), []);
    // 安装端视角：阶段 0 对账放行 + 闭包覆盖判定 complete
    const plan = await resolveVendoredPlan(fsHost(), manifest, entries);
    assert.equal(plan.active, true);
    assert.equal(computeOfflineCoverage(lock, plan).complete, true);
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});
