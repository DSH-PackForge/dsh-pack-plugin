# @dsh-packforge/dsh-pack-plugin

DSH 整合包（`.dspack`）的**纯方案 B 插件 bundle**：一个独立 npm 包，注入官方 DeepSeek Harness 桌面端，提供 `.dspack` 导出 / 导入 / 多 profile 切换。

- **零官方源码改动**：不改 `apps/desktop` / `apps/desktop-host`。
- **零第三方插件**：只依赖 DSH 出厂运行时服务（`ctx.connection.rpc` / `ctx.tools` / `ctx.slots` / `ctx.profileContext`）+ 自带引擎。
- **加载方式**：官方 bundle 机制——`cordis.patch.yml` 插入 host 插件，`dsh.client` 注入 client 插件。

完整设计见 [dsh-packforge-app/docs/dsh-pack-方案.zh.md](../dsh-packforge-app/docs/dsh-pack-方案.zh.md)。

## 结构

```
src/                host 插件 + client 插件源码
lib/client.js       client 浏览器 bundle（pnpm bundle 生成）
cordis.patch.yml    bundle 注入 patch
scripts/bundle-client.mjs   esbuild 打包脚本
test/               单元测试
```

## 依赖

- **引擎**（普通 npm 依赖，随 bundle 一起发布）：`@dsh-packforge/core`、`@dsh-packforge/host-node`、`@dsh-packforge/host-dsh-plugin`。
  > ⚠️ 这三个包**尚未发布到 npm**。开发前先从 monorepo 发布：
  > `cd ../dsh-packforge-app && pnpm -r --filter @dsh-packforge/core --filter @dsh-packforge/host-node --filter @dsh-packforge/host-dsh-plugin publish --access public`
  > 或本地 `pnpm link` 对应包。
- **运行时**（peer，DSH 出厂自带）：`@deepseek-ai/cordis`、`dsh-client-runtime`、`dsh-client-ui-settings`、`dsh-client-locale`、`dsh-client-ui-slots`、`react` 等。

## 命令

```bash
pnpm install
pnpm test          # 单元测试
pnpm bundle        # 生成 lib/client.js（浏览器 bundle）
```

## 状态

- 当前为 `@dsh-packforge/plugin`（monorepo 内旧包）拷贝起步，RPC 通道仍为 Typert Remote。
- 下一步：RPC 升级为 `ctx.connection.rpc`，并实现多 profile 切换（junction 换指，见方案 §7）。
