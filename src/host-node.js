// Node 宿主：实现 src/core 的 Host 契约（以 node:fs 等内建能力注入）。
// 供 CLI / Electron / server 使用。
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { applyEntryPatches } from '@deepseek-ai/cordis-plugin-include';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { ProxyAgent } from 'proxy-agent';
import { getProxyForUrl } from 'proxy-from-env';

// 下载超时策略：连接/响应头阶段 30s 无数据即判死；响应体阶段放宽到 5 分钟（慢速但持续有数据不误杀）。
const DOWNLOAD_CONNECT_MS = 30_000;
const DOWNLOAD_STALL_MS = 300_000;
const DOWNLOAD_MAX_RETRIES = 2; // 瞬时失败（超时/断连）额外重试次数，共最多 3 次
const DOWNLOAD_RETRY_BACKOFF_MS = 800;

/**
 * 解析 DSH 自带 pnpm 运行时的入口（`pnpm.mjs`）——桌面端把 node+pnpm 一起打包进
 * `resources/runtime/`，用它跑 `pnpm install` 即可不依赖用户机器 PATH 上的 node/pnpm。
 * 优先级：显式 env 覆盖（DSH 自身也认这个）> Electron `resourcesPath` 标准布局；均无 → null（回退 PATH）。
 * 纯函数，便于脱离 Electron 单测。
 * @param {{ env?: object, resourcesPath?: string }} [ctx]
 * @returns {string|null}
 */
export function resolvePnpmEntry({ env = process.env, resourcesPath = process.resourcesPath } = {}) {
  const override = env?.DSH_DESKTOP_PNPM_ENTRY;
  if (typeof override === 'string' && override.trim()) return override.trim();
  if (typeof resourcesPath === 'string' && resourcesPath) {
    return path.join(resourcesPath, 'runtime', 'pnpm', 'bin', 'pnpm.mjs');
  }
  return null;
}

export class NodeHost {
  #rootCAs;
  #proxyUrl = null; // 显式配置的代理（设置项，覆盖环境变量）；null = 未配置
  #direct = false; // 强制直连（设置项 'direct'），跳过环境变量与系统代理
  #proxyAgent = null; // 缓存的 ProxyAgent（记录其 proxy URL，变更即重建）
  #sysProxy = undefined; // Windows 系统代理缓存（undefined=未探测 / null=无 / {http,https,...}=有）

  joinPath(...parts) {
    return path.join(...parts);
  }

  /** 以随本工具分发的 Cordis 实现组合独立的补丁副本。 */
  composePackEntries(patches) {
    const result = applyEntryPatches([], patches, () => {});
    return Array.isArray(result) ? result : result.data;
  }

  resolvePath(...parts) {
    return path.resolve(...parts);
  }

  cwd() {
    return process.cwd();
  }

  homedir() {
    return os.homedir();
  }

  env(name) {
    return process.env[name] ?? null;
  }

  basename(abs) {
    return path.basename(abs);
  }

  async readTextFile(abs) {
    try {
      return await fsp.readFile(abs, 'utf8');
    } catch {
      return null;
    }
  }

