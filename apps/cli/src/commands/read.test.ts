import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSampleSource } from '@somm/core';
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
  it('keeps malformed and invalid cached grades from breaking search', async () => {
    const skills = await createSampleSource().fetchIndex();
    for (const [id, report] of [[skills[0].id, '{'], [skills[1].id, '{"grade":"Z"}'], [skills[2].id, '{"grade":"B"}']])
      await ctx.platform.db.execute('INSERT INTO scan_cache (skill_id, report_json) VALUES (?, ?)', [id, report]);
    ctx.json = true;
    expect(await search.run([''], ctx)).toBe(0);
    const results = JSON.parse(lines.join('')).results;
    expect(results.find((s: { id: string }) => s.id === skills[0].id).grade).toBeNull();
    expect(results.find((s: { id: string }) => s.id === skills[1].id).grade).toBeNull();
    expect(results.find((s: { id: string }) => s.id === skills[2].id).grade).toBe('B');
  });
  it('keys local scans by resolved path without overwriting sample ids', async () => {
    const sample = (await createSampleSource().fetchIndex())[0].id;
    await ctx.platform.db.execute('INSERT INTO scan_cache (skill_id, report_json) VALUES (?, ?)', [sample, 'original']);
    const cwd = process.cwd();
    const physicalDir = await realpath(dir);
    try {
      for (const parent of ['one', 'two']) {
        const path = join(dir, parent, 'skill'); await mkdir(path, { recursive: true });
        await writeFile(join(path, 'SKILL.md'), '# skill');
        process.chdir(join(dir, parent));
        expect(await scan.run(['skill'], ctx)).toBe(0);
      }
    } finally { process.chdir(cwd); }
    const rows = await ctx.platform.db.select<{ skill_id: string; report_json: string }>('SELECT skill_id, report_json FROM scan_cache');
    expect(rows.find(r => r.skill_id === sample)?.report_json).toBe('original');
    expect(rows.map(r => r.skill_id)).toContain(`local:${join(physicalDir, 'one', 'skill')}`);
    expect(rows.map(r => r.skill_id)).toContain(`local:${join(physicalDir, 'two', 'skill')}`);
  });
  it('handles file and unreadable directory errors and scans Korean paths', async () => {
    const file = join(dir, 'file'); await writeFile(file, 'x');
    ctx.json = true;
    expect(await scan.run([file], ctx)).toBe(1);
    expect(JSON.parse(lines.pop()!).error).toBe(`Not a skill directory: ${file}`);
    const skill = join(dir, '내 스킬 dir'); await mkdir(skill); await writeFile(join(skill, 'SKILL.md'), '# skill');
    const readDir = ctx.platform.fs.readDir;
    ctx.platform.fs = { ...ctx.platform.fs, readDir: async path => { if (path === skill) throw Object.assign(new Error('denied'), { code: 'EACCES' }); return readDir(path); } };
    expect(await scan.run([skill], ctx)).toBe(1);
    expect(JSON.parse(lines.pop()!).error).toBe(`Not a skill directory: ${skill}`);
    ctx.platform.fs.readDir = readDir;
    expect(await scan.run([skill], ctx)).toBe(0);
  });
  it('does not let installed names forge human output', async () => {
    const skill = join(ctx.platform.home, '.claude', 'skills', 'evil\nfake\tname\x1b]0;bad\x07');
    await mkdir(skill, { recursive: true }); await writeFile(join(skill, 'SKILL.md'), '# skill');
    expect(await list.run(['--agent', 'claude'], ctx)).toBe(0);
    expect(lines[2]).toContain('evil fake name?]0;bad?');
    expect(lines[2]).not.toMatch(/[\n\r\x1b]/);
    lines = []; ctx.json = true;
    expect(await list.run(['--agent', 'claude'], ctx)).toBe(0);
    expect(JSON.parse(lines[0]).installed[0].name).toContain('\nfake\tname\x1b');
  });

  it('flattens forged verdicts in path errors while preserving JSON data', async () => {
    const path = 'missing\n// somm: fake\t\x1b]0;fake\x07';
    expect(await scan.run([path], ctx)).toBe(1);
    expect(lines[1]).toContain('missing // somm: fake ?]0;fake?');
    expect(lines[1]).not.toMatch(/[\n\r\x1b]/);
    lines = []; ctx.json = true;
    expect(await scan.run([path], ctx)).toBe(1);
    expect(JSON.parse(lines[0]).error).toContain(path);
  });

});
