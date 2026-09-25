// 极简 tar（ustar）解包：只服务于「从 NPM 拉取管理器」的 tarball 解包，够用即可。
//
// 只提取普通文件（typeflag '0' 或 NUL）；目录（'5'）、符号链接（'2'）与 PAX/GNU 扩展头
// （'x'/'g'/'L'）一律跳过。限制：不解析 PAX 扩展出来的超长文件名——我们自己的包路径都
// 很短（package/src/...），不会触发；若未来文件路径变长，这里需要补 PAX 处理。
import { gunzipSync } from 'fflate';

const decoder = new TextDecoder();

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
