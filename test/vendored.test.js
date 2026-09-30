// v5 r3（vendored / dshVersions / launchers）**导入侧**测试——**只覆盖导入侧**（能装带 vendor/ 的包）：
// - manifest 校验（结构 + 双向对账 + 版本一致性 + 三条新拒装：裸键 / 缺 vendored 条目 / 来源冲突）；
// - resolveVendoredPlan 阶段 0 预检（sha256/size、键形态 `vendor:<包名>` 与闭包键 `name@version`、
//   tarball 内 name/version 三处一致、闭包条目按随包 pnpm-lock.yaml 反查防夹带、方言归一、显式优先）；
// - resolveDshVersion 交集决策；
// - computeOfflineCoverage 版本敏感覆盖判定（missing 为 `name@version`）；
// - installPack 端到端（file: 改写 + 本地化后 frozen+trust + 方言直挂，pnpm 以 stub 替身）。
//
// 产包侧（依赖清单分类 / 闭包取件 / codeload 原件 / 上游三态探测 / 离线可装性自检 / vendor 档位）
// 在本分支已随之删除，其测试见 `feat/vendoring` 分支：test/vendored-packer-r3.test.js，以及该分支
// vendored.test.js 里的 collectVendoredForExport / listProfileDependencies / expandVendorSelection /
// packProfile vendor 档位诸用例。本文件不再重复覆盖产包路径。
import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { gzipSync } from 'fflate';
import { validateManifest } from '../src/core/manifest.js';
import { resolveVendoredPlan, isDialectSpec, lockfilePackageNames, lockfilePackageEntries, computeOfflineCoverage, blobRelPath } from '../src/core/vendored.js';
import { resolveDshVersion, installPack } from '../src/core/install.js';
import { packProfile } from '../src/core/pack.js';
import { buildDspack, encodeText, parseDspack } from '../src/core/dspack.js';
import { buildTarball } from '../src/core/tar.js';

/* ------------------- 测试工具 ------------------- */

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
    /** pnpm lockfile 的 integrity payload（本地化时要现算 sha512 覆盖）。 */
    async sha512(data) { return crypto.createHash('sha512').update(data).digest('base64'); },
    async sha256File(p) { return sha256(await fsp.readFile(p)); },
    async move(from, to) { await fsp.mkdir(path.dirname(to), { recursive: true }); await fsp.rename(from, to); },
    ...extra,
  };
}

/** 最小合法 v5 profile manifest（可叠加 r3 字段）。 */
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

/**
 * r3 直接依赖夹具：键 = `vendor:<包名>`，`dependencies` 与 `vendored` 用**同一个键**（v5 r3 §2）。
 * 对应 tarball 内的 `package/package.json` 必须同时写对 name 与 version（§12 约束 4 的包内侧）。
 */
function directVendored(tgz, opts = {}) {
  const name = opts.name ?? 'dsh-pet';
  const version = opts.version ?? '0.2.0-local.1';
  const path = opts.path ?? 'vendor/x.tgz';
  const key = `vendor:${name}`;
  return {
    dependencies: { [key]: opts.depVersion ?? version },
    vendored: {
      [key]: {
        version,
        sha256: opts.sha256 ?? sha256(tgz),
        size: opts.size ?? tgz.length,
        path,
        ...(opts.reason ? { reason: opts.reason } : {}),
      },
    },
  };
}

/** 造一个 tarball，其内 `package/package.json` 写全 name + version（r3 预检要求三处一致）。 */
function pkgTarball(name, version) {
  return buildTarball({ 'package/package.json': JSON.stringify(version === undefined ? { name } : { name, version }) });
}

/* ------------------- manifest 校验（r3 字段） ------------------- */

test('validateManifest：r3 三字段结构合法 → 通过', () => {
  const m = baseManifest({
    dshVersions: ['0.1.1-rc.2', '0.1.0'],
    launchers: { dshl: true, 'official-desktop': '0.1.1', 'dsh-cli': { supported: false, reason: 'x' } },
    // r3 §2：直接依赖的键 = `vendor:<包名>`，dependencies 与 vendored 同键
    ...directVendored(pkgTarball('dsh-pet', '0.2.0-local.1'), {
      path: 'vendor/npm__dsh-pet/dsh-pet-0.2.0-local.1.tgz',
      reason: 'local-modified',
    }),
  });
  assert.deepEqual(validateManifest(m), []);
});