  async writeTextFile(abs, text) {
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, text, 'utf8'); // 无 BOM
  }

  async readFile(abs) {
    try {
      return new Uint8Array(await fsp.readFile(abs));
    } catch {
      return null;
    }
  }

  async writeFile(abs, data) {
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, data);
  }

  async stat(abs) {
    try {
      const s = await fsp.stat(abs);
      return {
        size: s.size,
        isFile: s.isFile(),
        isDirectory: s.isDirectory(),
        isSymbolicLink: s.isSymbolicLink(),
      };
    } catch {
      return null;
    }
  }

  async readdir(abs) {
    try {
      const entries = await fsp.readdir(abs, { withFileTypes: true });
      return entries.map((e) => ({
        name: e.name,
        abs: path.join(abs, e.name),
        type: e.isSymbolicLink() ? 'symlink' : e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other',
      }));
    } catch {
      return null;
    }
  }

  async mkdir(abs) {
    await fsp.mkdir(abs, { recursive: true });
  }

  async rm(abs, opts = {}) {
    await fsp.rm(abs, { recursive: opts.recursive !== false, force: opts.force !== false });
  }

  async mkdtemp(prefix) {
    return await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  }

  async sha256(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  async sha256File(abs) {
    try {
      return await new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(abs);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
      });
    } catch {
      return null;
    }
  }

  async writeCredentialStore(dest, text) {
    await fsp.mkdir(path.dirname(dest), {recursive:true});
    let file, created = false;
    try {
      file = await fsp.open(dest, 'wx+', 0o600);
      created = true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      file = await fsp.open(dest, 'r+');
    }
    try {
      if (process.platform !== 'win32') await file.chmod(0o600);
      else if (created) {
        const current = spawnSync('whoami.exe', ['/user','/fo','csv','/nh'], {encoding:'utf8',windowsHide:true,timeout:5000});
        const sid = current.stdout?.match(/S-1-(?:\d+-)+\d+/i)?.[0];
        const acl = sid && spawnSync('icacls.exe', [dest,'/inheritance:r','/grant:r','*'+sid+':F'], {windowsHide:true,timeout:5000});
        if (!acl || acl.status !== 0) throw new Error('无法限制凭据文件的 Windows 访问权限');
      }
      await file.truncate(0);
      await file.writeFile(text, 'utf8');
    } finally { await file.close(); }
  }

  async git(args, { cwd } = {}) {
    return new Promise((resolve) => {
      execFile('git', args, {
        cwd, windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: 'https:ssh' },
      }, (error, stdout) => resolve({ status: error ? 1 : 0, stdout: String(stdout).trim() }));
    });
  }

  async exec(cmd, args, opts = {}) {
    // 用异步 spawn（而非 spawnSync）：避免在 Electron 主进程同步阻塞导致界面卡死；
    // stdin 置 ignore 防止 pnpm/git 在无人输入时卡在交互提示；可选 timeoutMs 兜底防永久卡住。
    // 传 opts.onOutput(chunk) 时 stdout/stderr 改 pipe 并逐块回调（任务中心日志），否则 inherit 直通终端。
    return await this.#spawnRun(cmd, args, {
      cwd: opts.cwd,
      timeoutMs: opts.timeoutMs,
      onOutput: opts.onOutput,
      shell: process.platform === 'win32',
    });
  }

  /**
   * 运行 pnpm。桌面端自带 node+pnpm 运行时（`resources/runtime/`），复用它可以不依赖用户
   * 机器 PATH 上的 node/pnpm；找不到自带运行时（CLI / 测试 / 旧版 DSH）则回退 PATH 上的 pnpm。
   * 返回与 exec 相同的 `{ status, error? }`。
   */
  async pnpm(args, opts = {}) {
    // 显式代理/'direct' 对两条路径一致生效：先构造一次带代理的基准 env，再各自补充。
    const baseEnv = { ...process.env };
    this.#applyProxyEnv(baseEnv);
    // 安装日志里写清「用了哪一级」：环境变量指定入口 / DSH 自带运行时 / PATH 回退。
    const emit = (s) => { if (typeof opts.onOutput === 'function') opts.onOutput(String(s) + '\n'); };
    const runPathPnpm = () => this.#spawnRun('pnpm', args, {
      cwd: opts.cwd,
      timeoutMs: opts.timeoutMs,
      onOutput: opts.onOutput,
      env: baseEnv,
      shell: process.platform === 'win32',
    });

    const entry = resolvePnpmEntry();
    const overridden = typeof process.env.DSH_DESKTOP_PNPM_ENTRY === 'string' && process.env.DSH_DESKTOP_PNPM_ENTRY.trim() !== '';
    if (entry && fs.existsSync(entry)) {
      emit(overridden ? '使用 pnpm：DSH_DESKTOP_PNPM_ENTRY 指定入口' : '使用 DSH 自带 pnpm 运行时');
      // process.execPath 即桌面端可执行文件（electron），加 ELECTRON_RUN_AS_NODE=1 让其以纯 node
      // 模式跑 pnpm.mjs——与 DSH 自身 node.cmd 的做法一致；非 Electron（node 直跑）时该变量无害。
      const env = { ...baseEnv, ELECTRON_RUN_AS_NODE: '1' };
      const r = await this.#spawnRun(process.execPath, [entry, ...(args ?? [])], {
        cwd: opts.cwd,
        timeoutMs: opts.timeoutMs,
        onOutput: opts.onOutput,
        env,
      });
      // 降级：自带运行时「根本没启动起来」（spawn 失败/被替换，status 为 null）才回退 PATH；
      // 超时或 pnpm 已运行但退出码非 0（真实安装失败）则不回退，避免换版本重跑造成二次报错/翻倍等待。
      if (r.status === null && !r.timedOut) {
        emit('自带运行时启动失败，回退 PATH pnpm');
        return await runPathPnpm();
      }
      return r;
    }
    emit('使用 PATH 上的 pnpm');
    return await runPathPnpm();
  }

  /** 把显式代理配置透传给子进程（pnpm 原生认 HTTP(S)_PROXY）。'direct' 清除代理变量强制直连；
   *  有显式代理地址则覆盖；两者皆无则保留继承的环境变量。 */
  #applyProxyEnv(env) {
    const keys = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'];
    if (this.#direct) {
      for (const k of keys) delete env[k];
      return;
    }
    if (!this.#proxyUrl) return;
    for (const k of keys) env[k] = this.#proxyUrl;
  }

  /** 共享的 spawn + 流式输出 + 超时杀进程树实现（exec / pnpm 复用）。 */
  #spawnRun(cmd, args, opts = {}) {
    return new Promise((resolve) => {
      const capture = typeof opts.onOutput === 'function';
      let child;
      try {
        child = spawn(cmd, args, {
          cwd: opts.cwd,
          stdio: ['ignore', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit'],
          shell: opts.shell === true,
          env: opts.env ?? process.env,
          windowsHide: true,
        });
      } catch (err) {
        return resolve({ status: null, error: err.message });
      }

      if (capture) {
        const onData = (chunk) => opts.onOutput(String(chunk));
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
      }

      let settled = false;
      let timer = null;
      let timedOut = false;
      const finish = (status, error) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve({ status, error, timedOut });
      };

      if (opts.timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          // 结束整个进程树：Windows 下 shell:true 时 child 是 cmd.exe，需 taskkill /T
          if (child.pid) {
            if (process.platform === 'win32') {
              try { spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch { /* 忽略 */ }
            } else {
              try { process.kill(child.pid, 'SIGTERM'); } catch { /* 忽略 */ }
            }
          }
          finish(null, `命令超时（${opts.timeoutMs}ms）：${cmd} ${(args ?? []).join(' ')}`);
        }, opts.timeoutMs);
      }

      child.on('error', (err) => finish(null, err.message));
      child.on('close', (code) => finish(code ?? 0, undefined));
    });
  }

  /** 显式设置代理（设置项，最高优先级）。`'direct'` 强制直连；空值清除、回落环境变量/系统代理；否则为代理地址。 */
  setProxy(url) {
    const u = typeof url === 'string' ? url.trim() : '';
    this.#direct = u === 'direct';
    this.#proxyUrl = u && u !== 'direct' ? u : null;
    this.#proxyAgent = null; // 失效缓存
  }

  /** 描述当前对某 URL 的代理决策（供安装日志展示）。默认以 pnpm 必访问的 registry 为探测目标。 */
  proxyStatus(target = 'https://registry.npmjs.org/') {
    if (this.#direct) return { kind: 'direct', url: null };
    if (this.#proxyUrl) return { kind: 'manual', url: this.#proxyUrl };
    let u;
    try { u = new URL(target); } catch { return { kind: 'auto-direct', url: null }; }
    const envProxy = getProxyForUrl(u);
    if (envProxy) return { kind: 'auto-env', url: envProxy };
    const sys = this.#sysProxyFor(u);
    if (sys) return { kind: 'auto-system', url: sys };
    return { kind: 'auto-direct', url: null };
  }

  async download(url, destAbs, { headers = {}, redirectHeaders } = {}) {
    let lastErr = null;
    for (let attempt = 0; attempt <= DOWNLOAD_MAX_RETRIES; attempt += 1) {
      try {
        await this.#downloadOnce(url, destAbs, null, headers, redirectHeaders);
        return;
      } catch (e) {
        lastErr = e;
      }
      // Windows 上部分站点（如 github.com）的证书链只认系统根 CA，Node bundled CA 认不到时
      // 自动加载系统根 CA 重试一次（信任系统信任存储，而非禁用校验）。
      if (this.#isCertError(lastErr)) {
        const cas = await this.#systemRootCAs();
        if (cas && cas.length) {
          try {
            await this.#downloadOnce(url, destAbs, cas, headers, redirectHeaders);
            return;
          } catch (e2) {
            lastErr = e2;
          }
        }
      }
      // 瞬时失败（超时 / 断连）退避后重试；非瞬时（4xx / 证书 / 无效地址）直接抛。
      if (attempt < DOWNLOAD_MAX_RETRIES && this.#isRetryable(lastErr)) {
        this.#sysProxy = undefined; // 重试时重新探测系统代理（用户可能刚开关代理）
        await new Promise((r) => setTimeout(r, DOWNLOAD_RETRY_BACKOFF_MS * (attempt + 1)));
        continue;
      }
      throw lastErr;
    }
    throw lastErr;
  }

  /** 解析目标 URL 应走的代理 agent：显式配置 > 环境变量（含 NO_PROXY）> Windows 系统代理；均无 → null（直连）。
   *  proxy-agent v8 的 ProxyAgent 不再接受 URL 字符串入参，需用 getProxyForUrl 回调固定返回代理地址。 */
  #agentFor(url) {
    if (this.#direct) return null; // 强制直连
    const proxy = this.#proxyUrl || getProxyForUrl(url) || this.#sysProxyFor(url) || null;
    if (!proxy) return null;
    if (!this.#proxyAgent || this.#proxyAgent.url !== proxy) {
      this.#proxyAgent = { url: proxy, agent: new ProxyAgent({ getProxyForUrl: () => proxy }) };
    }
    return this.#proxyAgent.agent;
  }

  /** 取 Windows 系统代理中适用于该 URL 协议的地址（http 代理可经 CONNECT 透传 https，故 https 回落 http）。
   *  命中 ProxyOverride 旁路列表或回环地址时返回 null（直连）。 */
  #sysProxyFor(url) {
    const s = this.#windowsSystemProxy();
    if (!s || this.#sysProxyBypasses(s.bypass, url)) return null;
    const proto = url.protocol === 'https:' ? 'https' : 'http';
    return s.map[proto] || s.map.http || s.map.socks5 || s.map.socks || null;
  }

  /** 读 Windows 系统代理（WinINET 注册表 HKCU\...\Internet Settings），返回 { map, bypass } 或 null；缓存一次。 */
  #windowsSystemProxy() {
    if (this.#sysProxy !== undefined) return this.#sysProxy;
    this.#sysProxy = null;
    if (process.platform !== 'win32') return this.#sysProxy;
    try {
      const r = spawnSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'], {
        encoding: 'utf8', timeout: 5000, windowsHide: true,
      });
      const out = String(r.stdout ?? '');
      const en = /ProxyEnable\s+REG_DWORD\s+0x([0-9a-fA-F]+)/i.exec(out);
      if (!en || parseInt(en[1], 16) === 0) return this.#sysProxy; // 未启用系统代理
      const sv = /ProxyServer\s+REG_SZ\s+(.+)/i.exec(out);
      if (!sv) return this.#sysProxy;
      const raw = sv[1].trim();
      if (!raw) return this.#sysProxy;
      const map = this.#parseWinProxy(raw);
      if (!map) return this.#sysProxy;
      const ov = /ProxyOverride\s+REG_SZ\s+(.+)/i.exec(out);
      this.#sysProxy = { map, bypass: ov ? ov[1].trim() : '' };
    } catch {
      this.#sysProxy = null;
    }
    return this.#sysProxy;
  }

  /** ProxyOverride 旁路匹配：回环地址恒直连；`<local>` 匹配无点主机名；其余按精确或 `*` 通配匹配。 */
  #sysProxyBypasses(bypass, url) {
    const h = (url.hostname ?? '').toLowerCase();
    if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]') return true;
    if (!bypass) return false;
    for (const raw of String(bypass).split(';')) {
      const it = raw.trim().toLowerCase();
      if (!it) continue;
      if (it === '<local>') { if (!h.includes('.')) return true; continue; }
      if (it.includes('*')) {
        const re = new RegExp('^' + it.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
        if (re.test(h)) return true;
      } else if (it === h) {
        return true;
      }
    }
    return false;
  }

  /** 解析 ProxyServer：单条裸 host:port（所有协议共用）或 proto=host:port 分号列表（各协议各自取）。 */
  #parseWinProxy(raw) {
    const map = {};
    for (const part of String(raw).split(';')) {
      const seg = part.trim();
      if (!seg) continue;
      const eq = seg.indexOf('=');
      const proto = eq >= 0 ? seg.slice(0, eq).trim().toLowerCase() : 'http';
      const addr = (eq >= 0 ? seg.slice(eq + 1) : seg).trim();
      if (!addr) continue;
      map[proto] = /^[a-z0-9]+:\/\//i.test(addr) ? addr : `${proto}://${addr}`;
    }
    return Object.keys(map).length ? map : null;
  }

  async #downloadOnce(url, destAbs, extraCa, headers, redirectHeaders, redirects = 0) {
    await new Promise((resolve, reject) => {
      let u;
      try {
        u = new URL(url);
      } catch {
        return reject(new Error(`无效的下载地址`));
      }
      const lib = u.protocol === 'https:' ? https : u.protocol === 'http:' ? http : null;
      if (!lib) return reject(new Error(`仅支持 HTTP 或 HTTPS`));
      const options = { headers: { ...headers, 'user-agent': 'dspack/0.3.0' } };
      if (extraCa) options.ca = extraCa;
      const agent = this.#agentFor(u);
      if (agent) options.agent = agent;

      let settled = false;
      let phase = 'connect'; // 'connect'：连接 + 等响应头；'body'：响应体流式下载
      const fail = (err) => { if (!settled) { settled = true; reject(err); } };

      const req = lib.get(url, options, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          // 跟随重定向：每一跳独立重新走（各自超时 / 重试由 download 兜底）。
          if (redirects >= 8) return reject(new Error('下载重定向次数超限'));
          let next;
          try { next = new URL(res.headers.location, u); } catch { return reject(new Error('下载重定向地址无效')); }
          if (next.username || next.password) return reject(new Error('下载地址不得包含凭据'));
          const sameOrigin = next.origin === u.origin;
          const authorize = sameOrigin ? redirectHeaders : undefined;
          const nextHeaders = authorize ? authorize(next.href) : sameOrigin && next.pathname === u.pathname ? headers : {};
          return resolve(Promise.resolve(nextHeaders).then(scoped =>
            this.#downloadOnce(next.href, destAbs, extraCa, scoped, authorize, redirects + 1),
          ));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return fail(new Error(`下载失败：HTTP ${res.statusCode}`));
        }
        // 响应头已到：把「连接/响应头」超时放宽为「停滞」超时，慢速但活跃的大文件不误杀。
        phase = 'body';
        req.setTimeout(DOWNLOAD_STALL_MS);
        const out = fs.createWriteStream(destAbs);
        res.on('error', fail); // req.destroy 中断响应体时，避免 res 抛未处理的 'error'
        res.pipe(out);
        out.on('finish', () => out.close(() => { if (!settled) { settled = true; resolve(); } }));
        out.on('error', fail);
      });

      const onTimeout = () => {
        const msg = phase === 'connect'
          ? `连接超时（${DOWNLOAD_CONNECT_MS / 1000}s 无响应）：${u.origin}`
          : `下载停滞（${DOWNLOAD_STALL_MS / 1000}s 无数据）：${u.origin}`;
        req.destroy(new Error(msg));
      };
      req.on('timeout', onTimeout);
      req.on('error', fail);
      req.setTimeout(DOWNLOAD_CONNECT_MS);
    });
  }

  #isCertError(e) {
    const m = String(e?.code ?? '') + ' ' + String(e?.message ?? '');
    return /UNABLE_TO_VERIFY|SELF_SIGNED|CERT_HAS_EXPIRED|UNABLE_TO_GET_ISSUER|verify the first certificate|ERR_TLS_CERT/i.test(m);
  }

  /** 瞬时网络失败（超时 / 断连 / 解析失败）可重试；4xx/证书错不重试。 */
  #isRetryable(e) {
    const m = String(e?.code ?? '') + ' ' + String(e?.message ?? '');
    return /ETIMEDOUT|ESOCKETTIMEDOUT|ECONNRESET|ECONNREFUSED|EPIPE|ENOTFOUND|socket hang up|超时|停滞/i.test(m);
  }

  async #systemRootCAs() {
    if (this.#rootCAs !== undefined) return this.#rootCAs;
    this.#rootCAs = null;
    if (process.platform !== 'win32') return this.#rootCAs;
    try {
      const script = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-ChildItem Cert:\\LocalMachine\\Root, Cert:\\CurrentUser\\Root | ForEach-Object { '-----BEGIN CERTIFICATE-----'; [System.Convert]::ToBase64String($_.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert), 'InsertLineBreaks'); '-----END CERTIFICATE-----' }";
      const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        encoding: 'utf8', timeout: 15000, windowsHide: true, maxBuffer: 16 * 1024 * 1024,
      });
      const cas = [...String(r.stdout ?? '').matchAll(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)].map((m) => m[0]);
      if (cas.length) this.#rootCAs = cas;
    } catch {
      this.#rootCAs = null;
    }
    return this.#rootCAs;
  }

  /** 竞争者分别登记进程和随机标识，崩溃遗留的登记由下一次操作清理。 */
  async withPackLock(directory, action) {
    const locks = path.join(directory, 'locks');
    await fsp.mkdir(locks, { recursive: true, mode: 0o700 });
    const id = String(process.pid) + '-' + crypto.randomUUID();
    const claim = path.join(locks, id);
    await fsp.writeFile(claim, '', { flag: 'wx', mode: 0o600 });
    try {
      for (const peer of await fsp.readdir(locks)) {
        if (peer === id) {
          continue;
        }
        const match = /^([1-9][0-9]*)-[\da-f-]{36}$/.exec(peer);
        if (!match) {
          throw new Error('更新锁目录中存在无法识别的记录');
        }
        try {
          process.kill(Number(match[1]), 0);
        } catch (error) {
          if (error.code === 'ESRCH') {
            await fsp.rm(path.join(locks, peer), { force: true });
            continue;
          }
          if (error.code !== 'EPERM') {
            throw error;
          }
        }
        throw new Error('另一项整合包操作正在使用此 DSH_HOME，请稍后重试');
      }
      return await action();
    } finally {
      await fsp.rm(claim, { force: true });
    }
  }

  /** 更新前必须区分路径缺失、权限错误与符号链接。 */
  /** 返回普通文件的 POSIX 权限；Windows 无法表达 Git 执行位。 */
  async packFileMode(abs) {
    if (process.platform === 'win32') return null;
    const stat = await fsp.lstat(abs);
    if (!stat.isFile()) throw new Error('权限目标必须是普通文件');
    return stat.mode & 0o777;
  }

  /** 仅在具有 POSIX 权限的文件系统设置普通文件的访问位。 */
  async chmodPackFile(abs, mode) {
    if (!Number.isInteger(mode) || mode < 0 || mode > 0o777) throw new Error('无效的文件权限');
    if (process.platform === 'win32') return;
    if (!(await fsp.lstat(abs)).isFile()) throw new Error('权限目标必须是普通文件');
    await fsp.chmod(abs, mode);
  }

  async packEntryType(abs) {
    try {
      const entry = await fsp.lstat(abs);
      if (entry.isSymbolicLink()) {
        return 'symlink';
      }
      return entry.isFile() ? 'file' : entry.isDirectory() ? 'dir' : 'other';
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /** 回滚时只移除本次创建且仍为空的目录。 */
  async removePackDirIfEmpty(abs) {
    try {
      await fsp.rmdir(abs);
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) {
        throw error;
      }
    }
  }

  /** 复制受管文件时保留普通文件权限，凭据备份仅向当前用户开放。 */
  async copyPackFile(from, to, privateCopy = false) {
    await fsp.mkdir(path.dirname(to), { recursive: true, mode: 0o700 });
    await fsp.copyFile(from, to);
    if (privateCopy) {
      await fsp.chmod(to, 0o600);
    }
  }

  async move(from, to) {
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.rename(from, to);
  }
}
