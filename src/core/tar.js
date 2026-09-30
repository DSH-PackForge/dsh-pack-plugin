// 极简 tar（ustar）解包/打包：解包服务于「从 NPM 拉取依赖 / 管理器 tarball」；
// 打包用于按 npm tarball 规范（顶层 `package/`）从目录内容重建 tarball（测试与工具用）。
//
// 只提取普通文件（typeflag '0' 或 NUL）；目录（'5'）、符号链接（'2'）与 PAX/GNU 扩展头
// （'x'/'g'/'L'）一律跳过。限制：不解析 PAX 扩展出来的超长文件名——我们自己的包路径都
// 很短（package/src/...），不会触发；若未来文件路径变长，这里需要补 PAX 处理。
import { gunzipSync, gzipSync } from 'fflate';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function readCString(buf, start, len) {
  let end = start;
  while (end < start + len && buf[end] !== 0) end++;
  return decoder.decode(buf.subarray(start, end));
}

function readOctal(buf, start, len) {
  const s = readCString(buf, start, len).trim();
  return s ? parseInt(s, 8) || 0 : 0;
}

/**
 * 把 npm tarball（gzip 压缩的 tar）解成 { 路径: Uint8Array }。
 * @param {Uint8Array} tgz gzip+tar 字节
 * @returns {Record<string, Uint8Array>}
 */
export function untar(tgz) {
  const buf = gunzipSync(tgz);
  const out = {};
  let off = 0;
  while (off + 512 <= buf.length) {
    const block = buf.subarray(off, off + 512);
    if (block[0] === 0) break; // 结束块（全零 padding）

    const name = readCString(block, 0, 100);
    const prefix = readCString(block, 345, 155);
    const size = readOctal(block, 124, 12);
    const typeflag = String.fromCharCode(block[156]);
    const full = prefix ? `${prefix}/${name}` : name;

    off += 512;
    if ((typeflag === '0' || typeflag === '\0') && full) {
      out[full] = buf.subarray(off, off + size);
    }
    off += Math.ceil(size / 512) * 512;
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * 打包（ustar）：按 npm tarball 规范（顶层 `package/`）从目录内容重建 tarball。
 * ------------------------------------------------------------------------- */

/** ustar 头校验和：chksum 字段（148..156）按 8 个空格计入后全体字节求和。 */
function headerChecksum(header) {
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i];
  return sum;
}

/** 造一个 ustar 文件条目（header + 数据 + 512 对齐；mode 0644、typeflag '0'）。 */
function tarEntry(name, data) {
  const header = new Uint8Array(512);
  header.set(encoder.encode(String(name).slice(0, 99)), 0);
  header.set(encoder.encode('0000644\0'), 100); // mode
  header.set(encoder.encode('0000000\0'), 108); // uid
  header.set(encoder.encode('0000000\0'), 116); // gid
  header.set(encoder.encode(`${data.length.toString(8).padStart(11, '0')}\0`), 124); // size
  header.set(encoder.encode('00000000000\0'), 136); // mtime
  header.set(encoder.encode(' '.repeat(8)), 148); // chksum 占位（空格）
  header[156] = 0x30; // typeflag '0'
  const sum = headerChecksum(header);
  header.set(encoder.encode(`${sum.toString(8).padStart(6, '0')}\0 `), 148);
  const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
  padded.set(data);
  const out = new Uint8Array(512 + padded.length);
  out.set(header, 0);
  out.set(padded, 512);
  return out;
}

/**
 * 打 npm 风格 tarball（gzip + tar）：路径以 `package/` 前缀，末尾两个零块。
 * 与 untar 互逆；真 pnpm 安装时会校验 ustar 头（含 chksum），头字段按规范生成。
 * @param {Record<string, Uint8Array|string>} files
 * @returns {Uint8Array} gzip+tar 字节
 */
export function buildTarball(files) {
  const parts = [];
  for (const [name, content] of Object.entries(files ?? {})) {
    const data = typeof content === 'string' ? encoder.encode(content) : content;
    if (!data?.length) continue;
    parts.push(tarEntry(name, data));
  }
  const end = new Uint8Array(1024);
  const total = parts.reduce((s, p) => s + p.length, 0) + end.length;
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { buf.set(p, off); off += p.length; }
  buf.set(end, off);
  return gzipSync(buf);
}
