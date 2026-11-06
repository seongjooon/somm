import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { createAgents, createSampleSource, fetchSkillFiles, readLocalSkill, scanSkill, installGate, hashFiles, type AgentId, type Scope } from '@somm/core';
import { emit, humanField, type CliContext } from '../output';

export async function loadSkill(id: string, ctx: CliContext, refresh = false) {
  const meta = (await createSampleSource().fetchIndex()).find(s => s.id === id);
  if (meta) return { name: meta.name, files: await fetchSkillFiles(meta, ctx.platform, { refresh }), source: meta.id, description: meta.description, local: undefined };
  if (!await ctx.platform.fs.exists(id)) throw new Error(`Skill not found: ${id}`);
  return { ...await readLocalSkill(id, ctx.platform), source: `local:${resolve(id)}`, description: '', local: resolve(id) };
}
export async function skillHistory(skill: Awaited<ReturnType<typeof loadSkill>>, ctx: CliContext) {
  const past = await ctx.platform.db.select<{ result_json: string; status: string; skill_id: string }>('SELECT result_json, status, skill_id FROM runs ORDER BY finished_at DESC');
  const contentHash = await hashFiles(skill.files);
  let blocked = false, legacyBlocked = false, tested = false;
  for (const row of past) {
    try {
      const result = JSON.parse(row.result_json);
      const identity = result.meta?.identity;
      if (!identity || typeof identity.source !== 'string' || typeof identity.contentHash !== 'string') { if (row.skill_id === skill.name && result.grade === 'F') legacyBlocked = true; continue; }
      if (identity.source !== skill.source || identity.contentHash !== contentHash) continue;
      if (result.grade === 'F') blocked = true;
      if (row.status === 'done' && result.verdict && Array.isArray(result.warnings) && !result.warnings.some((w: string) => ['auth', 'detect-timeout', 'budget', 'target-in-residue', 'verdict-auth', 'verdict-budget', 'verdict-timeout', 'verdict-failed', 'cleanup-failed'].includes(w))) tested = true;
    } catch { /* A malformed record cannot establish a test result. */ }
  }
  return { blocked, legacyBlocked, tested, contentHash };
}
export async function run(args: string[], ctx: CliContext): Promise<number> {
  try {
    const { values: v, positionals: p } = parseArgs({ args, allowPositionals: true, options: { agent: { type: 'string' }, scope: { type: 'string' }, project: { type: 'string' }, symlink: { type: 'boolean' }, force: { type: 'boolean' }, yes: { type: 'boolean' }, json: { type: 'boolean' }, refresh: { type: 'boolean' } } });
    if (p.length !== 1 || !['claude', 'codex'].includes(v.agent ?? '') || !['global', 'project'].includes(v.scope ?? '') || (v.scope === 'project' && !v.project)) throw new Error('Usage: somm install <skill> --agent claude|codex --scope global|project [--project <dir>]');
    const skill = await loadSkill(p[0], ctx, v.refresh);
    const report = scanSkill(skill.files, { name: skill.name });
    const { blocked, legacyBlocked, tested } = await skillHistory(skill, ctx);
    if (legacyBlocked && !blocked) { emit(ctx, 'corked', ['A legacy F record has no source or content identity. Review it before installing a skill with this name.'], { legacyRecord: true }); return 2; }
    const gate = installGate(blocked ? 'F' : report.grade, tested);
    if (gate === 'blocked') { emit(ctx, 'corked', ['Installation blocked.'], { report }); return 2; }
    if (gate === 'after-test' && !v.yes && !await ctx.confirm('Install without a test?')) throw new Error('Installation cancelled');
    if (v.symlink && !skill.local) throw new Error('Symlink requires a local skill directory');
    const item = await createAgents(ctx.platform)[v.agent as AgentId].install(skill, v.scope as Scope, { mode: v.symlink ? 'symlink' : 'copy', symlinkSource: skill.local, projectDir: v.project && resolve(v.project), overwrite: v.force });
    emit(ctx, 'pairs well', [`Installed: ${humanField(item.dir)}`], { installed: item, report }); return 0;
  } catch (error) { const message = error instanceof Error ? error.message : String(error); emit(ctx, 'error', [humanField(message)], { error: message }); return 1; }
}