test('validateManifest：r1 包（无 r2/r3 字段）照旧通过——前向兼容', () => {
  assert.deepEqual(validateManifest(baseManifest()), []);
});

test('validateManifest：vendored 对账失败 / 版本不一致 / 字段非法', () => {
  // vendor: 键不在 dependencies（dshhome 为各 profile 依赖并集）
  const bad1 = baseManifest({
    dependencies: {},
    vendored: { 'vendor:not-a-dep': { version: '1.0.0', sha256: 'a'.repeat(64), size: 1, path: 'vendor/x.tgz' } },
  });
  assert.ok(validateManifest(bad1).some((e) => e.includes('不在 dependencies')));

  const bad2 = baseManifest(directVendored(pkgTarball('dsh-pet', '0.2.0-local.1'), { version: '9.9.9', depVersion: '0.2.0-local.1' }));
  assert.ok(validateManifest(bad2).some((e) => e.includes('不一致')));

  const bad3 = baseManifest(directVendored(pkgTarball('dsh-pet', '0.2.0-local.1'), {
    sha256: 'xyz', size: 0, path: 'outside/x.tgz', reason: 'nope',
  }));
  const errs = validateManifest(bad3);
  assert.ok(errs.some((e) => e.includes('sha256')));
  assert.ok(errs.some((e) => e.includes('size')));
  assert.ok(errs.some((e) => e.includes('vendor/')));
  assert.ok(errs.some((e) => e.includes('reason')));
});

test('validateManifest：r3 三条新拒装——裸键 / 缺 vendored 条目 / 来源冲突', () => {
  // ① vendored 裸键（`dsh-pet` 配 vendored['dsh-pet']）= 已废弃的 r2 形态 → 拒装
  const bare = baseManifest({
    vendored: { 'dsh-pet': { version: '0.2.0-local.1', sha256: 'a'.repeat(64), size: 1, path: 'vendor/x.tgz' } },
  });
  const bareErrs = validateManifest(bare);
  assert.ok(bareErrs.some((e) => e.includes('键非法') && e.includes('裸键是已废弃的 r2 形态')));

  // ② dependencies 有 vendor:X 但 vendored 缺 vendor:X 条目 → 拒装
  const missing = baseManifest({ dependencies: { 'vendor:dsh-pet': '0.2.0-local.1' } });
  assert.ok(validateManifest(missing).some((e) => e.includes('缺少对应的 vendored 条目')));

  // ③ 同一包名同时以裸键 X 与 vendor:X 出现 → 来源冲突（§2）
  const conflict = baseManifest({
    ...directVendored(pkgTarball('dsh-pet', '0.2.0-local.1')),
    dependencies: { 'dsh-pet': '0.2.0-local.1', 'vendor:dsh-pet': '0.2.0-local.1' },
  });
  assert.ok(validateManifest(conflict).some((e) => e.includes('来源冲突')));
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
  const tgz = pkgTarball('dsh-pet', '0.2.0-local.1');
  const m = baseManifest(directVendored(tgz, { path: 'vendor/npm__dsh-pet/dsh-pet-0.2.0-local.1.tgz' }));
  const entries = { 'vendor/npm__dsh-pet/dsh-pet-0.2.0-local.1.tgz': tgz };
  const plan = await resolveVendoredPlan(fsHost(), m, entries);
  assert.equal(plan.active, true);
  // r3 §2：`vendor:<包名>` 键归一为 kind:"direct" + 包名
  const e = plan.byCoord.get('vendor:dsh-pet');
  assert.equal(e.kind, 'direct');
  assert.equal(e.pkgName, 'dsh-pet');
  assert.equal(e.sha256, sha256(tgz));
  assert.equal(e.bytes.length, tgz.length);
});

test('resolveVendoredPlan：vendored 裸键（r2 废弃形态）→ 拒装', async () => {
  const tgz = pkgTarball('dsh-pet', '0.2.0-local.1');
  const m = baseManifest({
    vendored: { 'dsh-pet': { version: '0.2.0-local.1', sha256: sha256(tgz), size: tgz.length, path: 'vendor/x.tgz' } },
  });
  await assert.rejects(
    () => resolveVendoredPlan(fsHost(), m, { 'vendor/x.tgz': tgz }),
    /裸键是已废弃的 r2 形态/,
  );
});

