import { parseArgs } from 'node:util';
import { createSampleSource, filterSkills, rank, searchSkills, type AgentId, type Grade } from '@somm/core';
import { emit, type CliContext } from '../output';

export async function run(args: string[], ctx: CliContext): Promise<number> {
  try {
    const { values, positionals } = parseArgs({ args, options: { agent: { type: 'string' }, json: { type: 'boolean' } }, allowPositionals: true });
    if (positionals.length !== 1 || (values.agent && !['claude', 'codex'].includes(values.agent))) throw new Error('Usage: somm search <query> [--agent claude|codex] [--json]');
    const cache = await ctx.platform.db.select<{ skill_id: string; report_json: string }>('SELECT skill_id, report_json FROM scan_cache');
    const grades: Record<string, Grade> = {};
    for (const row of cache) grades[row.skill_id] = JSON.parse(row.report_json).grade;
    const items = filterSkills(await createSampleSource().fetchIndex(), { agent: values.agent as AgentId | undefined }, grades);
    const results = searchSkills(rank(items, 'all-time', new Date().toISOString().slice(0, 10)), positionals[0]);
    emit(ctx, `${results.length} skills found`, ['Name\tSource\tStars/Installs\tGrade', ...results.map(s => `${s.name}\t${s.source}\t${s.stars ?? '-'} / ${s.installs ?? '-'}\t${grades[s.id] ?? '-'}`)], { results: results.map(s => ({ ...s, grade: grades[s.id] ?? null })) });
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit(ctx, 'error', [message], { error: message }); return 1;
  }
}
