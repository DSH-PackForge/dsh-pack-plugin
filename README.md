# @dsh-packforge/dsh-pack-plugin

[![整合包必备](https://dsh-packforge.github.io/dsh-pack-market/badges/plugins/DSH-PackForge-dsh-pack-plugin-zh.svg)](https://dsh-packforge.github.io/dsh-pack-market/#/plugin/DSH-PackForge%2Fdsh-pack-plugin) [![Essential for packs](https://dsh-packforge.github.io/dsh-pack-market/badges/plugins/DSH-PackForge-dsh-pack-plugin-en.svg)](https://dsh-packforge.github.io/dsh-pack-market/#/plugin/DSH-PackForge%2Fdsh-pack-plugin)

DSH 整合包（`.dspack`）的**纯方案 B 插件 bundle**：一个自包含的独立 npm 包，注入官方 DeepSeek Harness 桌面端，提供 `.dspack` 导出 / 安装 / 多 profile 切换 / 市场浏览 / 工作区配置 / 任务中心。**只做 UI + 后端，不做 AI 驱动的整合包管理。**

- **零官方源码改动**：不改 `apps/desktop` / `apps/desktop-host`。
- **零第三方插件**：只依赖 DSH 出厂运行时服务（`ctx.connection` / `ctx.webServer` / `ctx.slots` / `ctx.locale` / `ctx.profileContext`）。
- **自包含**：运行时依赖仅 `fflate`（ZIP）+ `proxy-agent`（下载代理），其余全部 vendor 进仓库（`src/core/`、`src/host-node.js`），不依赖 `@dsh-packforge/*` 引擎包。
- **加载方式**：官方 bundle 机制——`cordis.patch.yml` 插入 host 插件，`dsh.client` 注入 client 插件。

完整设计见 [dsh-packforge-app/docs/dsh-pack-方案.zh.md](../dsh-packforge-app/docs/dsh-pack-方案.zh.md)；格式契约见 [specs/](../DSH-PackForge/specs/)。

## 能力总览

- **导出 `.dspack`**：把某个 profile 打包成单文件整合包（profile 形态），或从源仓库导出（`exportRepo`）。UI 目前只暴露 profile 形态；dshhome（整机）形态的打包 / 安装 / 校验逻辑在 core 里就绪，未在设置面板接线。
- **安装 `.dspack`**：本地文件 / URL / 市场包均可；按 `sha256` + `size` 校验完整性，`pnpm` 重建依赖并对账，home 级 `resources` 与 `files[]` 逐项下载落位。
- **多 profile 切换**：`profiles/desktop` 是激活指针（junction 换指），切换即换指 + 重启桌面，无需重装。
- **home 级 skills / .agent-presets 隔离**：per-profile 槽位（junction），换 profile 时一并换指（见下文）。
- **市场浏览**：`index.json` 精简指针 + `packs/<owner>.<repo>/` 懒加载完整清单 / README。
- **工作区配置 `.dshpkcfg`**：每个 profile 一份，保存 / 读取 / 自动回填。
- **下载代理**：About 页可配代理地址（存 `config.proxy`，覆盖一切）；未配时依次回落环境变量（`HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY`）与 Windows 系统代理（含 `ProxyOverride` 旁路）。支持 http / https / socks / socks5，市场索引 / 包详情 / `.dspack` 安装 / npm 拉取统一生效。
- **任务中心**：`install` / `export` / `create` 非阻塞执行，设置面板内嵌视图显示阶段时间线与进程输出。

## 架构

```
host 侧（Node）                              client 侧（浏览器 bundle）
src/index.js  ─┐                             src/client.js  ── bundle ──► lib/client.js
src/rpc.js     │ registerRpc(ctx, runtime)   src/client-plugin.js（dspackforge）
src/endpoints.js  → ctx.webServer 挂 /dsh-pack 前缀路由
src/channel.js ┘                             src/client-rpc.js（rpc.call 封装）
src/profiles.js / junction.js                src/settings.js（slots 设置页：管理/导出/市场）
src/migrate.js / migrate-helper.js           src/progress.html
src/ensure-manager.js / tasks.js / progress.js
src/core/（vendored 引擎）                    src/locale（可选）
```

- **RPC 通道**：`CHANNEL = '/dsh-pack'`（`src/channel.js`，host / client 共用）。host 侧自建**前缀路由**挂在 `ctx.webServer` 上（不走 `ctx.connection.rpc.handle`——它对第三方插件不可用），并用 `ctx.connection` 的请求授权栅栏挡住非 client 调用；client 侧 `rpc.call` 静默收发，**不在聊天栏显示任何工具调用**。
- **Host DI 边界**：`src/core/` 不直接碰 `node:fs` / `node:crypto` / `node:child_process`，一律经 `Host` 接口（`src/host.js`）注入，`src/host-node.js` 是 Node 实现。core 因此可脱离 DSH 单独测试。除必选能力（读写文件 / `download` / `exec` 等）外，Host 还提供**可选能力**（如 `pnpm(args, opts)`）：默认回退 `exec('pnpm', …)`（依赖 PATH），宿主可覆盖为「复用 DSH 自带 node+pnpm 运行时（`resources/runtime/`）」，让桌面端装包重建依赖时不依赖用户机器 PATH 上的 node/pnpm。`core` 用 `typeof host.pnpm === 'function'` 探测，旧宿主无此能力时自动回退，行为不变。
- **多 profile 切换（junction 换指）**：把 `profiles/desktop` 换成 junction 指向目标 profile，切换 = `unlink` 旧 junction + `symlink(target, 'junction')`。**红线：用 `unlink`（lstat 语义）删 junction，绝不 `rm -r`**——后者在 Windows 上会递归删掉 junction 目标目录的内容。

## 格式契约

- **`.dspack` 容器**（pack-structure v3 / **v3 r2**）：标准 ZIP；根放 `dspack.json`（`{"format":"dspack","version":3}` 标记）+ `manifest.json`。
  - **profile 形态**：机器文件（`package.json` / `pnpm-workspace.yaml` / `pnpm-lock.yaml`）放根，其余内容放 `overrides/`，home 级内容放 `home/`。
  - **dshhome 形态**：整机快照（`profiles/`、`presets/`、`skills/`、`instructions/`、`defaultProfile` 等）。
  - **vendored 依赖内嵌（v3 r2 §8）**：可选 `vendor/` 目录携带依赖 tarball。导入侧已实现阶段 0 对账 + 逐 tarball `sha256`/`size` 预验（装前拒装）、tarball 落盘 `vendor-blobs/` + 重建 `package.json` 时改写为 `file:` 引用 + 本地优先安装；**闭包完整性检测**（对照随包 `pnpm-lock.yaml`）——覆盖完整自动切 `pnpm install --offline`（零网络、缺件即报错），局部覆盖 `--prefer-offline`（本地与网络互为兜底）；DSHL `vendor:` 方言包按隐式条目消费（直挂 `node_modules/`，依赖剔除，不传给 pnpm）。
  - **导出侧手动内嵌（v3 r2 §8.6）**：导出面板列出依赖清单（`pack/dependencies` 端点，npm/git/已内嵌三类）供手动勾选，叠加 **vendor 档位**（`.dshpkcfg` `vendor` 键，workspace-config v1 r2）：`auto`（默认，registry 元数据探测死上游自动内嵌 + round-trip 保持）/ `off`（禁用）/ `full`（全部直接依赖，离线包形态）；勾选后按坐标取件——`vendor-blobs/` round-trip 复用原 tarball 字节、npm 先取 registry 原件（字节一致）、取不到时从 `node_modules` 重打包并按规范加 `-local.N` 版本后缀（dependencies 值 / `vendored[].version` / tarball 内 version 三处一致）；体积阈值（>500 MB 警告 / >2 GiB 拒绝打包）。
  - **导出侧兼容性编辑（v5 r2 §13/§14）**：导出面板「兼容性」组编辑 `dshVersions`（实测兼容版本枚举集，datalist 建议来自本机已装版本，首个即首选、未填 `dshVersion` 时作首选）与 `launchers`（四个已认领启动器 ID 的支持/冲突 + `minVersion`/`reason`，简式/全式归一）；两者持久化进 `.dshpkcfg`（白名单已扩展）并在打包前强校验（`dshVersion ∈ dshVersions` 等错误在导出时报出）。
- **manifest v5 / v5 r2**：`type: "profile" | "dshhome"`（见 `src/core/manifest.js`）。r2 可选字段：`vendored{}`（§12，导入消费 + 结构校验已实现）、`dshVersions`（§13，交集决策已实现：`dshVersion` 优先 → 集合内最新）、`launchers`（§14，结构校验已实现；安装端判定表待接线 UI 确认流）。前向兼容：未知字段不拒装。
- **安全规则**（`src/core/security.js`）：`node_modules/`、`dist/`、密钥 / 凭据、嵌套压缩包、`.dshpkcfg`、`.dsh-pack` 等一律不进包。
- **工作区配置**（specs/workspace-config/v1，`src/core/workspace.js`）：`.dshpkcfg` 为单个 UTF-8 JSON 对象，2 空格缩进 + 结尾换行；只认白名单字段（`name` / `version` / `displayName` / `description` / `author` / `icon` / `dshVersion` / `out` / `exportContent` / `profileName` / `mode` / `content` / `defaultProfile`）；空字符串表示「未填写」。
- **市场索引**（specs/index/index.md，schemaVersion 2，`src/core/market.js`）：`index.json` 只放 `downloadUrl` + `sha256` + `size` 指针和元数据，完整 manifest / README 从 `packs/<owner>.<repo>/` 懒加载。

## 多 profile 切换与 home 级隔离

- `profiles/desktop` 是硬编码的激活指针（`ACTIVE_NAME = 'desktop'`）。切换 = 删除旧 junction + 建立新 junction。
- **首次迁移**：真实 `desktop` 目录需要先改名成 `default` 才能换指，而改名必须退出桌面进程；插件用**脱管 helper**（`migrate.js` 经 `process.execPath` + `ELECTRON_RUN_AS_NODE=1`、`detached:true`、cwd=home 派生 `migrate-helper.js`）完成「杀桌面 → 换指 → 重启桌面」。
- **skills / .agent-presets 隔离**：两者都是 home 级内容（`$DSH_HOME/skills`、`$DSH_HOME/.agent-presets/<id>/agent.cordis.yml`），不进 profile 目录。插件的做法是把 `$DSH_HOME/skills` 与 `$DSH_HOME/.agent-presets` 换成 junction，指向 `.dsh-pack/skills/<profile>` 与 `.dsh-pack/agent-presets/<profile>` 槽位；换 profile 时对两个工件**各自独立**做首次迁移判定（lstat，互不耦合、部分迁移幂等），归档用「活目录胜出」（`rm -r` 目标 + `rename`），没有 skills 的 profile 建空槽位。映射逻辑见 `src/core/home-store.js`（`storeHomeRel`），换指见 `src/junction.js`（`repointHomeArtifact`）。

## RPC 端点

| 端点 | 作用 |
| --- | --- |
| `runtime/get` | 返回 profile 运行时信息（home / profilesDir / profileDir / patchPath / startedBundles） |
| `config/get` / `config/set` | 读写 home 下的 `dsh-packforge.json` 状态 |
| `profile/list` | 列出 profiles（desktop junction 指向项不重复列出，真实 desktop 目录标为 `default`） |
| `profile/create` | 新建 profile（**非阻塞**，立即返回 `taskId`；空整合包自带管理器基线，进度见任务中心） |
| `profile/delete` | 删除 profile |
| `profile/switch` | 切换激活 profile（junction 换指 + 可选 home skills/presets 换指） |
| `profile/switch-check` | 预检切换（如首次迁移是否需杀桌面） |
| `profile/open-dir` | 在系统文件管理器打开 profile 目录 |
| `pack/export` | 导出 `.dspack` / 源仓库（**非阻塞**，立即返回 `taskId`） |
| `pack/config-load` / `pack/config-save` | 读取 / 保存某 profile 的工作区配置 `.dshpkcfg` |
| `pack/view` | 校验并查看 `.dspack` 内容 |
| `pack/install` | 安装 `.dspack`（**非阻塞**，立即返回 `taskId`） |
| `pack/market` | 浏览市场（index 列表 / 详情） |
| `pack/market-detail` | 市场详情懒加载（manifest + README + r2 徽标：launchers 警示 / vendored / dshVersions） |
| `launchers/registry` | 启动器注册表（机器可读版 `launchers.json`，1h 缓存；失败回落内置清单）——「兼容性」编辑器的认领 ID + 显示名数据源 |
| `pack/dependencies` | 列出 profile 依赖清单（npm / git / 已内嵌三类，UI 手动勾选内嵌的数据源） |
| `plugin/check-update` | About 页检查更新：拉 registry 最新版本，与本地比较返回 `{current, latest, outdated}` |
| `plugin/open-url` | 用系统默认浏览器打开 http/https 链接（About 页作者 / 仓库 / 求 Star） |
| `task/list` / `task/get` | 列出 / 查询任务中心任务（状态、阶段时间线、进程输出） |

所有端点返回 `{ok:true, value} | {ok:false, error:{code,message,details}}`；非阻塞端点立即返回 `{taskId}`，执行进度经任务中心（内存注册表，`task/list` / `task/get` RPC 直读）呈现。

## 结构

```
src/                       host 插件 + client 插件源码
  index.js / index.d.ts    host 插件入口（dspack-host）与类型声明
  rpc.js                   自建 /dsh-pack 前缀路由（registerRpc）
  endpoints.js             全部 RPC 端点（ENDPOINTS 表）
  channel.js               CHANNEL / PROFILE_NAME_RE / RESERVED_PROFILE_NAMES
  runtime.js               resolveRuntime（profileContext 事实来源，含 env 兜底）
  host.js / host-node.js   Host DI 边界 / NodeHost 实现（node:fs/crypto/child_process）
  profiles.js              list / create / delete / state（dsh-packforge.json）
  junction.js              desktop + skills/.agent-presets junction 换指（repointHomeArtifact）
  migrate.js / migrate-helper.js   首次迁移脱管 helper（杀桌面→换指→重启）
  ensure-manager.js        空整合包管理器基线（复制 manager + fflate）
  tasks.js                 任务中心内存注册表（task/list / task/get）
  progress.js / progress-main.cjs / progress.html / progress-window.ps1   切换进度窗（electron + 打包态 WPF）
  packaged.js              打包态判定（切换进度窗走 electron GUI 还是 WPF）
  settings.js              客户端设置面板（管理 / 导出 / 市场 / 关于 tab + 任务中心面板 + 弹窗）
  client.js / client-plugin.js / client-rpc.js   客户端 bundle 入口 / 插件面（dspackforge）/ rpc 封装
  core/                    vendored 整合包引擎（仅 import fflate）
    index.js               公共 API 出口
    host.js                Host 接口（DI 边界）
    dspack.js              ZIP 容器（buildDspack / parseDspack / encodeText / decodeText）
    pack.js                packProfile / packHome / dspackEntryPath / summarizeHome
    install.js             安装（installPack 等；home 级内容经 storeHomeRel 落槽位）
    manifest.js            manifest v5 构建 / 校验
    scan.js                目录扫描（安全规则 + junction 跟随）
    security.js            打包安全规则（DENY_*）
    special.js             特殊目录识别
    inspect.js             检视（inspectPack 等）
    workspace.js           工作区配置 .dshpkcfg
    repo.js                repo 形态导出（exportRepo）
    market.js              市场索引读取
    discovery.js           profiles / homes / DSH 版本发现
    home-store.js          home 级换指槽位布局（HOME_ARTIFACT_STORE / storeHomeRel）
lib/client.js              client 浏览器 bundle（pnpm bundle 生成）
cordis.patch.yml           bundle 注入 patch
scripts/bundle-client.mjs  esbuild 打包脚本
test/                      单元测试（node --test）
```

## 命令

```bash
pnpm install
pnpm test          # 单元测试（node --test）
pnpm bundle        # 生成 lib/client.js（浏览器 bundle）
```

## 状态

- 自包含重构完成：无 `@dsh-packforge/*` 依赖，仅 UI + 后端（AI 整合包管理已移除）。
- **v5 r2 / v3 r2 导入侧已实现**：vendored 阶段 0 预检 + 统一安装算法（`--prefer-offline` / 闭包完整自动 `--offline` + `file:` 引用）、DSHL `vendor:` 方言直挂、`dshVersions` 交集决策、r2 字段结构校验（`test/vendored.test.js`）。
- **v5 r2 导出侧已实现**：依赖清单端点（`pack/dependencies`）+ 导出面板手动勾选内嵌（round-trip 复用 / registry 原件 / 本地重打包 `-local.N` 后缀三处一致）+ vendor 档位（auto/off/full，**full 档沿 lockfile 收齐传递闭包**：registry 原件 → `.pnpm` 重打包回退 → skip 记档；闭包条目对账按 v5 §12 闭包规则放行）+ `dshVersions` / `launchers` 兼容性编辑（`.dshpkcfg` 持久化 + 打包前强校验）+ 体积阈值（>500 MB 警告 / >2 GiB 拒绝）。
- 多 profile 切换（junction 换指 + 首次迁移脱管 helper）已实现并通过测试。
- skills / .agent-presets per-profile junction 隔离已实现并通过测试（真实 Windows junction 冒烟：skills/.agent-presets 被跟随、profiles/desktop 被跳过、.dsh-pack 被排除）。
- 工作区配置 `.dshpkcfg`、市场浏览、任务中心（非阻塞 + 内嵌面板）已接线。
- **待办（r2）**：安装端闭包 tarball 的 **pnpm store 预填充**（full 闭包包已校验内嵌，但传递依赖尚未喂给 pnpm，故含闭包条目时保守用 `--prefer-offline` 而非 `--offline`）、发版前离线 dry-run 自检、`export` / `install` 端到端真实 pnpm 环境验证。
- `export` / `install` 端到端仍需真实 profile + pnpm 环境验证。
