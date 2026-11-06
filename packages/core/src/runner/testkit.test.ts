// Fakes for runAB tests: scripted agent processes, an in-memory sandbox and a real in-memory SQLite.
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentAdapter } from '../agents';
import { nodeFs } from '../node/fs';
import { migrate, type Db, type Platform } from '../platform';
import type { Sandbox } from '../sandbox';
import { expect, test } from 'vitest';
import type { AgentEvent } from '../types';

export interface Call { bin: string; args: string[]; cwd: string; env: Record<string, string | null>; signal?: AbortSignal; skillPresent: boolean }
export type Script = (call: Call, n: number) => Promise<{ lines: string[]; code: number; stderr?: string }>;
export const line = (e: Omit<AgentEvent, 'raw'>) => JSON.stringify(e);
export const okLines = (skills: string[] = []) => [
  line({ kind: 'init', inventory: { skills, plugins: [], mcp: [] } }),
  line({ kind: 'usage', usage: { input: 100, output: 10 } }),
  line({ kind: 'done' }),
];
export const VERDICT = line({ kind: 'text', text: '{"line":"Tighter diffs.","rating":"recommend"}' });

export async function makeEnv(opts: { script?: Script; loggedIn?: boolean | 'unknown'; installed?: boolean; residue?: string[]; diffThrows?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'somm-runab-'));
  const database = new DatabaseSync(':memory:');
  const db: Db = {
    async select<T>(sql: string, params: unknown[] = []) { return database.prepare(sql).all(...params as never[]) as T[]; },
    async execute(sql, params = []) { database.prepare(sql).run(...params as never[]); },
  };
  await migrate(db);
  const calls: Call[] = [];
  const cleaned: string[] = [];
  const script: Script = opts.script ?? (async (_c, n) => ({ lines: n === 0 || n === 1 ? okLines() : [VERDICT], code: 0 }));
  const p: Platform = {
    fs: nodeFs, db, home: join(root, 'home'), dataDir: root, env: {},
    proc: {
      async which() { return {}; },
      async run(bin, args, o = {}) {
        const call: Call = { bin, args, cwd: o.cwd ?? '', env: o.env ?? {}, signal: o.signal, skillPresent: await nodeFs.exists(join(o.cwd ?? '', '.claude/skills/tdd/SKILL.md')) };
        if (o.signal?.aborted) throw new DOMException('Process aborted', 'AbortError');
        calls.push(call);
        const aborted = new Promise<never>((_, rej) => o.signal?.addEventListener('abort', () => rej(new DOMException('Process aborted', 'AbortError')), { once: true }));
        aborted.catch(() => {});
        const res = script(call, calls.length - 1);
        if (o.signal?.aborted) throw new DOMException('Process aborted', 'AbortError');
        const { lines, code, stderr } = await Promise.race([res, aborted]);
        for (const l of lines) o.onLine?.('stdout', l);
        return { code, stdout: lines.join('\n'), stderr: stderr ?? '' };
      },
    },
  };
  const sandbox: Sandbox = {
    async prepare(_project, runId) {
      const base = join(root, 'runs', runId, 'base');
      await nodeFs.mkdirp(base);
      for (const s of opts.residue ?? []) { await nodeFs.mkdirp(join(base, '.claude/skills', s)); await nodeFs.writeText(join(base, '.claude/skills', s, 'SKILL.md'), '---\n---\n'); }
      return { base, deps: { mode: 'none', ok: true, log: '' }, warnings: [] };
    },
    async split(base, arms) {
      const out: Record<string, string> = {};
      for (const a of arms) { out[a] = join(base, '..', a); await nodeFs.mkdirp(out[a]); }
      return out;
    },
    async plantCanaries({ projectDir }) { return [{ path: join(projectDir, '.env'), token: `somm-canary-${'ab'.repeat(8)}` }]; },
    async diffStat() { if (opts.diffThrows) throw new Error('diff failed'); return { files: 1, added: 2, removed: 1, patch: 'PATCH' }; },
    async cleanup(runId) { cleaned.push(runId); },
  };
  const agent: AgentAdapter = {
    id: 'claude',
    async detect() { return { installed: opts.installed ?? true, loggedIn: opts.loggedIn ?? true }; },
    skillDir: (_scope: string, proj = '') => join(proj, '.claude/skills'),
    async enumerateSkills(dir: string) {
      const root2 = join(dir, '.claude/skills');
      return (await nodeFs.exists(root2)) ? (await nodeFs.readDir(root2)).map(e => e.name) : [];
    },
    buildRun: (req: { cwd: string; prompt: string; opts: { apiKey?: string } }) => ({ bin: 'fake-agent', args: [req.prompt], cwd: req.cwd, env: { ANTHROPIC_API_KEY: req.opts.apiKey ?? null } }),
    parseLine: (l: string) => { try { return { ...JSON.parse(l), raw: {} }; } catch { return null; } },
  } as unknown as AgentAdapter;
  return { root, p, db, calls, cleaned, sandbox, agent };
}

test('kit provides a migrated database', async () => {
  const e = await makeEnv();
  expect(await e.db.select('SELECT * FROM runs')).toEqual([]);
});
