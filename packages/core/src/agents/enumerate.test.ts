import { expect, test } from 'vitest';
import { createAgents } from './index';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { nodeFs } from '../node/fs';
import { nodeProc } from '../node/proc';
import { migrate, type Platform } from '../platform';

async function testPlatform() {
  const home = await mkdtemp(`${tmpdir()}/somm-agents-`);
  const database = new DatabaseSync(':memory:');
  const p: Platform = { home, dataDir: `${home}/data`, env: {}, fs: nodeFs, proc: nodeProc,
    db: {
      async select<T>(sql: string, params: unknown[] = []) { return database.prepare(sql).all(...params as SQLInputValue[]) as T[]; },
      async execute(sql, params = []) { database.prepare(sql).run(...params as SQLInputValue[]); },
    },
  };
  await migrate(p.db);
  return { p, async cleanup() { database.close(); await rm(home, { recursive: true, force: true }); } };
}

test('enumerates project, ancestor, CODEX_HOME, system skills with YAML policy and names', async () => {
  const { p, cleanup } = await testPlatform();
  try {
    p.env.CODEX_HOME = `${p.home}/custom-codex`;
    const repo = `${p.home}/repo`, arm = `${repo}/nested`;
    await p.fs.mkdirp(`${repo}/.git`);
    async function skill(root: string, name: string, text = 'plain', policy?: string) {
      const dir = `${root}/${name}`;
      await p.fs.mkdirp(dir);
      await p.fs.writeText(`${dir}/SKILL.md`, text);
      if (policy) { await p.fs.mkdirp(`${dir}/agents`); await p.fs.writeText(`${dir}/agents/openai.yaml`, policy); }
    }
    await skill(`${arm}/.claude/skills`, 'claude-only');
    await skill(`${arm}/.agents/skills`, 'folder', '---\nname: renamed\n---\ntext');
    await skill(`${repo}/.agents/skills`, 'ancestor');
    await skill(`${p.home}/.agents/skills`, 'outside-repo');
    await skill(`${p.env.CODEX_HOME}/skills`, 'global');
    await skill(`${p.env.CODEX_HOME}/skills/.system`, 'builtin');
    await skill(`${p.env.CODEX_HOME}/skills`, 'explicit-only', 'plain', 'policy:\n  allow_implicit_invocation: false');
    await skill(`${p.env.CODEX_HOME}/skills`, 'string-false', 'plain', 'policy:\n  allow_implicit_invocation: "false"');
    await p.fs.mkdirp(`${arm}/.agents/skills/not-a-skill`);
    const agents = createAgents(p);
    expect(await agents.claude.enumerateSkills(arm)).toEqual(['claude-only']);
    expect(await agents.codex.enumerateSkills(arm)).toEqual(['ancestor', 'builtin', 'global', 'renamed', 'string-false']);
  } finally { await cleanup(); }
});
test('no repository marker means no ancestor skills are included', async () => {
  const { p, cleanup } = await testPlatform();
  try {
    const dir = `${p.home}/.agents/skills/unrelated`;
    await p.fs.mkdirp(dir);
    await p.fs.writeText(`${dir}/SKILL.md`, 'unrelated');
    expect(await createAgents(p).codex.enumerateSkills(`${p.home}/no-repo`)).toEqual([]);
  } finally { await cleanup(); }
});