test('resolveVendoredPlan：tarball 内 name / version 必须与键、声明版本一致（三处一致）', async () => {
  // 包名不符：键上只有包名，包里装的是另一个包
  const wrongName = pkgTarball('left-pad', '0.2.0-local.1');
  await assert.rejects(
    () => resolveVendoredPlan(fsHost(), baseManifest(directVendored(wrongName)), { 'vendor/x.tgz': wrongName }),
    /包名（left-pad）与键不符/,
  );
  // 版本不符：打包端漏了重算
  const wrongVersion = pkgTarball('dsh-pet', '9.9.9');
  await assert.rejects(
    () => resolveVendoredPlan(fsHost(), baseManifest(directVendored(wrongVersion)), { 'vendor/x.tgz': wrongVersion }),
    /与声明版本（0\.2\.0-local\.1）不一致/,
  );
  // 夹具漏写 version（r3 要求写全）→ 同样拒装
  const noVersion = pkgTarball('dsh-pet');
  await assert.rejects(
    () => resolveVendoredPlan(fsHost(), baseManifest(directVendored(noVersion)), { 'vendor/x.tgz': noVersion }),
    /与声明版本（0\.2\.0-local\.1）不一致/,
  );
  // 无可读 name
  const noName = buildTarball({ 'package/package.json': '{}' });
  await assert.rejects(
    () => resolveVendoredPlan(fsHost(), baseManifest(directVendored(noName)), { 'vendor/x.tgz': noName }),
    /缺失或无可读 name/,
  );
});

test('resolveVendoredPlan：闭包条目必须 kind:"closure" + name，且能按 name@version 反查随包 lockfile', async () => {
  const fflateTgz = pkgTarball('fflate', '0.8.2');
  const lock = lockfile(['fflate@0.8.2']);
  const closure = {
    kind: 'closure',
    name: 'fflate',
    version: '0.8.2',
    sha256: sha256(fflateTgz),
    size: fflateTgz.length,
    path: 'vendor/fflate/fflate-0.8.2.tgz',
  };
  const entries = { 'pnpm-lock.yaml': encodeText(lock), 'vendor/fflate/fflate-0.8.2.tgz': fflateTgz };
  const withClosure = (entry, key = 'fflate@0.8.2') => baseManifest({ vendored: { [key]: entry } });

  // 合法闭包条目：键 = name@version，kind/name 齐备，且不在 dependencies 里
  const plan = await resolveVendoredPlan(fsHost(), withClosure(closure), entries);
  const e = plan.byCoord.get('fflate@0.8.2');
  assert.equal(e.kind, 'closure');
  assert.equal(e.pkgName, 'fflate');
  assert.equal(e.version, '0.8.2');
  assert.equal(e.reason, undefined, '闭包条目不带 reason（r3 §12 约束 1）');
  assert.equal(e.bytes.length, fflateTgz.length);

  // 形如闭包键但未声明 kind:"closure"
  await assert.rejects(
    () => resolveVendoredPlan(fsHost(), withClosure({ ...closure, kind: undefined }), entries),
    /未声明 kind:"closure"/,
  );
  // 缺 name / name 与键不符
  await assert.rejects(
    () => resolveVendoredPlan(fsHost(), withClosure({ ...closure, name: undefined }), entries),
    /缺少 name/,
  );
  await assert.rejects(
    () => resolveVendoredPlan(fsHost(), withClosure({ ...closure, name: 'left-pad' }), entries),
    /的 name（left-pad）与键不符/,
  );
  // 带 vendor: 前缀的闭包键 → 键非法
  await assert.rejects(
    () => resolveVendoredPlan(fsHost(), withClosure(closure, 'vendor:fflate@0.8.2'), entries),
    /键非法/,
  );
  // 缺随包 lockfile → 无法反查来源（防夹带）→ 拒装
  await assert.rejects(
    () => resolveVendoredPlan(fsHost(), withClosure(closure), { 'vendor/fflate/fflate-0.8.2.tgz': fflateTgz }),
    /需要随包 pnpm-lock\.yaml/,
  );
  // lockfile 里没有该 name@version → 防夹带校验失败
  await assert.rejects(
    () => resolveVendoredPlan(
      fsHost(),
      withClosure(closure),
      { ...entries, 'pnpm-lock.yaml': encodeText(lockfile(['dsh-pet@0.2.0-local.1'])) },
    ),
    /不在随包 pnpm-lock\.yaml/,
  );
});

