import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { createAgents, type AgentId } from '@somm/core';
import { emit, humanField, type CliContext } from '../output';
export async function run(args: string[], ctx: CliContext): Promise<number> {
  try {
    const { values: v, positionals: p } = parseArgs({ args, allowPositionals: true, options: { agent: { type: 'string' }, scope: { type: 'string' }, project: { type: 'string' }, json: { type: 'boolean' } } });
    if (p.length !== 1 || !['claude', 'codex'].includes(v.agent ?? '') || !['global', 'project'].includes(v.scope ?? '') || (v.scope === 'project' && !v.project)) throw new Error('Usage: somm remove <name> --agent claude|codex --scope global|project [--project <dir>]');
    const agent = createAgents(ctx.platform)[v.agent as AgentId];
    const item = (await agent.listInstalled(v.project && resolve(v.project))).find(i => i.name === p[0] && i.scope === v.scope);
    if (!item) throw new Error(`Skill not found: ${p[0]}`);
    await agent.uninstall(item);
    const backups = await ctx.platform.db.select<{ backup_dir: string }>('SELECT backup_dir FROM backups WHERE original_dir = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', [item.dir]);
    const backup = backups[0]?.backup_dir;
    emit(ctx, 'pairs well', [`Backup: ${humanField(backup ?? 'unknown')}`], { removed: item, backup }); return 0;
  } catch (error) { const message = error instanceof Error ? error.message : String(error); emit(ctx, 'error', [humanField(message)], { error: message }); return 1; }
}
