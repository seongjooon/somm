import { parseArgs } from 'node:util';
import { createAgents, type AgentId } from '@somm/core';
import { emit, humanField, type CliContext } from '../output';

export async function run(args: string[], ctx: CliContext): Promise<number> {
  try {
    const { values, positionals } = parseArgs({ args, options: { agent: { type: 'string' }, project: { type: 'string' }, json: { type: 'boolean' } }, allowPositionals: true });
    if (positionals.length || (values.agent && !['claude', 'codex'].includes(values.agent))) throw new Error('Usage: somm list [--agent claude|codex] [--project <dir>] [--json]');
    const agents = createAgents(ctx.platform);
    const ids: AgentId[] = values.agent ? [values.agent as AgentId] : ['claude', 'codex'];
    const statuses = await Promise.all(ids.map(async id => ({ agent: id, ...(await agents[id].detect()) })));
    const installed = (await Promise.all(ids.map(id => agents[id].listInstalled(values.project)))).flat();
    const human = statuses.flatMap(status => [
      `${status.agent}: ${!status.installed ? 'Not installed' : status.loggedIn === false ? 'Not logged in' : status.loggedIn === 'unknown' ? 'Login status unknown' : 'Logged in'}`,
      ...installed.filter(item => item.agent === status.agent).map(item => `  ${item.scope}: ${humanField(item.name)} | ${item.enabled ? 'enabled' : 'disabled'} | ${item.managedBySomm ? 'managed by somm' : 'not managed by somm'}`),
    ]);
    emit(ctx, `${installed.length} skills installed`, human, { installed, agents: statuses }); return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit(ctx, 'error', [humanField(message)], { error: message }); return 1;
  }
}
