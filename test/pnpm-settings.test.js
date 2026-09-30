// pnpm-workspace.yaml 与随包 lockfile 的一致性测试（v3 r3 §8.6.8 + 两条实测）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { lockfileSettings, syncWorkspaceSettings } from '../src/core/pnpm-settings.js';

const LOCK = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: false
  excludeLinksFromLockfile: false

importers:

  .:
    dependencies:
      dsh-pet:
        specifier: 0.2.0
        version: 0.2.0
`;

test('lockfileSettings：取出 settings 区块的标量键值，不越到后面的区块', () => {
  assert.deepEqual(lockfileSettings(LOCK), { autoInstallPeers: 'false', excludeLinksFromLockfile: 'false' });
  assert.deepEqual(lockfileSettings('lockfileVersion: 9.0\n'), {});
  assert.deepEqual(lockfileSettings(''), {});
});

test('syncWorkspaceSettings：包内没有该文件时也产出合法的 minimumReleaseAge: 0', () => {
  const out = syncWorkspaceSettings('', LOCK);
  assert.match(out, /^autoInstallPeers: false$/m);
  assert.match(out, /^minimumReleaseAge: 0$/m);
  assert.ok(out.endsWith('\n'));
});

test('syncWorkspaceSettings：镜像 lockfile 的 settings（修 ERR_PNPM_LOCKFILE_CONFIG_MISMATCH）', () => {
  // 实测：lockfile 写 autoInstallPeers: false 而目标机默认 true 时，pnpm 11 直接拒装。
  // 把 settings 写进包内 pnpm-workspace.yaml 之后两边一致 → frozen 才可能在别的机器上成立。
  const out = syncWorkspaceSettings('minimumReleaseAge: 0\n', LOCK);
  assert.match(out, /^autoInstallPeers: false$/m);
  assert.match(out, /^excludeLinksFromLockfile: false$/m);
  assert.equal(out.match(/minimumReleaseAge/g).length, 1, '不得重复写入 minimumReleaseAge');
});

test('syncWorkspaceSettings：已有键就地替换（不追加重复键），并保留其它配置', () => {
  const ws = 'autoInstallPeers: true\nshamefullyHoist: true\nminimumReleaseAge: 1440\n';
  const out = syncWorkspaceSettings(ws, LOCK);
  assert.match(out, /^autoInstallPeers: false$/m, 'lockfile 说是 false → 覆盖成 false');
  assert.match(out, /^shamefullyHoist: true$/m, '无关配置保留');
  assert.match(out, /^minimumReleaseAge: 0$/m, '冷静期强制归零（kebab/--config.* 都无效，只有这个键有效）');
  assert.equal(out.match(/autoInstallPeers/g).length, 1);
  assert.equal(out.match(/minimumReleaseAge/g).length, 1);
});

test('syncWorkspaceSettings：lockfile 没有 settings 区块时不凭空造键', () => {
  const out = syncWorkspaceSettings('', "lockfileVersion: '9.0'\n");
  assert.equal(out, 'minimumReleaseAge: 0\n');
});
