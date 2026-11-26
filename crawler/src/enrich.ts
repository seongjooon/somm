import { createRequire } from 'node:module';
import { fetchSkillFiles, hashFiles, scanSkill, skillText, skillTraits, type Platform, type SkillMeta } from '@somm/core';
import type { Candidate } from './types';
const requireCore = createRequire(import.meta.resolve('@somm/core'));
const { parse } = requireCore('yaml') as { parse(text: string): unknown };
export function skillId(c: Candidate): string {
  return c.source === 'github' ? `${c.owner}/${c.repo}/${c.path}` : `${c.source === 'claude-official' ? 'anthropics' : 'openai'}/${c.path.split('/').pop()}`;
}
export function collapseCopies(items: SkillMeta[]): SkillMeta[] {
  const chosen = new Map<string, SkillMeta>();
  const rank = (s: SkillMeta) => [Number(s.path.split('/').some(part => part.startsWith('.'))), s.path.length];
  for (const item of items) {
    const key = item.contentHash ? JSON.stringify([item.repoUrl.toLowerCase(), item.contentHash]) : JSON.stringify([item.repoUrl, item.id]);
    const prior = chosen.get(key);
    if (!prior || rank(item)[0] < rank(prior)[0] || (rank(item)[0] === rank(prior)[0] && rank(item)[1] < rank(prior)[1])) chosen.set(key, item);
  }
  return [...chosen.values()];
}
export async function enrich(p: Platform, c: Candidate, options: { repoUrl?: string; allowLocal?: boolean } = {}): Promise<SkillMeta> {
  const repoUrl = options.repoUrl ?? `https://github.com/${c.owner}/${c.repo}.git`;
  const meta: SkillMeta = { id: skillId(c), name: c.path.split('/').pop() || c.repo, description: c.description ?? '', source: c.source, repoUrl, ref: c.commit, path: c.path, stars: c.stars, pushedAt: c.pushedAt, snapshots: [], agents: [], ...(c.license ? { license: c.license } : {}) };
  const files = await fetchSkillFiles(meta, p, { allowLocal: options.allowLocal });
  const text = skillText(files.find(f => f.path === 'SKILL.md')!.contents) ?? '';
  const match = text.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const front = match ? parse(match[1]) : undefined;
  if (front && typeof front === 'object') {
    const { name, description } = front as Record<string, unknown>;
    if (typeof name === 'string' && name.trim()) meta.name = name.trim();
    if (typeof description === 'string' && description.trim()) meta.description = description.trim();
  }
  const { hasScripts, hasHooks, hasMcp } = skillTraits(files);
  meta.traits = { hasScripts, hasHooks, hasMcp };
  meta.grade = scanSkill(files, { name: meta.name }).grade;
  meta.contentHash = await hashFiles(files);
  meta.agents = c.source === 'codex-official' ? ['codex'] : c.source === 'claude-official' ? ['claude'] : files.some(f => f.path === 'agents/openai.yaml') ? ['claude', 'codex'] : ['claude'];
  return meta;
}
