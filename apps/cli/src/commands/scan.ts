import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { createSampleSource, fetchSkillFiles, readLocalSkill, scanSkill, skillTraits, installGate, hashFiles } from '@somm/core';
import { emit, humanField, type CliContext } from '../output';

export async function run(args: string[], ctx: CliContext): Promise<number> {
  try {
    const { positionals } = parseArgs({ args, options: { json: { type: 'boolean' } }, allowPositionals: true });
    if (positionals.length !== 1) throw new Error('Usage: somm scan <skill-id|path> [--json]');
    const id = positionals[0];
    const meta = (await createSampleSource().fetchIndex()).find(s => s.id === id);
    let name: string, files;
    if (meta) { name = meta.name; files = await fetchSkillFiles(meta, ctx.platform); }
    else if (await ctx.platform.fs.exists(id)) {
      try { ({ name, files } = await readLocalSkill(id, ctx.platform)); }
      catch (error) {
        if (error && typeof error === 'object' && 'code' in error && ['ENOTDIR', 'EACCES', 'EPERM'].includes(String(error.code))) throw new Error(`Not a skill directory: ${id}`);
        throw error;
      }
    }
    else throw new Error(`Skill not found: ${id}. Provide a sample skill ID or a local path.`);
    const report = scanSkill(files, { name });
    const traits = skillTraits(files);
    const gate = installGate(report.grade, false);
    await ctx.platform.db.execute('INSERT OR REPLACE INTO scan_cache (skill_id, content_hash, report_json, scanned_at) VALUES (?, ?, ?, ?)', [meta ? id : `local:${resolve(id)}`, await hashFiles(files), JSON.stringify(report), new Date().toISOString()]);
    emit(ctx, report.grade === 'A' || report.grade === 'B' ? 'pairs well' : 'needs to breathe', [
      `Grade: ${report.grade}  Score: ${report.score}`,
      ...report.findings.map(f => `${humanField(f.file)}:${f.line} ${humanField(f.message)}`),
      `Traits: ${JSON.stringify(traits)}`, `Direct install: ${gate === 'direct' ? 'allowed' : 'not allowed'}`,
    ], { report, traits, installGate: gate });
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit(ctx, 'error', [humanField(message)], { error: message }); return 1;
  }
}
