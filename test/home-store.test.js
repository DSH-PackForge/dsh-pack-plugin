import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { storeHomeRel } from '../src/core/home-store.js';
import { scanProfile } from '../src/core/scan.js';
import { isExcluded } from '../src/core/security.js';
import { NodeHost } from '../src/host-node.js';

const host = new NodeHost();

test('storeHomeRel：skills / .agent-presets 重写到 .dsh-pack slot，其余原样', () => {
  const cases = [
    ['skills/foo.md', 'dflt', '.dsh-pack/skills/dflt/foo.md'],
    ['skills', 'dflt', '.dsh-pack/skills/dflt'],
    ['.agent-presets/bar/agent.cordis.yml', 'dflt', '.dsh-pack/agent-presets/dflt/bar/agent.cordis.yml'],
    ['.agent-presets', 'dflt', '.dsh-pack/agent-presets/dflt'],
    ['AGENTS.md', 'dflt', 'AGENTS.md'],
    ['data/x', 'dflt', 'data/x'],
  ];
  for (const [rel, name, want] of cases) {
    assert.equal(storeHomeRel(rel, name), want, `storeHomeRel(${rel}, ${name})`);
  }
});

test('isExcluded：.dsh-pack 整目录排除，skills 本身不排除', () => {
  assert.equal(isExcluded('.dsh-pack/skills/x/foo.md'), true);
  assert.equal(isExcluded('skills/foo.md'), false);
  assert.equal(isExcluded('.agent-presets/a/agent.cordis.yml'), false);
});

test('scanProfile：跟随 skills/.agent-presets 顶层 junction，跳过 profiles/desktop', async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'home-store-scan-'));
  try {
    const kind = process.platform === 'win32' ? 'junction' : 'dir';
    // 真实数据在 .dsh-pack slot 下
    await fsp.mkdir(path.join(tmp, '.dsh-pack', 'skills', 'dflt'), { recursive: true });
    await fsp.writeFile(path.join(tmp, '.dsh-pack', 'skills', 'dflt', 'foo.md'), 'x');
    await fsp.mkdir(path.join(tmp, '.dsh-pack', 'agent-presets', 'dflt', 'bar'), { recursive: true });
    await fsp.writeFile(path.join(tmp, '.dsh-pack', 'agent-presets', 'dflt', 'bar', 'agent.cordis.yml'), 'y');
    // profiles + desktop 换指指针
    await fsp.mkdir(path.join(tmp, 'profiles', 'dflt'), { recursive: true });
    await fsp.writeFile(path.join(tmp, 'profiles', 'dflt', 'package.json'), '{}');
    await fsp.symlink(path.join(tmp, '.dsh-pack', 'skills', 'dflt'), path.join(tmp, 'skills'), kind);
    await fsp.symlink(path.join(tmp, '.dsh-pack', 'agent-presets', 'dflt'), path.join(tmp, '.agent-presets'), kind);
    await fsp.symlink(path.join(tmp, 'profiles', 'dflt'), path.join(tmp, 'profiles', 'desktop'), kind);

    const rels = (await scanProfile(host, tmp)).files.map((f) => f.rel);
    assert.ok(rels.includes('skills/foo.md'), 'skills junction 未跟随');
    assert.ok(rels.includes('.agent-presets/bar/agent.cordis.yml'), '.agent-presets junction 未跟随');
    assert.ok(rels.includes('profiles/dflt/package.json'), '真实 profile 目录未扫描');
    assert.ok(!rels.some((r) => r.startsWith('profiles/desktop/')), 'desktop junction 应跳过');
    assert.ok(!rels.some((r) => r.startsWith('.dsh-pack/')), '.dsh-pack 应被排除');
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
