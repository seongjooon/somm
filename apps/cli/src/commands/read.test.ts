import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodePlatform } from '@somm/core/node';
import type { CliContext } from '../output';
import * as search from './search';
import * as scan from './scan';
import * as list from './list';

let dir: string, ctx: CliContext, lines: string[];
const previous = process.env.SOMM_DATA_DIR;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'somm-cli-'));
  process.env.SOMM_DATA_DIR = join(dir, 'data');
  const platform = await createNodePlatform();
  platform.home = join(dir, 'home');
  platform.proc = { which: async names => Object.fromEntries(names.map(name => [name, null])), run: async () => { throw new Error('unexpected process'); } };
  lines = [];
  ctx = { platform, json: false, out: line => lines.push(line), err: line => lines.push(line), confirm: async () => false };
});
afterEach(async () => {
  if (previous === undefined) delete process.env.SOMM_DATA_DIR; else process.env.SOMM_DATA_DIR = previous;
  await rm(dir, { recursive: true, force: true });
});
describe('read commands', () => {
  it('searches in human and JSON formats', async () => {
    expect(await search.run(['review'], ctx)).toBe(0);
    expect(lines[0]).toMatch(/^\/\/ somm: \d+ skills found$/);
    lines = []; ctx.json = true;
    expect(await search.run(['review', '--agent', 'codex'], ctx)).toBe(0);
    expect(JSON.parse(lines.join('')).results.every((s: { agents: string[] }) => s.agents.includes('codex'))).toBe(true);
  });
  it('scans a local skill and stores a report', async () => {
    const skill = join(dir, 'skill'); await mkdir(skill); await writeFile(join(skill, 'SKILL.md'), '# A skill\n');
    expect(await scan.run([skill], ctx)).toBe(0);
    expect(lines[0]).toBe('// somm: pairs well');
    lines = []; ctx.json = true;
    expect(await scan.run([skill], ctx)).toBe(0);
    expect(JSON.parse(lines.join('')).report.grade).toBe('A');
    expect(await ctx.platform.db.select('SELECT * FROM scan_cache')).toHaveLength(1);
  });
  it('reports unknown skills as JSON errors', async () => {
    ctx.json = true;
    expect(await scan.run(['missing-skill-id'], ctx)).toBe(1);
    expect(JSON.parse(lines.join('')).error).toMatch(/not found/i);
  });
  it('lists agents in human and JSON formats', async () => {
    expect(await list.run([], ctx)).toBe(0);
    expect(lines[0]).toBe('// somm: 0 skills installed');
    expect(lines.join('\n')).toContain('Not installed');
    lines = []; ctx.json = true;
    expect(await list.run([], ctx)).toBe(0);
    expect(JSON.parse(lines.join('')).installed).toEqual([]);
  });
});
