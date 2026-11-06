import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodePlatform } from '@somm/core/node';
import type { CliContext } from '../output';
const fake = vi.hoisted(() => ({ run: vi.fn(), save: vi.fn(), propose: vi.fn() }));
vi.mock('@somm/core', async importOriginal => ({ ...await importOriginal<typeof import('@somm/core')>(), runAB: fake.run, saveRun: fake.save, proposeTasks: fake.propose }));
import { run } from './test';
let root: string, ctx: CliContext, lines: string[];
const previous = process.env.SOMM_DATA_DIR;
const metric = () => ({ ok: true, tokensIn: 0, tokensOut: 0, durationMs: 0, tests: null, diff: { files: 0, added: 0, removed: 0, patch: '' }, inventory: { skills: [], plugins: [], mcp: [] }, canaryHits: [] });
const result = () => ({ tag: '// somm: pairs well', a: [metric()], b: [metric()], contamination: { status: 'clean', residue: [] as string[], common: [] as string[], extras: [] as string[], targetInResidue: false }, warnings: [] as string[], verdict: { line: 'Good', rating: 'recommend' }, grade: 'A', meta: {} });
beforeEach(async () => {
 root = await mkdtemp(join(tmpdir(), 'somm-result-')); process.env.SOMM_DATA_DIR = join(root, 'data');
 const platform = await createNodePlatform(); platform.home = join(root, 'home'); platform.proc = { which: async names => Object.fromEntries(names.map(n => [n, null])), run: async () => { throw new Error('unexpected process'); } };
 await mkdir(join(root, 'skill')); await writeFile(join(root, 'skill', 'SKILL.md'), '# skill');
 lines = []; ctx = { platform, json: false, out: l => lines.push(l), err: () => {}, confirm: async () => true }; fake.run.mockReset().mockResolvedValue(result()); fake.save.mockReset(); fake.propose.mockReset().mockResolvedValue(['alpha', 'beta', 'gamma']);
});
afterEach(async () => { if (previous === undefined) delete process.env.SOMM_DATA_DIR; else process.env.SOMM_DATA_DIR = previous; await rm(root, { recursive: true, force: true }); });
const args = () => [join(root, 'skill'), '--agent', 'codex', '--project', root, '--task', 'work', '--yes'];
it('prints the result tag first and zero residue', async () => { expect(await run(args(), ctx)).toBe(0); expect(lines[0]).toBe('// somm: pairs well'); expect(lines).toContain('Shared residue: 0'); });
it('emits a single JSON result including residue', async () => { ctx.json = true; expect(await run(args(), ctx)).toBe(0); expect(lines).toHaveLength(1); expect(JSON.parse(lines[0]).contamination.residue).toEqual([]); });
it('stops when the target is in residue', async () => { const r = result(); r.tag = '// somm: needs to breathe'; r.contamination.residue = ['skill']; r.warnings = ['target-in-residue']; fake.run.mockResolvedValue(r); expect(await run(args(), ctx)).toBe(1); expect(lines.join('\n')).toContain('skill is already visible to both arms'); });
it.each(['SIGINT', 'SIGTERM'] as const)('aborts the run on %s', async signal => { let cleaned = false; fake.run.mockImplementation(async (_p, _d, req) => { try { process.emit(signal); expect(req.signal.aborted).toBe(true); throw new Error('aborted'); } finally { cleaned = true; } }); expect(await run(args(), ctx)).toBe(1); expect(cleaned).toBe(true); expect(lines).toContain('Run cancelled'); });
it('returns 2 for corked results', async () => { const r = result(); r.tag = '// somm: corked'; fake.run.mockResolvedValue(r); expect(await run(args(), ctx)).toBe(2); });
it('returns nonzero for incomplete detection', async () => { const r = result(); r.warnings = ['detect-timeout']; r.tag = '// somm: needs to breathe'; fake.run.mockResolvedValue(r); expect(await run(args(), ctx)).toBe(1); });
it('blocks grade C before invoking the runner', async () => { await writeFile(join(root, 'skill', 'SKILL.md'), 'rm -rf /'); expect(await run(args(), ctx)).toBe(1); expect(fake.run).not.toHaveBeenCalled(); expect(lines.join('\n')).toContain('Static check only'); });

