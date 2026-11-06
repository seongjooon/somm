import { expect, test } from 'vitest';
import { emit, type CliContext } from './output';
test('prints a human verdict first', () => {
  const lines: string[] = [];
  emit({ platform: undefined!, err: () => {}, confirm: async () => false, out: (s: string) => { lines.push(s); }, json: false } satisfies CliContext, '3 skills found', ['one'], {});
  expect(lines).toEqual(['// somm: 3 skills found', 'one']);
});
test('prints only one JSON object', () => {
  const lines: string[] = [];
  emit({ platform: undefined!, err: () => {}, confirm: async () => false, out: (s: string) => { lines.push(s); }, json: true } satisfies CliContext, '3 skills found', ['one'], { results: [] });
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0])).toEqual({ somm: '3 skills found', results: [] });
  expect(lines[0]).not.toContain('//');
});
test('sanitizes terminal controls only in human output', () => {
  const lines: string[] = [];
  const ctx: CliContext = { platform: undefined!, err: () => {}, confirm: async () => false, out: (s: string) => { lines.push(s); }, json: false };
  emit(ctx, 'tag\x1b]0;title\x07', ['a\rb\u009bc\td'], { text: 'a\x1bb' });
  expect(lines).toEqual(['// somm: tag?]0;title?', 'a?b?c\td']);
  lines.length = 0; ctx.json = true;
  emit(ctx, 'tag\x1b', [], { text: 'a\x1bb' });
  expect(JSON.parse(lines[0])).toEqual({ somm: 'tag\x1b', text: 'a\x1bb' });
});
