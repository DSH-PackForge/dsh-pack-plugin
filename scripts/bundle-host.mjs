// 构建 DSH host 插件 bundle（零外部依赖版）。
// 把 src/index.js 的整条 node 依赖图（fflate / proxy-agent / proxy-from-env 及其传递依赖）
// 用 esbuild 内联进单一 lib/host.js，让管理器自包含——迁装（ensure-manager）只需搬一个目录，
// 不再需要手工同步「顶层依赖清单」（这正是 f91f375 加入 proxy-agent 后 MANAGER_DEPS 只留
// fflate、导致切换整合包后 failed to import 的根因）。
// 与 bundle-client.mjs 同套路；区别：platform 用 node（node: 内建 external，其余 bundle）。
import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = path.join(ROOT, 'lib');

// proxy-agent 的 CJS 传递依赖（debug 等）里有 require('tty')/require('util') 这类对 node 内建的
// require。esbuild 打成 ESM 时会把它们转成 __require(...)，而 ESM 里没有 require → 运行时抛
// "Dynamic require of ... is not supported"。这里在产物头部注入一个 createRequire 出的 require，
// 让 __require 的兜底分支（typeof require !== 'undefined'）真正可用。
const banner = [
  `import { createRequire as __cjsCreateRequire } from 'node:module';`,
  `const require = __cjsCreateRequire(import.meta.url);`,
  ``,
].join('\n');

const shared = {
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  logLevel: 'warning',
  banner: { js: banner },
};

// 入口一：宿主插件本体（cordis 加载）。
await build({
  ...shared,
  entryPoints: [path.join(ROOT, 'src', 'index.js')],
  outfile: path.join(LIB, 'host.js'),
});

// 入口二：脱管迁移 helper（migrate.js 用 ELECTRON_RUN_AS_NODE=1 process.execPath 直接派生）。
// 它 import 了 ./junction.js / ./progress.js 等源文件，得像宿主一样打成自包含单文件，否则
// 迁到 lib/ 后相对 import 全部悬空。打成 lib/migrate-helper.js 后，migrate.js 里
// `new URL('./migrate-helper.js', import.meta.url)`（import.meta.url 现在是 lib/host.js）才能命中。
await build({
  ...shared,
  entryPoints: [path.join(ROOT, 'src', 'migrate-helper.js')],
  outfile: path.join(LIB, 'migrate-helper.js'),
});

// 运行时资源：这些不是被 import 的模块，而是 progress.js / progress-main.cjs 用文件路径派生/加载的
// 独立资源，打包后 import.meta.url / __dirname 都指向 lib/，故把源文件平移到 lib/ 同目录：
//  - progress-main.cjs：electron GUI 进度窗执行体（spawn(process.execPath, [MAIN, ...])）
//  - progress-window.ps1：打包态 PowerShell WPF 进度窗
//  - progress.html：progress-main.cjs 用 __dirname 加载的渲染页
//  - publish-to-github/SKILL.md：skills/index.js 用 new URL('./publish-to-github/SKILL.md', ...) 定位
mkdirSync(path.join(LIB, 'publish-to-github'), { recursive: true });
for (const f of [
  'progress-main.cjs',
  'progress-window.ps1',
  'progress.html',
]) {
  cpSync(path.join(ROOT, 'src', f), path.join(LIB, f));
}
cpSync(
  path.join(ROOT, 'src', 'skills', 'publish-to-github', 'SKILL.md'),
  path.join(LIB, 'publish-to-github', 'SKILL.md'),
);

console.log('[bundle-host] wrote', path.join(LIB, 'host.js'), 'and', path.join(LIB, 'migrate-helper.js'));
