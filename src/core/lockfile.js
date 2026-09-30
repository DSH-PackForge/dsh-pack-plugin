// pnpm-lock.yaml 本地化改写（v5 r3 §11.2/§11.3 + v3 r3 §8.3）。
//
// 为什么是「定点改写」而不是「YAML 解析再序列化」：
//   - 包里原样带着 lockfile，安装期只许改必须改的地方（其余字段、字段顺序、引号风格都要留住），
//     否则 pnpm 的 `--frozen-lockfile` 语义与作者的可复现性都受影响；
//   - pnpm 9.x lockfile 的形态稳定且定位明确（缩进 2 空格、`resolution` 内联 map、节点键
//     在 `packages:` / `snapshots:` 里），足够支撑定点替换。
//
// 目标形态由真 pnpm 11.7.0 实测确认（`pnpm install --lockfile-only` 一个 `file:` 依赖写出）：
//
//   importers:
//     .:
//       dependencies:
//         fixture-pkg:
//           specifier: file:./blob.tgz          ← 带 ./
//           version: file:blob.tgz              ← 不带 ./
//   packages:
//     fixture-pkg@file:blob.tgz:                ← 键里也换成 file: 形态
//       resolution: {integrity: sha512-…, tarball: file:blob.tgz}
//       version: 1.0.0                          ← 键不再携带版本，故必须补上 version 字段
//   snapshots:
//     fixture-pkg@file:blob.tgz: {}
//
// 支 B（git 来源）只改 `resolution.tarball`，`gitHosted` / 键 / `integrity` 全不动
// （codeload 归档的键就是 URL，改键会破坏 git 指示符）；闭包条目同理只改 `resolution.tarball`。
// 两支都用真 pnpm 11.7.0 跑过 `--frozen-lockfile --offline` 验收（见 release_log）。

/** `sha512-<base64>`：pnpm lockfile 的 integrity 形态（npm 的 SRI 约定）。 */
export function integrityOf(bytes, createHash) {
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

/* ------------------- 文本骨架 ------------------- */

function toLines(text) {
  const src = String(text ?? '');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  // 末尾换行不丢：split 后最后一项为空串，正好保留。
  return { lines: src.split(/\r?\n/), eol };
}

/** 行首缩进（空行返回 -1）。 */
function indentOf(line) {
  if (!line || !line.trim()) return -1;
  return line.length - line.trimStart().length;
}

/** 去掉一层引号（pnpm 对 scoped / 含特殊字符的键加单引号）。 */
function unquote(s) {
  const t = String(s ?? '').trim();
  if (t.length >= 2 && ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"')))) {
    return t.slice(1, -1);
  }
  return t;
}

/** 顶层区块范围（`name:` 位于 0 缩进）。 */
function findSection(lines, name) {
  const re = new RegExp(`^${name}:\\s*$`);
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (re.test(lines[i])) { start = i; break; }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (indentOf(lines[i]) === 0) { end = i; break; }
  }
  return { start, end };
}

/**
 * 区块内的「子节点块」：给定缩进处形如 `<key>:` 的行开启一块；**也接受内联空/短值节点**
 * （pnpm 把空节点写成 `key: {}`，若不识别就会漏改 snapshots 键）。块体是其后缩进更深的行。
 * @returns {Array<{key:string, keyIndex:number, start:number, end:number, inline:string|null}>}
 */
function iterBlocks(lines, from, to, keyIndent) {
  const out = [];
  for (let i = from; i < to; i += 1) {
    const indent = indentOf(lines[i]);
    if (indent !== keyIndent) continue;
    const m = /^(\s*)(.+?):(?:\s*(\{.*\}))?\s*$/.exec(lines[i]);
    if (!m) continue;
    let end = to;
    for (let j = i + 1; j < to; j += 1) {
      const ind = indentOf(lines[j]);
      if (ind >= 0 && ind <= keyIndent) { end = j; break; }
    }
    out.push({ key: unquote(m[2]), keyIndex: i, start: i, end, inline: m[3] ?? null });
    i = end - 1;
  }
  return out;
}

/** 块体内某字段的行号（字段缩进取块内首个字段的缩进）。 */
function fieldIndex(lines, block, field) {
  for (let i = block.start + 1; i < block.end; i += 1) {
    if (new RegExp(`^\\s*${field}:`).test(lines[i])) return i;
  }
  return -1;
}

/** 块体内字段的标量值（仅单行字段）。 */
function fieldValue(lines, block, field) {
  const i = fieldIndex(lines, block, field);
  if (i < 0) return null;
  const m = /^\s*[^:]+:\s*(.*)$/.exec(lines[i]);
  return m ? m[1].trim() : null;
}

