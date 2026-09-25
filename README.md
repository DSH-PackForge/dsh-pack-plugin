# @dsh-packforge/dsh-pack-plugin

DSH 整合包（`.dspack`）的**纯方案 B 插件 bundle**：一个自包含的独立 npm 包，注入官方 DeepSeek Harness 桌面端，提供 `.dspack` 导出 / 安装 / 多 profile 切换 / 市场浏览 / 工作区配置 / 任务中心。**只做 UI + 后端，不做 AI 驱动的整合包管理。**

- **零官方源码改动**：不改 `apps/desktop` / `apps/desktop-host`。
- **零第三方插件**：只依赖 DSH 出厂运行时服务（`ctx.connection` / `ctx.webServer` / `ctx.slots` / `ctx.locale` / `ctx.profileContext`）。
- **自包含**：运行时依赖仅 `fflate`（ZIP），其余全部 vendor 进仓库（`src/core/`、`src/host-node.js`），不依赖 `@dsh-packforge/*` 引擎包。
- **加载方式**：官方 bundle 机制——`cordis.patch.yml` 插入 host 插件，`dsh.client` 注入 client 插件。

完整设计见 [dsh-packforge-app/docs/dsh-pack-方案.zh.md](../dsh-packforge-app/docs/dsh-pack-方案.zh.md)；格式契约见 [specs/](../DSH-PackForge/specs/)。

## 能力总览

- **导出 `.dspack`**：把某个 profile 打包成单文件整合包（profile 形态），或从源仓库导出（`exportRepo`）。UI 目前只暴露 profile 形态；dshhome（整机）形态的打包 / 安装 / 校验逻辑在 core 里就绪，未在设置面板接线。
- **安装 `.dspack`**：本地文件 / URL / 市场包均可；按 `sha256` + `size` 校验完整性，`pnpm` 重建依赖并对账，home 级 `resources` 与 `files[]` 逐项下载落位。
- **多 profile 切换**：`profiles/desktop` 是激活指针（junction 换指），切换即换指 + 重启桌面，无需重装。
- **home 级 skills / .agent-presets 隔离**：per-profile 槽位（junction），换 profile 时一并换指（见下文）。
- **市场浏览**：`index.json` 精简指针 + `packs/<owner>.<repo>/` 懒加载完整清单 / README。
- **工作区配置 `.dshpkcfg`**：每个 profile 一份，保存 / 读取 / 自动回填。
- **任务中心**：`install` / `export` / `create` 非阻塞执行，独立进度小窗显示阶段时间线与进程输出。

## 架构

```
host 侧（Node）                              client 侧（浏览器 bundle）
src/index.js  ─┐                             src/client.js  ── bundle ──► lib/client.js
src/rpc.js     │ registerRpc(ctx, runtime)   src/client-plugin.js（dspackforge）
src/endpoints.js  → ctx.webServer 挂 /dsh-pack 前缀路由
src/channel.js ┘                             src/client-rpc.js（rpc.call 封装）
src/profiles.js / junction.js                src/settings.js（slots 设置页：管理/导出/市场）
src/migrate.js / migrate-helper.js           src/task-center.html / progress.html
src/ensure-manager.js / tasks.js / progress.js
src/core/（vendored 引擎）                    src/locale（可选）
```

- **RPC 通道**：`CHANNEL = '/dsh-pack'`（`src/channel.js`，host / client 共用）。host 侧自建**前缀路由**挂在 `ctx.webServer` 上（不走 `ctx.connection.rpc.handle`——它对第三方插件不可用），并用 `ctx.connection` 的请求授权栅栏挡住非 client 调用；client 侧 `rpc.call` 静默收发，**不在聊天栏显示任何工具调用**。
- **Host DI 边界**：`src/core/` 不直接碰 `node:fs` / `node:crypto` / `node:child_process`，一律经 `Host` 接口（`src/host.js`）注入，`src/host-node.js` 是 Node 实现。core 因此可脱离 DSH 单独测试。
- **多 profile 切换（junction 换指）**：把 `profiles/desktop` 换成 junction 指向目标 profile，切换 = `unlink` 旧 junction + `symlink(target, 'junction')`。**红线：用 `unlink`（lstat 语义）删 junction，绝不 `rm -r`**——后者在 Windows 上会递归删掉 junction 目标目录的内容。

## 格式契约

- **`.dspack` 容器**（pack-structure v3）：标准 ZIP；根放 `dspack.json`（`{"format":"dspack","version":3}` 标记）+ `manifest.json`。
  - **profile 形态**：机器文件（`package.json` / `pnpm-workspace.yaml` / `pnpm-lock.yaml`）放根，其余内容放 `overrides/`，home 级内容放 `home/`。
  - **dshhome 形态**：整机快照（`profiles/`、`presets/`、`skills/`、`instructions/`、`defaultProfile` 等）。
- **manifest v5**：`type: "profile" | "dshhome"`（见 `src/core/manifest.js`）。
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
| `task/list` / `task/get` | 列出 / 查询任务中心任务（状态、阶段时间线、进程输出） |
| `task/window-open` | 打开（或聚焦）任务中心小窗 |

所有端点返回 `{ok:true, value} | {ok:false, error:{code,message,details}}`；非阻塞端点立即返回 `{taskId}`，执行进度经任务中心（内存注册表 + `os.tmpdir()/dsh-pack-tasks-<home>.json` 快照文件跨进程）呈现。

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
  tasks.js                 任务中心内存注册表 + 快照文件
  task-center-main.cjs / task-center.html   任务中心小窗（electron main + UI）
  progress.js / progress-main.cjs / progress.html / progress-window.ps1   切换进度窗
  settings.js              客户端设置面板（管理 / 导出 / 市场三个 tab + 弹窗）
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
- 多 profile 切换（junction 换指 + 首次迁移脱管 helper）已实现并通过测试。
- skills / .agent-presets per-profile junction 隔离已实现并通过测试（真实 Windows junction 冒烟：skills/.agent-presets 被跟随、profiles/desktop 被跳过、.dsh-pack 被排除）。
- 工作区配置 `.dshpkcfg`、市场浏览、任务中心（非阻塞 + 快照跨进程）已接线。
- `export` / `install` 端到端仍需真实 profile + pnpm 环境验证。
