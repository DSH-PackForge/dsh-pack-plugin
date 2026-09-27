// 自定义 skill 提供者：把 DSH-PackForge 的 skill 以「插件原生」方式注册进 DSH 的
// ctx.skills 注册表（不写 $DSH_HOME/skills、不落盘），DSH 的 dsh-tool-skill 会把它们
// 编成模型可见的 skill catalog（<available_skills>）；模型按 name 触发后，经内置
// skill loader 调 ctx.skills.get() 取正文注入上下文。
//
// 契约（已从官方源码 @deepseek-ai/dsh-skill@0.1.7-rc.2 确证）：
//   - SkillRegistry.registerProvider(create: (control) => SkillProvider): () => void
//   - SkillProvider = { name, list(options), get(candidate, options) }
//   - list 返回 SkillCandidate[]（name/description/whenToUse/invocation/source/provider/rank/locator）
//   - get 返回 SkillDefinition（= SkillCandidate 去 rank/locator + content=正文）
//   - SkillInvocationPolicy = { modelInvocable, userInvocable }；DSH 原生**没有**散文 invocation 键。
import { readFileSync } from 'node:fs';

export const PROVIDER_NAME = 'dspack';
// = @deepseek-ai/dsh-skill 的 BUNDLED_SKILL_RANK（packaged 提供者优先级档位）。
const RANK = 600;

// 最小 frontmatter 解析：只取 name/description/whenToUse/invocation 四个已知键，
// 够用且不引 YAML 依赖（skill 正文与上游 SKILL.md 逐字同步，见同目录 .md）。
const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n/;

function parseSkill(raw) {
  const m = FRONTMATTER_RE.exec(raw);
  if (!m) throw new Error('skill 文件缺少 YAML frontmatter');
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    data[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { data, content: raw.slice(m[0].length).trim() };
}

function loadSkill(url) {
  const { data, content } = parseSkill(readFileSync(url, 'utf8'));
  // ★ DSH 原生没有散文「触发词」字段；上游的 invocation 散文并进 whenToUse，否则会被丢掉。
  const whenToUse = data.invocation
    ? `${data.whenToUse ?? ''} 触发词：${data.invocation}`.trim()
    : data.whenToUse;
  return { name: data.name, description: data.description, whenToUse, content };
}

export const publishToGithub = loadSkill(
  new URL('./publish-to-github/SKILL.md', import.meta.url),
);

// 未来 DSH-PackForge/skills 新增 skill 时，在此追加即可。
const SKILLS = [publishToGithub];

export function createDspackSkillProvider() {
  return {
    name: PROVIDER_NAME,
    async list({ signal } = {}) {
      if (signal?.aborted) return [];
      return SKILLS.map((s) => ({
        name: s.name,
        description: s.description,
        whenToUse: s.whenToUse,
        invocation: { modelInvocable: true, userInvocable: true },
        source: 'runtime',
        provider: PROVIDER_NAME,
        rank: RANK,
        locator: s.name,
      }));
    },
    async get(candidate) {
      const s = SKILLS.find((x) => x.name === candidate.name);
      if (!s) return undefined;
      return {
        name: s.name,
        description: s.description,
        whenToUse: s.whenToUse,
        invocation: candidate.invocation,
        source: candidate.source,
        provider: candidate.provider,
        content: s.content,
      };
    },
  };
}
