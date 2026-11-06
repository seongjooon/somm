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

test('resolves global and project paths without confusing CODEX_HOME', async () => {
  const { p, cleanup } = await testPlatform();
  try {
    p.env.CODEX_HOME = '/custom/codex';
    const { claude, codex } = createAgents(p);
    expect(claude.skillDir('global')).toBe(`${p.home}/.claude/skills`);
    expect(claude.skillDir('project', '/project')).toBe('/project/.claude/skills');
    expect(codex.skillDir('global')).toBe(`${p.home}/.agents/skills`);
    expect(codex.skillDir('project', '/project')).toBe('/project/.agents/skills');
    expect(() => codex.skillDir('project')).toThrow();
  } finally { await cleanup(); }
});
