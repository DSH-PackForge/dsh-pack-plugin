// host bundle 回归测试：守卫「自包含」不变量。
// 根因背景：host-node.js 顶层静态 import proxy-agent / proxy-from-env（f91f375 加入），
// 但 ensure-manager 的顶层依赖清单 MANAGER_DEPS 只搬 fflate，导致切换整合包迁装管理器后
// 缺依赖 → 插件 import 阶段抛 ERR_MODULE_NOT_FOUND → cordis 记「failed to import」。
// 修复 = 用 esbuild 把整条 node 依赖图内联进 lib/host.js（零外部依赖），迁装只需搬一个目录。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { builtinModules } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const bundle = join(here, '..', 'lib', 'host.js');
const helperBundle = join(here, '..', 'lib', 'migrate-helper.js');

const built = existsSync(bundle);
// node 内建（esbuild 会以 bare 'fs'/'http' 等 external，不带 node: 前缀）——运行在 Node 宿主里始终可解析。
const BUILTINS = new Set(builtinModules.map((m) => m.replace(/^node:/, '')));

test('host bundle：可独立 import 并导出 {name, inject, apply}', async () => {
  if (!built) {
    test('(跳过：先运行 `pnpm bundle` 生成 lib/host.js)', () => {});
    return;
  }
  // 这是核心回归：若 proxy-agent / proxy-from-env 未被内联（残留外部裸 import），
  // import() 会在模块求值阶段抛 ERR_MODULE_NOT_FOUND——与线上「failed to import」同源。
  const m = await import(pathToFileURL(bundle).href);
  assert.equal(m.name, 'dspack-host');
  assert.deepEqual(m.inject, ['connection', 'webServer', 'skills']);
  assert.equal(typeof m.apply, 'function');
});

test('host bundle：无残留外部裸 import（fflate/proxy-agent/proxy-from-env 均已内联）', () => {
  if (!built) return;
  const txt = readFileSync(bundle, 'utf8');
  // 只查静态 import/export（模块求值期就会解析、漏了就 failed to import）。
  // 动态 import('kerberos') 在 proxy-agent-negotiate 里是 try/catch 的可选 NTLM 认证路径，不算。
  const staticRe = /(?:^|\n)\s*(?:import|export)\s+[^'"]*from\s*['"]([^'"]+)['"]/g;
  for (const m of txt.matchAll(staticRe)) {
    const spec = m[1];
    const bare = spec.replace(/^node:/, '');
    const isBuiltin = BUILTINS.has(bare) || BUILTINS.has(`${bare.replace(/\//g, '')}`);
    assert.ok(
      spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:') || isBuiltin,
      `host bundle 残留外部静态 import：${spec}`,
    );
  }
});

// 迁装回归（修复「自动重启失效/一直显示切换中」）：migrate.js 用
// `new URL('./migrate-helper.js', import.meta.url)` 定位 helper，打包后 import.meta.url 指向
// lib/host.js，故 helper 必须作为第二个 bundle 入口落在 lib/migrate-helper.js（及其内联依赖）。
// 注意：不能 import() 它——migrate-helper.js 顶层即触发 main()，会真的跑迁移逻辑。
test('migrate-helper bundle：存在且无残留外部静态 import', () => {
  if (!built) return;
  assert.ok(existsSync(helperBundle), '缺少 lib/migrate-helper.js（bundle-host.mjs 第二入口）');
  const txt = readFileSync(helperBundle, 'utf8');
  const staticRe = /(?:^|\n)\s*(?:import|export)\s+[^'"]*from\s*['"]([^'"]+)['"]/g;
  for (const m of txt.matchAll(staticRe)) {
    const spec = m[1];
    const bare = spec.replace(/^node:/, '');
    const isBuiltin = BUILTINS.has(bare) || BUILTINS.has(`${bare.replace(/\//g, '')}`);
    assert.ok(
      spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:') || isBuiltin,
      `migrate-helper bundle 残留外部静态 import：${spec}`,
    );
  }
});

// 进度窗资源：progress.js / progress-main.cjs 用文件路径定位独立资源，打包后路径基准变 lib/，
// 这些资源必须被平移复制到 lib/ 同目录，否则「杀进程/重新创建链接/拉起」进度窗起不来、切换卡住。
test('进度窗资源：progress-main.cjs / progress-window.ps1 / progress.html 已复制到 lib/', () => {
  if (!built) return;
  for (const f of ['progress-main.cjs', 'progress-window.ps1', 'progress.html']) {
    assert.ok(existsSync(join(here, '..', 'lib', f)), `缺少 lib/${f}（bundle-host.mjs 未复制）`);
  }
});
