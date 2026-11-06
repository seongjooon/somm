import type { Platform } from '@somm/core';
export interface CliContext {
  platform: Platform;
  out: (line: string) => void;
  err: (line: string) => void;
  json: boolean;
  confirm: (q: string) => Promise<boolean>;
}
export const humanField = (value: string): string => value.replace(/[\t\n\r]/g, ' ');
const sanitize = (value: string): string => value.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '?');
export function emit(ctx: CliContext, tag: string, human: string[], data: object): void {
  if (ctx.json) ctx.out(JSON.stringify({ somm: tag, ...data }));
  else {
    ctx.out(sanitize(`// somm: ${tag}`));
    human.forEach(line => ctx.out(sanitize(line)));
  }
}
