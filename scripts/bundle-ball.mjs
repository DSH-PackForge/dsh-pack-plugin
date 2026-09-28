// 构建悬浮球脚本（浏览器 iife，单文件、无 import、无外部依赖）。
// 为什么要 bundle 而不是直接下发 src/ball.js：源文件是 ESM（import channel.js 常量），
// 浏览器里以 <script> 加载会因裸 import 直接报错。打包后 lib/ball.js 自包含，
// 由宿主路由 /dsh-pack/ball.js 下发（见 src/ball-host.js、src/rpc.js）。
// 与 bundle-client.mjs 的区别：这里不依赖 shell 的 __ModuleLoader__，不在 external 里放任何东西。
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'lib', 'ball.js');

await build({
  entryPoints: [path.join(ROOT, 'src', 'ball-entry.js')],
  outfile: OUT,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  logLevel: 'warning',
});

console.log('[bundle-ball] wrote', OUT);
