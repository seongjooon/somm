import { expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createNodePlatform } from '@somm/core/node';
import type { SkillMeta } from '@somm/core';
import { skillId, collapseCopies, enrich, officialIds } from './enrich';
import type { Candidate } from './types';
const candidate: Candidate = { source: 'claude-official', owner: 'anthropics', repo: 'skills', path: 'skills/xlsx', commit: 'a'.repeat(40), stars: 1, pushedAt: '2026-01-01' };
test('skillId keeps sample ids for official skills', () => {
  expect(skillId(candidate)).toBe('anthropics/xlsx');
  expect(skillId({ ...candidate, source: 'github', owner: 'dietrichgebert', repo: 'ponytail', path: 'skills/ponytail' })).toBe('dietrichgebert/ponytail/skills/ponytail');
});
test('collapseCopies keeps one of same-content copies', () => {
  const base: SkillMeta = { id: 'a', name: 'a', description: '', source: 'github', repoUrl: 'https://github.com/a/b.git', ref: 'main', path: '.openclaw/skills/a', snapshots: [], agents: [], contentHash: 'hash' };
  const clean = { ...base, id: 'b', path: 'skills/a' };
  const other = { ...base, id: 'c', repoUrl: 'https://github.com/a/c.git' };
  expect(collapseCopies([base, clean, other])).toEqual([clean, other]);
});
test('enrich pins ref and omits commands', async () => {
  const root = await mkdtemp(`${tmpdir()}/somm-crawler-`);
  const old = process.env.SOMM_DATA_DIR;
  try {
    const repo = `${root}/repo`; await mkdir(`${repo}/skills/xlsx`, { recursive: true });
    await writeFile(`${repo}/skills/xlsx/SKILL.md`, '---\nname: Fixture\ndescription: Test skill\n---\n# Hello\n');
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init'); git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture');
    const sha = git('rev-parse', 'HEAD'); process.env.SOMM_DATA_DIR = `${root}/data`;
    const p = await createNodePlatform();
    const result = await enrich(p, { ...candidate, commit: sha }, { repoUrl: repo, allowLocal: true });
    expect(result.ref).toBe(sha); expect(result.name).toBe('Fixture'); expect(result.description).toBe('Test skill');
    expect(result.grade).toBeDefined(); expect(result.traits).not.toHaveProperty('commands');
  } finally { if (old === undefined) delete process.env.SOMM_DATA_DIR; else process.env.SOMM_DATA_DIR = old; await rm(root, { recursive: true, force: true }); }
});
test('colliding official ids fall back to full path ids', () => {
  const a = { ...candidate, source: 'codex-official' as const, owner: 'openai', path: 'skills/.curated/openai-docs' };
  const b = { ...a, path: 'skills/.system/openai-docs' };
  const c = { ...a, path: 'skills/other' };
  expect(officialIds([a, b, c])).toEqual(['openai/skills/skills/.curated/openai-docs', 'openai/skills/skills/.system/openai-docs', 'openai/other']);
});