/** 内联 map 里的某个键值（`resolution: {gitHosted: true, integrity: sha512-…, tarball: …}`）。 */
function inlineMapValue(line, key) {
  const m = new RegExp(`(?:\\{|,)\\s*${key}:\\s*([^,}]+)`).exec(String(line ?? ''));
  return m ? m[1].trim() : null;
}

/** 替换内联 map 里的某个键值（保留其余键与顺序）。找不到键时**追加到 `}` 前**——
 *  pnpm 自己的字段顺序是 `{gitHosted, integrity, tarball}`，追加比插在开头更贴近它。 */
function replaceInlineMapValue(line, key, value) {
  const re = new RegExp(`((?:\\{|,)\\s*${key}:\\s*)([^,}]+)`);
  if (re.test(line)) return line.replace(re, `$1${value}`);
  return line.replace(/\}\s*$/, `, ${key}: ${value}}`);
}

/* ------------------- 定位 ------------------- */

/** importer 里某个依赖的 `{specifier, version}`（值行号一并给出，便于改写）。 */
export function findImporterDep(lockText, name) {
  const { lines } = toLines(lockText);
  const sec = findSection(lines, 'importers');
  if (!sec) return null;
  for (const imp of iterBlocks(lines, sec.start + 1, sec.end, 2)) {
    const depsField = fieldIndex(lines, imp, 'dependencies');
    if (depsField < 0) continue;
    let depStart = depsField + 1;
    while (depStart < imp.end && indentOf(lines[depStart]) < 0) depStart += 1; // 跳过空行
    if (depStart >= imp.end) continue;
    let depEnd = imp.end;
    for (let i = depStart; i < imp.end; i += 1) {
      const ind = indentOf(lines[i]);
      if (ind >= 0 && ind <= indentOf(lines[depsField])) { depEnd = i; break; }
    }
    for (const dep of iterBlocks(lines, depStart, depEnd, indentOf(lines[depStart]))) {
      if (dep.key !== name) continue;
      const specIdx = fieldIndex(lines, dep, 'specifier');
      const verIdx = fieldIndex(lines, dep, 'version');
      return {
        importer: imp.key,
        specifier: specIdx >= 0 ? fieldValue(lines, dep, 'specifier') : null,
        version: verIdx >= 0 ? fieldValue(lines, dep, 'version') : null,
        specIndex: specIdx,
        verIndex: verIdx,
        block: dep,
      };
    }
  }
  return null;
}

/**
 * 按包名找 `packages:` 里的节点（v5 §12：定位只能靠包名 —— git 节点的键版本段是 URL 而非版本）。
 * @returns {Array<{key, version, gitHosted, tarball, integrity, block}>}
 */
export function findPackageNodes(lockText, name) {
  const { lines } = toLines(lockText);
  const sec = findSection(lines, 'packages');
  if (!sec) return [];
  const out = [];
  for (const b of iterBlocks(lines, sec.start + 1, sec.end, 2)) {
    const at = b.key.lastIndexOf('@');
    const pkgName = b.key.startsWith('@') ? b.key.slice(0, at) : b.key.split('@')[0];
    if (pkgName !== name) continue;
    const resIdx = fieldIndex(lines, b, 'resolution');
    const resLine = resIdx >= 0 ? lines[resIdx] : '';
    out.push({
      key: b.key,
      version: fieldValue(lines, b, 'version'),
      gitHosted: inlineMapValue(resLine, 'gitHosted') === 'true',
      tarball: inlineMapValue(resLine, 'tarball'),
      integrity: inlineMapValue(resLine, 'integrity'),
      block: b,
      resIndex: resIdx,
    });
  }
  return out;
}

/* ------------------- 改写 ------------------- */

function setField(lines, index, field, value) {
  if (index < 0) return false;
  const indent = lines[index].length - lines[index].trimStart().length;
  lines[index] = `${' '.repeat(indent)}${field}: ${value}`;
  return true;
}