it('uses the agent proposals when no task is supplied', async () => { (ctx as CliContext & { select: (q: string) => Promise<string> }).select = async () => '2'; const options = args().filter((_, i, a) => a[i] !== '--task' && a[i - 1] !== '--task'); expect(await run(options, ctx)).toBe(0); expect(fake.propose).toHaveBeenCalledOnce(); expect(fake.run.mock.calls[0][2].task).toBe('beta'); });
it('cancels while waiting for task selection', async () => {
  (ctx as CliContext & { select: (q: string, signal?: AbortSignal) => Promise<string> }).select = async (_q, signal) => {
    process.emit('SIGINT');
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return '1';
  };
  const options = args().filter((_, i, a) => a[i] !== '--task' && a[i - 1] !== '--task');
  expect(await run(options, ctx)).toBe(1); expect(fake.run).not.toHaveBeenCalled(); expect(lines).toContain('Run cancelled');
});
it('includes the proposal call in the usage estimate', async () => {
  const messages: string[] = []; ctx.err = s => messages.push(s);
  (ctx as CliContext & { select: (q: string) => Promise<string> }).select = async () => '1';
  const options = args().filter((_, i, a) => a[i] !== '--task' && a[i - 1] !== '--task');
  expect(await run(options, ctx)).toBe(0);
  expect(messages.join('\n')).toMatch(/proposal.*4 agent calls/i);
});
it('reports target-in-residue from proposal with the actionable verdict', async () => {
  fake.propose.mockRejectedValue(Object.assign(new Error('target-in-residue'), { name: 'TargetInResidueError', skillName: 'skill', residue: ['other', 'skill'] }));
  const options = args().filter((_, i, a) => a[i] !== '--task' && a[i - 1] !== '--task');
  expect(await run(options, ctx)).toBe(1);
  expect(lines[0]).toBe('// somm: needs to breathe');
  expect(lines.join('\n')).toContain('skill is already visible to both arms (CODEX_HOME/skills or project skills). Remove or rename it, then retry.');
  expect(lines).toContain('Shared residue: 2 (other, skill)');
  expect(fake.run).not.toHaveBeenCalled();
});

it('preserves proposal residue in JSON output', async () => {
  fake.propose.mockImplementation(async () => { ctx.json = true; throw Object.assign(new Error('target-in-residue'), { name: 'TargetInResidueError', skillName: 'skill', residue: ['other', 'skill'] }); });
  const options = args().filter((_, i, a) => a[i] !== '--task' && a[i - 1] !== '--task');
  expect(await run(options, ctx)).toBe(1); expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0]).contamination).toMatchObject({ status: 'contaminated', targetInResidue: true, residue: ['other', 'skill'] });
});

it('locates all supported dependency installers for the sandbox', async () => {
  const calls: string[][] = []; ctx.platform.proc.which = async names => { calls.push(names); return Object.fromEntries(names.map(n => [n, null])); };
  expect(await run(args(), ctx)).toBe(0);
  expect(calls[0]).toEqual(expect.arrayContaining(['pnpm', 'npm', 'yarn', 'uv']));
});
it.each([false, true])('reports cancellation and cleanup failure with recovery path (json=%s)', async json => {
  const { RunCleanupError } = await import('@somm/core'); const key = 'sk-test-cli-secret'; ctx.json = json;
  fake.run.mockImplementation(async () => { process.emit('SIGINT'); throw new RunCleanupError(ctx.platform, 'abc', key, new DOMException('cancelled', 'AbortError'), new Error(`cleanup ${key}`)); });
  expect(await run(args(), ctx)).toBe(1); expect(lines).toHaveLength(json ? 1 : 4);
  expect(lines.join('\n')).toContain('Run cancelled'); expect(lines.join('\n')).toContain('cleanup'); expect(lines.join('\n')).toContain(`${ctx.platform.dataDir}/runs/abc`); expect(lines.join('\n')).not.toContain(key);
  if (json) expect(JSON.parse(lines[0])).toMatchObject({ primaryName: 'AbortError', recoveryPath: `${ctx.platform.dataDir}/runs/abc` });
});
it('reports recovery path when only cleanup failed', async () => {
  const r = { ...result(), warnings: ['cleanup-failed'], cleanupRecoveryPath: `${ctx.platform.dataDir}/runs/abc` }; fake.run.mockResolvedValue(r);
  expect(await run(args(), ctx)).toBe(1); expect(lines).toContain(`Recovery path: ${ctx.platform.dataDir}/runs/abc`);
});
