import type { CliContext } from '../output';
export async function run(_args: string[], ctx: CliContext): Promise<number> {
  if (ctx.json) ctx.out(JSON.stringify({ somm: 'not implemented' }));
  else ctx.err('// somm: not implemented');
  return 1;
}
