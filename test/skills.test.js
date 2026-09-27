import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVIDER_NAME,
  createDspackSkillProvider,
  publishToGithub,
} from '../src/skills/index.js';
import { inject } from '../src/index.js';

test('skill provider：list 返回 publish-to-github 一个候选', async () => {
  const provider = createDspackSkillProvider();
  assert.equal(provider.name, PROVIDER_NAME);
  const candidates = await provider.list({});
  assert.equal(candidates.length, 1);
  const c = candidates[0];
  assert.equal(c.name, 'publish-to-github');
  assert.equal(c.provider, PROVIDER_NAME);
  assert.equal(c.invocation.modelInvocable, true);
  assert.equal(c.invocation.userInvocable, true);
  assert.equal(typeof c.locator, 'string');
  assert.ok(c.description.length > 0);
});

test('skill provider：get 返回正文并含发布硬约束', async () => {
  const provider = createDspackSkillProvider();
  const [c] = await provider.list({});
  const def = await provider.get(c);
  assert.ok(def, 'get 应返回定义');
  assert.equal(def.name, 'publish-to-github');
  for (const kw of ['gh repo create', '--public', 'dsh-pack', 'gh release create', 'v<version>', '.sha256']) {
    assert.ok(def.content.includes(kw), `正文应含「${kw}」`);
  }
});

test('skill provider：get 未知名返回 undefined', async () => {
  const provider = createDspackSkillProvider();
  assert.equal(await provider.get({ name: 'nope' }), undefined);
});

test('skill provider：list 尊重 abort 信号', async () => {
  const provider = createDspackSkillProvider();
  const aborted = new AbortController();
  aborted.abort();
  assert.deepEqual(await provider.list({ signal: aborted.signal }), []);
});

test('skill 元数据：invocation 触发词并进 whenToUse', () => {
  assert.equal(publishToGithub.name, 'publish-to-github');
  assert.ok(publishToGithub.whenToUse.includes('触发词'));
  assert.ok(publishToGithub.whenToUse.includes('publish to github'));
  assert.ok(publishToGithub.content.startsWith('# 发布整合包到 GitHub'));
});

test('host 注入列表含 skills', () => {
  assert.ok(inject.includes('skills'));
  assert.ok(inject.includes('connection'));
  assert.ok(inject.includes('webServer'));
});
