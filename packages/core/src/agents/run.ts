import type { Platform } from '../platform';
import type { AgentId } from '../types';
import { join } from './files';
import type { RunRequest, RunSpec } from './types';

export function buildRun(p: Platform, id: AgentId, bin: string, req: RunRequest): RunSpec {
  const { cwd, prompt, opts, tmpHome, model } = req;
  if (opts.agent !== id) throw new Error('Run agent mismatch');
  if (opts.auth === 'isolated' && (!opts.apiKey || !Number.isFinite(opts.budgetUsd) || opts.budgetUsd! <= 0)) {
    throw new Error('Isolated runs require an API key and positive budget');
  }
  const env: RunSpec['env'] = {};
  let args: string[];
  if (id === 'claude') {
    args = ['-p', '--output-format', 'stream-json', '--verbose', '--setting-sources', 'project,local', '--strict-mcp-config', '--no-session-persistence'];
    env.ANTHROPIC_API_KEY = opts.auth === 'isolated' ? opts.apiKey! : null;
    if (opts.auth === 'isolated') args.push('--max-budget-usd', String(opts.budgetUsd));
  } else {
    args = ['exec', '--json', '--ephemeral', '--ignore-user-config', '-C', cwd, '-s', 'workspace-write'];
    env.HOME = tmpHome;
    env.CODEX_HOME = opts.auth === 'isolated' ? join(tmpHome, '.codex') : p.env.CODEX_HOME || join(p.home, '.codex');
    env.CODEX_API_KEY = opts.auth === 'isolated' ? opts.apiKey! : null;
  }
  if (model) args.push('--model', model);
  args.push('--', prompt);
  return { bin, args, env, cwd };
}
