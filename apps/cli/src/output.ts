import type { Platform } from '@somm/core';
export interface CliContext {
  platform: Platform;
  out: (line: string) => void;
  err: (line: string) => void;
  json: boolean;
  confirm: (q: string) => Promise<boolean>;
}
export function emit(ctx: CliContext, tag: string, human: string[], data: object): void {
  if (ctx.json) ctx.out(JSON.stringify({ somm: tag, ...data }));
  else {
    ctx.out(`// somm: ${tag}`);
    human.forEach(line => ctx.out(line));
  }
}