test('resolveVendoredPlan：sha256 / size 不符 → 装前拒装', async () => {
  const tgz = pkgTarball('dsh-pet', '0.2.0-local.1');
  const badSha = baseManifest(directVendored(tgz, { sha256: 'f'.repeat(64) }));
  await assert.rejects(
    () => resolveVendoredPlan(fsHost(), badSha, { 'vendor/x.tgz': tgz }),
    /sha256 校验失败/,
  );
  const badSize = baseManifest(directVendored(tgz, { size: tgz.length + 1 }));
  await assert.rejects(
    () => resolveVendoredPlan(fsHost(), badSize, { 'vendor/x.tgz': tgz }),
    /size 不符/,
  );
});

test('resolveVendoredPlan：vendor/ 未登记文件 / 非 .tgz / tarball 缺失 → 拒装', async () => {
  const tgz = pkgTarball('dsh-pet', '0.2.0-local.1');
  const m = baseManifest(directVendored(tgz, { path: 'vendor/a.tgz' }));
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

test('resolveVendoredPlan：vendor:<包名> 键不在 dependencies → 对账失败', async () => {
  const tgz = pkgTarball('dsh-pet', '0.2.0-local.1');
  const m = baseManifest({
    ...directVendored(tgz),
    dependencies: { 'other-pkg': '1.0.0' },
  });
  await assert.rejects(() => resolveVendoredPlan(fsHost(), m, { 'vendor/x.tgz': tgz }), /不在 dependencies/);
});

test('resolveVendoredPlan：DSHL 方言（vendor: spec + vendor.json）→ 隐式条目；显式条目接管', async () => {
  const tgz = pkgTarball('dsh-pet', '0.2.0');
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

  // 显式 `vendor:<包名>` 条目与方言并存：显式接管（r3 §8.5「显式条目优先」）
  // —— 方言隐式条目不得再以裸名键留在 byCoord；方言 tarball 由 vendor.json 声明，仍算「已登记」。
  const explicitTgz = pkgTarball('dsh-pet', '0.2.0');
  const both = baseManifest({
    dependencies: { 'vendor:dsh-pet': '0.2.0' },
    vendored: {
      'vendor:dsh-pet': {
        version: '0.2.0', sha256: sha256(explicitTgz), size: explicitTgz.length, path: 'vendor/npm__dsh-pet/dsh-pet-0.2.0.tgz',
      },
    },
  });
  const bothEntries = { ...entries, 'vendor/npm__dsh-pet/dsh-pet-0.2.0.tgz': explicitTgz };
  const plan2 = await resolveVendoredPlan(fsHost(), both, bothEntries);
  assert.equal(plan2.byCoord.has('dsh-pet'), false, '方言隐式条目被显式条目接管');
  const ge = plan2.byCoord.get('vendor:dsh-pet');
  assert.equal(ge.dialect, undefined);
  assert.equal(ge.kind, 'direct');
  assert.equal(ge.pkgName, 'dsh-pet');
  assert.equal(ge.path, 'vendor/npm__dsh-pet/dsh-pet-0.2.0.tgz');
});

test('resolveVendoredPlan：dshhome 形态对账聚合各 profile 依赖', async () => {
  const tgz = pkgTarball('dsh-pet', '0.2.0');
  const m = {
    manifestVersion: 5,
    type: 'dshhome',
    name: 'home-pack',
    version: '1.0.0',
    defaultProfile: 'a',
    profiles: {
      a: { bundles: [], dependencies: { 'vendor:dsh-pet': '0.2.0' } },
      b: { bundles: [], dependencies: {} },
    },
    vendored: { 'vendor:dsh-pet': { version: '0.2.0', sha256: sha256(tgz), size: tgz.length, path: 'vendor/x.tgz' } },
  };
  const plan = await resolveVendoredPlan(fsHost(), m, { 'vendor/x.tgz': tgz });
  assert.equal(plan.active, true);
});

/* ------------------- resolveDshVersion（r3 §13 决策） ------------------- */

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

test('installPack：显式 vendored → vendor-blobs 落盘 + package.json file: 改写 + frozen+trust（无 --prefer-offline）', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-vend-'));
  const profilesRoot = path.join(home, 'profiles');
  try {
    const tgz = buildTarball({
      'package/package.json': JSON.stringify({ name: 'dsh-pet', version: '0.2.0-local.1' }),
    });
    const manifest = baseManifest({
      dshVersion: '',
      ...directVendored(tgz, { path: 'vendor/npm__dsh-pet/dsh-pet-0.2.0-local.1.tgz', reason: 'local-modified' }),
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

    // vendor-blobs 实体落盘到**包名**子目录 + package.json spec 改写（r3 §2/§6）
    const target = path.join(profilesRoot, 'demo');
    const pkg = JSON.parse(await fsp.readFile(path.join(target, 'package.json'), 'utf8'));
    assert.equal(pkg.dependencies['dsh-pet'], 'file:vendor-blobs/dsh-pet/npm__dsh-pet/dsh-pet-0.2.0-local.1.tgz');
    assert.equal(pkg.dependencies['vendor:dsh-pet'], undefined, '`vendor:` 前缀不能漏进重建的 package.json');
    const blob = await fsp.readFile(path.join(target, 'vendor-blobs', 'dsh-pet', 'npm__dsh-pet', 'dsh-pet-0.2.0-local.1.tgz'));
    assert.equal(blob.length, tgz.length);
    // r3 §8.3：本地化后按规范走 frozen+trust；此夹具没有 lockfile → 无法 frozen，只带 --trust-lockfile
    assert.equal(calls.length, 1);
    assert.ok(calls[0].args.includes('--trust-lockfile'));
    assert.ok(!calls[0].args.includes('--prefer-offline'), 'r3 已删掉 --prefer-offline（来源由键唯一确定）');
    assert.ok(!calls[0].args.includes('--frozen-lockfile'), '无 lockfile 时不能 frozen');
    // 结果摘要：used 是 manifest 侧的 `vendor:<包名>` 键；显式条目不走直挂
    assert.equal(r.vendored.active, true);
    assert.deepEqual(r.vendored.used, ['vendor:dsh-pet']);
    assert.deepEqual(r.vendored.mounted, []);
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
    assert.ok(calls[0].args.includes('--trust-lockfile'));
    assert.ok(!calls[0].args.includes('--prefer-offline'), 'r3 已删掉 --prefer-offline');
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});

test('installPack：方言 + 显式 vendor:<包名> 并存 → 显式接管（file: 改写），不再直挂', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-dialect-explicit-'));
  const profilesRoot = path.join(home, 'profiles');
  try {
    const explicitTgz = buildTarball({ 'package/package.json': JSON.stringify({ name: 'dsh-pet', version: '0.2.0' }) });
    const dialectTgz = buildTarball({
      'package/package.json': JSON.stringify({ name: 'dsh-pet', version: '0.2.0', dsh: { bundle: { patch: 'p.yml' } } }),
      'package/p.yml': 'plugins: []',
    });
    const manifest = baseManifest({
      dependencies: { 'vendor:dsh-pet': '0.2.0' },
      vendored: {
        'vendor:dsh-pet': {
          version: '0.2.0', sha256: sha256(explicitTgz), size: explicitTgz.length, path: 'vendor/npm__dsh-pet/dsh-pet-0.2.0.tgz',
        },
      },
    });
    const zip = buildDspack({
      'dspack.json': encodeText(JSON.stringify({ format: 'dspack', version: 3 })),
      'manifest.json': encodeText(JSON.stringify(manifest)),
      'vendor/vendor.json': encodeText(JSON.stringify({
        packages: [{ file: 'dsh-pet-0.2.0.tgz', name: 'dsh-pet', sha256: sha256(dialectTgz) }],
      })),
      'vendor/dsh-pet-0.2.0.tgz': dialectTgz,
      'vendor/npm__dsh-pet/dsh-pet-0.2.0.tgz': explicitTgz,
    });
    const packPath = path.join(home, 'demo-1.0.0.dspack');
    await fsp.writeFile(packPath, zip);

    const calls = [];
    const host = fsHost({ async pnpm(args) { calls.push({ args }); return { status: 0 }; } });
    const r = await installPack(host, { source: packPath, profilesRoot, force: true });

    // 显式条目接管：走统一算法（file: 改写），不再按方言直挂
    const target = path.join(profilesRoot, 'demo');
    const pkg = JSON.parse(await fsp.readFile(path.join(target, 'package.json'), 'utf8'));
    assert.equal(pkg.dependencies['dsh-pet'], 'file:vendor-blobs/dsh-pet/npm__dsh-pet/dsh-pet-0.2.0.tgz');
    assert.deepEqual(r.vendored.used, ['vendor:dsh-pet']);
    assert.deepEqual(r.vendored.mounted, []);
    assert.equal(await fsp.stat(path.join(target, 'node_modules', 'dsh-pet')).then(() => true, () => false), false);
    assert.ok(calls[0].args.includes('--trust-lockfile'));
    assert.ok(!calls[0].args.includes('--prefer-offline'), 'r3 已删掉 --prefer-offline');
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});

test('installPack：vendor/ 损坏（sha 不符）→ 阶段 0 拒装，不落任何文件', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-bad-'));
  const profilesRoot = path.join(home, 'profiles');
  try {
    const tgz = pkgTarball('dsh-pet', '0.2.0-local.1');
    const manifest = baseManifest(directVendored(tgz, { sha256: '0'.repeat(64) }));
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

test('computeOfflineCoverage：完整闭包 → complete；缺传递依赖 → 列出 name@version', async () => {
  const tgz = pkgTarball('dsh-pet', '0.2.0-local.1');
  const m = baseManifest(directVendored(tgz));
  const plan = await resolveVendoredPlan(fsHost(), m, { 'vendor/x.tgz': tgz });

  // lockfile 只有 dsh-pet → 闭包完整
  const full = computeOfflineCoverage(lockfile(['dsh-pet@0.2.0-local.1']), plan);
  assert.equal(full.complete, true);
  assert.deepEqual(full.missing, []);

  // lockfile 还要 fflate（dsh-pet 的传递依赖）→ 不完整；missing 为 `name@version`（r3 §8.3）
  const partial = computeOfflineCoverage(lockfile(['dsh-pet@0.2.0-local.1', 'fflate@0.8.2']), plan);
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.missing, ['fflate@0.8.2']);

  // git / file: 这类非 semver 版本段：按包名折算匹配
  const gitTgz = pkgTarball('dafy-whale-theme', '99e8c57');
  const mg = baseManifest({
    dependencies: { 'vendor:dafy-whale-theme': '99e8c57' },
    vendored: { 'vendor:dafy-whale-theme': { version: '99e8c57', sha256: sha256(gitTgz), size: gitTgz.length, path: 'vendor/g.tgz' } },
  });
  const planG = await resolveVendoredPlan(fsHost(), mg, { 'vendor/g.tgz': gitTgz });
  assert.equal(computeOfflineCoverage(lockfile(["dafy-whale-theme@github:DViridescent/dafy-whale-theme#99e8c57"]), planG).complete, true);

  // r1 包 / 无 lockfile → null（保持 --prefer-offline 不升级）
  assert.equal(computeOfflineCoverage(lockfile(['x@1.0.0']), { active: false, byCoord: new Map() }), null);
  assert.equal(computeOfflineCoverage(null, plan), null);
});

test('computeOfflineCoverage：版本敏感——同名不同版本不算覆盖（非 semver 段落按包名命中）', async () => {
  const tgz = pkgTarball('dsh-pet', '0.2.0-local.1');
  const m = baseManifest(directVendored(tgz));
  const plan = await resolveVendoredPlan(fsHost(), m, { 'vendor/x.tgz': tgz });

  // 版本级命中 → 覆盖
  assert.deepEqual(computeOfflineCoverage(lockfile(['dsh-pet@0.2.0-local.1']), plan).missing, []);

  // 同名不同版本：registry 版本（semver）必须 name@version 命中，同名不算覆盖（否则 --offline 缺件）
  const other = computeOfflineCoverage(lockfile(['dsh-pet@0.3.0']), plan);
  assert.equal(other.complete, false);
  assert.deepEqual(other.missing, ['dsh-pet@0.3.0']);

  // 非 semver 版本段（git / file:）：lockfile 里的版本段是 URL/路径，不是版本 → 按包名命中
  assert.deepEqual(computeOfflineCoverage(lockfile(['dsh-pet@github:owner/repo#abc123']), plan).missing, []);
  assert.deepEqual(computeOfflineCoverage(lockfile(['dsh-pet@file:vendor-blobs/dsh-pet/dsh-pet-0.2.0-local.1.tgz']), plan).missing, []);

  // 未内嵌的同名包名：非 semver 段也判缺（按名命中只对已内嵌包生效）
  assert.deepEqual(computeOfflineCoverage(lockfile(['fflate@github:owner/repo#abc123']), plan).missing, ['fflate@github:owner/repo#abc123']);
});

test('installPack：闭包完整 → pnpm install --offline（严格离线）', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-offline-'));
  const profilesRoot = path.join(home, 'profiles');
  try {
    const tgz = pkgTarball('dsh-pet', '0.2.0-local.1');
    const manifest = baseManifest(directVendored(tgz, { path: 'vendor/npm__dsh-pet/dsh-pet-0.2.0-local.1.tgz' }));
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
    assert.ok(calls[0].args.includes('--offline'), `应加零网络断言：${calls[0].args.join(' ')}`);
    assert.ok(calls[0].args.includes('--frozen-lockfile'), 'r3 §8.3：本地化后走 frozen');
    assert.ok(calls[0].args.includes('--trust-lockfile'));
    assert.ok(!calls[0].args.includes('--prefer-offline'), 'r3 已删掉 --prefer-offline');
    assert.equal(r.vendored.offline, true);
    // 关键：**盘上的 lockfile 真的被本地化了**（支 A 四处同步 + integrity 覆盖），
    // 否则 frozen 只是"碰巧"通过，接线可能悄悄没生效。
    const lockOut = await fsp.readFile(path.join(r.dir, 'pnpm-lock.yaml'), 'utf8');
    assert.ok(lockOut.includes('specifier: file:./vendor-blobs/dsh-pet/'), `importer specifier 应指向包内副本：${lockOut}`);
    assert.ok(lockOut.includes('tarball: file:vendor-blobs/dsh-pet/'), 'resolution.tarball 应指向包内副本');
    assert.ok(lockOut.includes("dsh-pet@file:vendor-blobs/dsh-pet/"), 'packages/snapshots 键应同步');
    assert.ok(!lockOut.includes('sha512-AAA'), '（若夹具带占位 integrity，应已被现算 sha512 覆盖）');
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});

test('installPack：闭包不完整（缺传递依赖）→ 仍 frozen+trust，但不加 --offline', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-partial-'));
  const profilesRoot = path.join(home, 'profiles');
  try {
    const tgz = pkgTarball('dsh-pet', '0.2.0-local.1');
    const manifest = baseManifest(directVendored(tgz, { path: 'vendor/npm__dsh-pet/dsh-pet-0.2.0-local.1.tgz' }));
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

    assert.ok(calls[0].args.includes('--trust-lockfile'));
    assert.ok(calls[0].args.includes('--frozen-lockfile'), '有 lockfile → r3 走 frozen');
    assert.ok(!calls[0].args.includes('--prefer-offline'), 'r3 已删掉 --prefer-offline');
    assert.ok(!calls[0].args.includes('--offline'));
    assert.equal(r.vendored.offline, false);
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});

/* ------------------- blob 落点命名（导入侧：file: spec 指向的路径） ------------------- */

test('blobRelPath：vendor-blobs 子目录取包名（npm 与 git 坐标一致）', () => {
  // npm 直接依赖：仍是 vendor-blobs/dsh-pet/...（与 r2 落点相同）
  assert.equal(
    blobRelPath('vendor:dsh-pet', { pkgName: 'dsh-pet', path: 'vendor/npm__dsh-pet/dsh-pet-0.2.0-local.1.tgz' }),
    'vendor-blobs/dsh-pet/npm__dsh-pet/dsh-pet-0.2.0-local.1.tgz',
  );
  // git 坐标来源：子目录取包名，不再取坐标编码
  assert.equal(
    blobRelPath('vendor:other-theme', { pkgName: 'other-theme', path: 'vendor/github__Other__theme/other-theme-1.0.0-local.1.tgz' }),
    'vendor-blobs/other-theme/github__Other__theme/other-theme-1.0.0-local.1.tgz',
  );
  // scoped 包名仍按 §8.1 编码
  assert.equal(
    blobRelPath('vendor:@scope/util', { pkgName: '@scope/util', path: 'vendor/__scope__util/util-1.0.0.tgz' }),
    'vendor-blobs/__scope__util/__scope__util/util-1.0.0.tgz',
  );
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
  // profile package.json（r3 §2：内嵌依赖的键 = 包名，与 tarball 内 name 一致）
  await fsp.writeFile(path.join(dir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-demo',
    dependencies: {
      'dsh-pet': '0.2.0',
      'other-theme': 'github:Other/theme#abcdef123',
      'dafy-whale-theme': 'file:vendor-blobs/github__DViridescent__dafy-whale-theme/dafy-whale-theme-0.3.0-local.1.tgz',
    },
    dsh: { profile: { bundles: [] } },
  }, null, 2));
  return { dir, blobTgz };
}

/* ------------------- dshVersions / launchers（与 vendoring 无关，主线保留） ------------------- */

test('packProfile：dshVersions + launchers 写入 manifest；dshVersion ∉ dshVersions → 导出报错', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'dspack-compat-'));
  try {
    const { dir } = await makeProfileWithDeps(home);
    const out = path.join(home, 'out');
    const r = await packProfile(fsHost(), { name: 'demo', dir }, {
      out,
      force: true,
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
        out, force: true,
        dshVersion: '0.9.9',
        dshVersions: ['0.1.0'],
      }),
      /必须 ∈ dshVersions/,
    );
  } finally {
    await fsp.rm(home, { recursive: true, force: true });
  }
});

/* ------------------- 闭包条目解析与对账（v5 r3 §12 约束 1 闭包规则） ------------------- */

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
  const petTgz = pkgTarball('dsh-pet', '0.2.0-local.1');
  const fflateTgz = pkgTarball('fflate', '0.8.2');
  const lock = lockfile(['dsh-pet@0.2.0-local.1', 'fflate@0.8.2']);
  const m = baseManifest({
    dependencies: { 'vendor:dsh-pet': '0.2.0-local.1' },
    vendored: {
      'vendor:dsh-pet': { version: '0.2.0-local.1', sha256: sha256(petTgz), size: petTgz.length, path: 'vendor/npm__dsh-pet/dsh-pet-0.2.0-local.1.tgz' },
      // 闭包条目：key = `name@version` + kind:"closure" + name，不在 dependencies 中
      'fflate@0.8.2': { kind: 'closure', name: 'fflate', version: '0.8.2', sha256: sha256(fflateTgz), size: fflateTgz.length, path: 'vendor/fflate/fflate-0.8.2.tgz' },
    },
  });

  // 不带 lockText：闭包条目无法反查来源（防夹带）→ 失败
  assert.ok(validateManifest(m).some((e) => e.includes('闭包条目需要随包 pnpm-lock.yaml')));
  // 带 lockText：闭包条目按 `name@version` 反查放行
  assert.deepEqual(validateManifest(m, { lockText: lock }), []);
  // lockfile 中也无此包 → 仍失败
  const lockNoFflate = lockfile(['dsh-pet@0.2.0-local.1']);
  assert.ok(validateManifest(m, { lockText: lockNoFflate }).some((e) => e.includes('不在随包 pnpm-lock.yaml')));

  // resolveVendoredPlan：读 entries['pnpm-lock.yaml'] 自动放行，闭包条目参与覆盖判定
  const entries = {
    'pnpm-lock.yaml': encodeText(lock),
    'vendor/npm__dsh-pet/dsh-pet-0.2.0-local.1.tgz': petTgz,
    'vendor/fflate/fflate-0.8.2.tgz': fflateTgz,
  };
  const plan = await resolveVendoredPlan(fsHost(), m, entries);
  assert.equal(plan.active, true);
  assert.equal(plan.byCoord.get('fflate@0.8.2').kind, 'closure');
  assert.equal(plan.byCoord.get('fflate@0.8.2').pkgName, 'fflate');
  assert.equal(computeOfflineCoverage(lock, plan).complete, true);
  // 包内 lockfile 不含闭包条目 → 装前拒装
  await assert.rejects(
    () => resolveVendoredPlan(fsHost(), m, { ...entries, 'pnpm-lock.yaml': encodeText(lockNoFflate) }),
    /不在随包 pnpm-lock\.yaml/,
  );
});