/** 键行改写（沿用原来的引号风格；内联值如 `{}` 要原样留下）。 */
function setKey(lines, index, key) {
  const raw = lines[index];
  const indent = raw.length - raw.trimStart().length;
  const quoted = /^\s*['"]/.test(raw);
  const inline = /:\s*(\{.*\})\s*$/.exec(raw);
  lines[index] = `${' '.repeat(indent)}${quoted ? `'${key}'` : key}:${inline ? ` ${inline[1]}` : ''}`;
}

/**
 * 支 A（npm 来源）本地化：四处同步改 `file:`（v3 §8.3 表 A）。
 * @param {string} lockText
 * @param {{name:string, version:string, blobRel:string, integrity:string}} opts
 * @returns {{text:string, changes:string[]}}
 */
export function localizeDirectNpm(lockText, opts) {
  const { name, version, blobRel, integrity } = opts;
  const { lines, eol } = toLines(lockText);
  const changes = [];
  const spec = `file:./${blobRel}`;
  const verSpec = `file:${blobRel}`;
  const newKey = `${name}@${verSpec}`;

  // ① importer：specifier + version
  const dep = findImporterDep(lockText, name);
  if (!dep) throw new Error(`lockfile 的 importers 里没有依赖「${name}」（无法本地化）`);
  if (setField(lines, dep.specIndex, 'specifier', spec)) changes.push(`importers.${dep.importer}.dependencies.${name}.specifier`);
  if (setField(lines, dep.verIndex, 'version', verSpec)) changes.push(`importers.${dep.importer}.dependencies.${name}.version`);

  // ② packages：键 + resolution（integrity 用现算 sha512 覆盖，tarball 指向副本；补 version 字段）
  const nodes = findPackageNodes(lockText, name).filter((n) => !n.gitHosted);
  if (nodes.length !== 1) {
    throw new Error(`lockfile 里 npm 节点「${name}」命中 ${nodes.length} 个（期望恰好 1 个）→ 拒装（同名多节点无法确定改哪个）`);
  }
  const node = nodes[0];
  const needsVersion = fieldIndex(lines, node.block, 'version') < 0;
  setKey(lines, node.block.keyIndex, newKey);
  changes.push(`packages['${newKey}']`);
  if (node.resIndex < 0) throw new Error(`lockfile 节点「${node.key}」缺 resolution 字段（无法本地化）`);
  const indent = ' '.repeat(lines[node.resIndex].length - lines[node.resIndex].trimStart().length);
  lines[node.resIndex] = `${indent}resolution: {integrity: ${integrity}, tarball: ${verSpec}}`;
  changes.push(`packages['${newKey}'].resolution`);

  // ③ snapshots：键同步（必须在插入 version 行之前做——插入会移动后续行号）
  const sec = findSection(lines, 'snapshots');
  if (sec) {
    for (const b of iterBlocks(lines, sec.start + 1, sec.end, 2)) {
      if (b.key !== node.key) continue;
      setKey(lines, b.keyIndex, newKey);
      changes.push(`snapshots['${newKey}']`);
      break;
    }
  }

  // ④ 键改成 file: 后不再携带版本 → 必须在节点里补回 version（pnpm 对 registry 节点会省略它）
  if (needsVersion) {
    lines.splice(node.resIndex + 1, 0, `${indent}version: ${version}`);
    changes.push(`packages['${newKey}'].version`);
  }
  return { text: lines.join(eol), changes };
}

/**
 * 支 B（git 来源）本地化：**只改** `resolution.tarball`，`gitHosted` / 键 / `integrity` 全不动。
 * @param {string} lockText
 * @param {{name:string, blobRel:string}} opts
 */
export function localizeDirectGit(lockText, opts) {
  const { name, blobRel } = opts;
  const { lines, eol } = toLines(lockText);
  const nodes = findPackageNodes(lockText, name).filter((n) => n.gitHosted);
  if (nodes.length === 0) throw new Error(`lockfile 里没有 gitHosted 节点「${name}」（支 B 无法本地化）`);
  if (nodes.length > 1) {
    throw new Error(`lockfile 里 gitHosted 节点「${name}」命中 ${nodes.length} 个 → 拒装（同名多 git 节点无法确定改哪个）`);
  }
  const node = nodes[0];
  if (node.resIndex < 0) throw new Error(`lockfile 节点「${node.key}」缺 resolution 字段（无法本地化）`);
  lines[node.resIndex] = replaceInlineMapValue(lines[node.resIndex], 'tarball', `file:${blobRel}`);
  return { text: lines.join(eol), changes: [`packages['${node.key}'].resolution.tarball`] };
}

/**
 * 闭包条目本地化：只改该节点的 `resolution.tarball`（闭包没有 importer 段可改）。
 * @param {string} lockText
 * @param {{key:string, blobRel:string}} opts key = lockfile 里的节点键（`name@version` 或带 URL 的 git 形态）
 */
export function localizeClosureNode(lockText, opts) {
  const { key, blobRel } = opts;
  const { lines, eol } = toLines(lockText);
  const sec = findSection(lines, 'packages');
  if (!sec) throw new Error('lockfile 缺 packages 区块（无法本地化闭包条目）');
  for (const b of iterBlocks(lines, sec.start + 1, sec.end, 2)) {
    if (b.key !== key) continue;
    const resIdx = fieldIndex(lines, b, 'resolution');
    if (resIdx < 0) throw new Error(`lockfile 节点「${key}」缺 resolution 字段（无法本地化闭包条目）`);
    lines[resIdx] = replaceInlineMapValue(lines[resIdx], 'tarball', `file:${blobRel}`);
    return { text: lines.join(eol), changes: [`packages['${key}'].resolution.tarball`] };
  }
  throw new Error(`lockfile 里没有节点「${key}」（闭包条目无法本地化）`);
}
