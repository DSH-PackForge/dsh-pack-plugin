# @dsh-packforge/dsh-pack-plugin

DSH 整合包（`.dspack`）的**纯方案 B 插件 bundle**：一个自包含的独立 npm 包，注入官方 DeepSeek Harness 桌面端，提供 `.dspack` 导出 / 安装 / 多 profile 切换。**只做 UI + 后端，不做 AI 驱动的整合包管理。**

- **零官方源码改动**：不改 `apps/desktop` / `apps/desktop-host`。
- **零第三方插件**：只依赖 DSH 出厂运行时服务（`ctx.connection.rpc` / `ctx.slots` / `ctx.locale` / `ctx.profileContext`）。
- **自包含**：运行时依赖仅 `fflate`（ZIP），其余全部 vendor 进仓库（`src/core/`、`src/host-node.js`），不依赖 `@dsh-packforge/*` 引擎包。
- **加载方式**：官方 bundle 机制——`cordis.patch.yml` 插入 host 插件，`dsh.client` 注入 client 插件。

完整设计见 [dsh-packforge-app/docs/dsh-pack-方案.zh.md](../dsh-packforge-app/docs/dsh-pack-方案.zh.md)。

## 架构

```
host 侧（Node）                         client 侧（浏览器 bundle）
src/index.js  ─┐                       src/client-plugin.js
src/rpc.js     │ registerRpc(ctx,       src/client-rpc.js
src/endpoints.js  runtime)  →  ctx.connection.rpc.handle(CHANNEL, ...)
src/channel.js ┘                       ctx.connection.rpc.call(CHANNEL, ...)
src/profiles.js / junction.js          src/settings.js（slots 设置页）
src/core/（vendored）                   src/locale（可选）
```

- **RPC 通道**：`CHANNEL = '/dsh-pack'`（`src/channel.js`，host / client 共用）。client 直接 `rpc.call`，**不在聊天栏显示任何工具调用**（直接 RPC，静默）。
- **多 profile 切换（机制 A，junction 换指）**：把 `profiles/desktop` 换成 NTFS junction 指向目标 profile，切换 = `unlink` 旧 junction + `symlink(target, 'junction')`，无需退出 desktop。红线：用 `unlink`（lstat）删 junction，**绝不 `rm -r`**（Windows 上会连目标目录一起删）。机制 B（脱管切换器）为兜底，当前 stubbed。

## 依赖

- **运行时**（唯一普通依赖）：`fflate@^0.8.2`（`.dspack` 是纯 ZIP）。
- **开发**：`esbuild@^0.25.0`（打包 client bundle）。
- **运行时注入**（peer，DSH 出厂自带，永不 import）：`@deepseek-ai/dsh-client-runtime`、`dsh-client-ui-settings`、`dsh-client-locale`、`dsh-client-ui-slots`、`react`。

## RPC 端点

| 端点 | 作用 |
| --- | --- |
| `runtime/get` | 返回 profile 运行时信息（home / profilesDir / profileDir / patchPath / startedBundles） |
| `config/get` / `config/set` | 读写 home 下的 `dsh-packforge.json` 状态 |
| `profile/list` | 列出 profiles（desktop junction 指向项不重复列出，真实 desktop 目录标为 `default`） |
| `profile/create` / `profile/delete` | 新建 / 删除 profile |
| `profile/switch` | 切换激活 profile（junction 换指 + 可选 home skills 换指） |
| `pack/export` | 导出 `.dspack` / 源仓库 |
| `pack/config-load` / `pack/config-save` | 读取 / 保存某 profile 的工作区配置 `.dshpkcfg` |
| `pack/view` | 校验并查看 `.dspack` 内容 |
| `pack/install` | 安装 `.dspack` |
| `pack/market` | 浏览市场 |

所有端点返回 `{ok:true, value} | {ok:false, error:{code,message,details}}`。

## 结构

```
src/                host 插件 + client 插件源码
  core/             vendored 整合包引擎（仅 import fflate）
  host-node.js      vendored NodeHost（core 的 DI 边界实现）
lib/client.js       client 浏览器 bundle（pnpm bundle 生成）
cordis.patch.yml    bundle 注入 patch
scripts/bundle-client.mjs   esbuild 打包脚本
test/               单元测试（node --test）
```

## 命令

```bash
pnpm install
pnpm test          # 单元测试
pnpm bundle        # 生成 lib/client.js（浏览器 bundle）
```

## 状态

- 自包含重构完成：无 `@dsh-packforge/*` 依赖，仅 UI + 后端（AI 整合包管理已移除）。
- 机制 A（junction 换指）已实现并通过测试；机制 B（脱管切换器）待接线。
- `export/install` 端到端仍需真实 profile + pnpm 环境验证。
